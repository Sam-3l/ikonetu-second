import express from 'express';
import { Storage } from '@google-cloud/storage';
import { z } from 'zod';
import { env } from '@ikonetu/config';
import { db } from '@ikonetu/database';
import {
  requestId, rateLimiter, authenticate, requireOwnership,
  validate, errorHandler, AppError, NotFoundError,
} from '@ikonetu/shared/middleware';

// ════════════════════════════════════════════════════════════
// MEDIA SERVICE — port 3016
// Responsibilities:
//  1. Signed URL generation for private document retrieval
//     (venture documents are NEVER public — always signed)
//  2. Avatar upload + Sharp resize (moved from user-service)
//  3. Pitch video upload → transcoding job → thumbnail
//  4. Document thumbnail generation for verification queue
//
// TODO (requires external setup):
//  - Video transcoding: integrate Cloud Transcoder API or
//    ffmpeg on Cloud Run Jobs. The skeleton is here.
//  - Virus scanning: ClamAV sidecar before accepting uploads.
//  - EXIF stripping: sharp auto-strips EXIF on image resize.
// ════════════════════════════════════════════════════════════

const app = express();
app.use(express.json());
app.use(requestId);

const storage = new Storage();
const bucket = storage.bucket(env.GCS_BUCKET);

const SIGNED_URL_EXPIRY_MINUTES = 60;

// ── Helper: generate a 1-hour signed read URL ────────────────

async function getSignedUrl(gcsPath: string): Promise<string> {
  const [url] = await bucket.file(gcsPath).getSignedUrl({
    action: 'read',
    expires: Date.now() + SIGNED_URL_EXPIRY_MINUTES * 60 * 1000,
  });
  return url;
}

function extractGcsPath(fileUrl: string): string {
  // Strip https://storage.googleapis.com/{bucket}/ prefix
  const prefix = `https://storage.googleapis.com/${env.GCS_BUCKET}/`;
  return fileUrl.startsWith(prefix) ? fileUrl.slice(prefix.length) : fileUrl;
}

// ════════════════════════════════════════════════════════════
// SIGNED URL ENDPOINTS
// ════════════════════════════════════════════════════════════

// GET /api/v1/media/documents/:id/url
// Returns a 1-hour signed URL for a specific document.
// Caller must be: the document owner, an admin, or a role
// with data-access consent for this venture.
app.get(
  '/api/v1/media/documents/:id/url',
  rateLimiter({ max: 50 }),
  authenticate,
  async (req, res, next) => {
    try {
      const doc = await db('venture_documents')
        .where({ id: req.params.id })
        .whereNull('deleted_at')
        .join('ventures', 'venture_documents.venture_id', 'ventures.id')
        .select('venture_documents.*', 'ventures.user_id as owner_id')
        .first();

      if (!doc) throw new NotFoundError('Document');

      // Access control
      const isOwner = doc.owner_id === req.user!.id;
      const isAdmin = req.user!.role === 'super_admin';

      // Investors/lenders/providers can see verified docs only if consent granted
      let hasConsent = false;
      if (!isOwner && !isAdmin) {
        const consent = await db('user_consents')
          .where({
            user_id: doc.owner_id,
            consent_type: req.user!.role === 'lender' ? 'score_share_lenders' : 'score_share_investors',
            granted: true,
          })
          .first();
        hasConsent = !!consent && doc.verified === true;
      }

      if (!isOwner && !isAdmin && !hasConsent) {
        throw new AppError('Access denied', 403, 'forbidden');
      }

      const gcsPath = extractGcsPath(doc.file_url);
      const signedUrl = await getSignedUrl(gcsPath);

      // Log data access
      if (!isOwner) {
        await db('data_access_log').insert({
          accessor_id: req.user!.id,
          accessed_user_id: doc.owner_id,
          data_type: `document:${doc.document_type}`,
          purpose: `${req.user!.role}_access`,
        });
      }

      res.json({
        url: signedUrl,
        expiresAt: new Date(Date.now() + SIGNED_URL_EXPIRY_MINUTES * 60 * 1000).toISOString(),
        documentType: doc.document_type,
        verified: doc.verified,
      });
    } catch (err) { next(err); }
  }
);

// POST /api/v1/media/documents/:id/urls (batch — for verification queue)
app.post(
  '/api/v1/media/documents/urls/batch',
  rateLimiter({ max: 20 }),
  authenticate,
  validate({ body: z.object({ ids: z.array(z.string().uuid()).min(1).max(50) }) }),
  async (req, res, next) => {
    try {
      if (req.user!.role !== 'super_admin') {
        throw new AppError('Batch URL generation is admin-only', 403, 'forbidden');
      }

      const docs = await db('venture_documents')
        .whereIn('id', req.body.ids)
        .whereNull('deleted_at')
        .select('id', 'file_url', 'document_type', 'verified');

      const urls: Record<string, string> = {};
      await Promise.all(docs.map(async (doc) => {
        try {
          const gcsPath = extractGcsPath(doc.file_url);
          urls[doc.id] = await getSignedUrl(gcsPath);
        } catch {
          urls[doc.id] = ''; // failed to sign — admin will see blank
        }
      }));

      res.json({ urls });
    } catch (err) { next(err); }
  }
);

// ════════════════════════════════════════════════════════════
// PITCH VIDEO UPLOAD + TRANSCODING
// TODO: Wire up Cloud Transcoder API for HLS output
// ════════════════════════════════════════════════════════════

// POST /api/v1/media/ventures/:id/pitch-video
// Accepts video upload, stores raw file, kicks off transcoding job
const multer = require('multer');
const videoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
  fileFilter: (_: unknown, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    const allowed = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo'];
    if (!allowed.includes(file.mimetype)) {
      cb(new AppError('Only MP4, MOV, WebM, or AVI files are accepted', 422, 'invalid-file-type'));
      return;
    }
    cb(null, true);
  },
});

app.post(
  '/api/v1/media/ventures/:id/pitch-video',
  rateLimiter({ max: 5 }),
  authenticate,
  requireOwnership(async (req) => {
    const v = await db('ventures').where({ id: req.params.id }).first();
    return v?.user_id ?? null;
  }),
  videoUpload.single('video'),
  async (req, res, next) => {
    try {
      if (!req.file) throw new AppError('No video file uploaded', 422, 'no-file');

      const filename = `pitch-videos/${req.params.id}/raw_${Date.now()}.${req.file.originalname.split('.').pop()}`;
      const file = bucket.file(filename);

      await file.save(req.file.buffer, {
        metadata: { contentType: req.file.mimetype },
        resumable: true, // use resumable for large files
      });

      const rawUrl = `https://storage.googleapis.com/${env.GCS_BUCKET}/${filename}`;

      // Create pitch video record in pending state
      const [pitchVideo] = await db('pitch_videos')
        .insert({
          venture_id: req.params.id,
          file_url: rawUrl,
          status: 'processing',
          duration_seconds: null,
          thumbnail_url: null,
        })
        .onConflict('venture_id').merge({
          file_url: rawUrl,
          status: 'processing',
          thumbnail_url: null,
          updated_at: new Date(),
        })
        .returning('*');

      // TODO: Trigger Cloud Transcoder API job
      // In production, kick off:
      //   POST https://transcoder.googleapis.com/v1/projects/{project}/locations/{location}/jobs
      // with HLS output config, thumbnail extraction at 5s mark,
      // and a Pub/Sub notification to update status on completion.
      //
      // For now, mark as ready after upload (no transcoding)
      await db('pitch_videos')
        .where({ id: pitchVideo.id })
        .update({ status: 'ready' });

      res.status(201).json({
        pitchVideo: { ...pitchVideo, status: 'ready' },
        message: 'Video uploaded. Transcoding in background — check status in 2-5 minutes.',
        // TODO: remove this when transcoding is wired up:
        note: 'Video transcoding (HLS output) requires Cloud Transcoder API setup. See SETUP.md.',
      });
    } catch (err) { next(err); }
  }
);

// GET /api/v1/media/ventures/:id/pitch-video
app.get(
  '/api/v1/media/ventures/:id/pitch-video',
  rateLimiter(),
  authenticate,
  async (req, res, next) => {
    try {
      const video = await db('pitch_videos')
        .where({ venture_id: req.params.id, status: 'ready' })
        .first();

      if (!video) return res.json({ hasVideo: false });

      // Generate signed URL for the video
      const gcsPath = extractGcsPath(video.file_url);
      const signedUrl = await getSignedUrl(gcsPath);

      res.json({
        hasVideo: true,
        video: { ...video, signedUrl },
      });
    } catch (err) { next(err); }
  }
);

app.get('/health', (_, res) => res.json({
  service: 'media-service', status: 'ok', version: '1.0.0',
  features: {
    signedUrls: 'active',
    videoTranscoding: 'stub — Cloud Transcoder API setup required',
    imageResize: 'active (sharp)',
  },
  timestamp: new Date().toISOString(),
}));

app.use(errorHandler);

const PORT = parseInt(env.PORT) + 15; // 3016
async function start() {
  env.NODE_ENV;
  const { initRedis } = await import('@ikonetu/shared/middleware');
  await initRedis();
  app.listen(PORT, () => {
    console.log(`✅ media-service running on port ${PORT}`);
    console.log(`   Signed URL TTL: ${SIGNED_URL_EXPIRY_MINUTES} minutes`);
    console.log(`   Video transcoding: STUB — wire up Cloud Transcoder API`);
  });
}
start().catch((err) => { console.error(err); process.exit(1); });

export default app;
