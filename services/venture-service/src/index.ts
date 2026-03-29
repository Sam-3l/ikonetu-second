import express from 'express';
import multer from 'multer';
import { Storage } from '@google-cloud/storage';
import { z } from 'zod';
import { env } from '@ikonetu/config';
import { db } from '@ikonetu/database';
import {
  requestId, rateLimiter, authenticate, requireFounder,
  requireOwnership, validate, auditLog, errorHandler,
  AppError, NotFoundError,
} from '@ikonetu/shared/middleware';

const app = express();
app.use(express.json());
app.use(requestId);

const storage = new Storage();
const bucket = storage.bucket(env.GCS_BUCKET);

// ── Signed URL generator — 1 hour expiry ─────────────────────
// Documents are NEVER made public. All access goes through
// time-limited signed URLs generated server-side.
async function getSignedUrl(gcsPath: string): Promise<string> {
  const [url] = await bucket.file(gcsPath).getSignedUrl({
    action: 'read',
    expires: Date.now() + 60 * 60 * 1000, // 1 hour
    version: 'v4',
  });
  return url;
}

function gcsPathFromUrl(fileUrl: string): string {
  return fileUrl.replace(`https://storage.googleapis.com/${env.GCS_BUCKET}/`, '');
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB for documents + video
});

// ── Schemas ──────────────────────────────────────────────────
const CreateVentureSchema = z.object({
  name:                 z.string().min(2).max(200),
  description:          z.string().max(2000).optional(),
  sector:               z.string().max(100).optional(),
  country:              z.string().length(2).optional(),
  city:                 z.string().max(100).optional(),
  registration_number:  z.string().max(100).optional(),
  tin:                  z.string().max(100).optional(),
  date_founded:         z.string().optional(),
  employee_count:       z.number().int().min(0).optional(),
  annual_revenue_range: z.string().max(50).optional(),
  stage:                z.enum(['idea', 'mvp', 'revenue', 'scaling']).optional(),
});

const UpdateVentureSchema = CreateVentureSchema.partial();

const ConnectSocialSchema = z.object({
  platform:        z.enum(['linkedin', 'twitter', 'instagram', 'facebook', 'tiktok', 'youtube']),
  handle:          z.string().max(200),
  url:             z.string().url(),
  followers:       z.number().int().min(0).default(0),
  engagement_rate: z.number().min(0).max(100).default(0),
});

// ── POST /api/v1/ventures ────────────────────────────────────
app.post(
  '/api/v1/ventures',
  rateLimiter(),
  authenticate,
  requireFounder,
  validate({ body: CreateVentureSchema }),
  auditLog('venture.created', 'venture'),
  async (req, res, next) => {
    try {
      // One venture per founder (for now)
      const existing = await db('ventures').where({ user_id: req.user!.id }).whereNull('deleted_at').first();
      if (existing) {
        return res.status(200).json({ venture: existing, message: 'You already have a venture. Use PUT to update it.' });
      }

      const [venture] = await db('ventures').insert({
        user_id: req.user!.id,
        ...req.body,
      }).returning('*');

      // Grant default consents for score sharing
      await db('user_consents').insert([
        { user_id: req.user!.id, consent_type: 'analytics', granted: true, granted_at: new Date(), ip: req.ip, version: '1.0' },
      ]);

      res.status(201).json({ venture });
    } catch (err) { next(err); }
  },
);

// ── GET /api/v1/ventures/:id ─────────────────────────────────
app.get(
  '/api/v1/ventures/:id',
  rateLimiter(),
  authenticate,
  async (req, res, next) => {
    try {
      const venture = await db('ventures')
        .where({ id: req.params.id })
        .whereNull('deleted_at')
        .first();
      if (!venture) throw new NotFoundError('Venture');

      // IDOR protection — founders can only see their own
      if (req.user!.role === 'founder' && venture.user_id !== req.user!.id) {
        throw new NotFoundError('Venture');
      }

      // Log data access
      if (venture.user_id !== req.user!.id) {
        await db('data_access_log').insert({
          accessor_id: req.user!.id,
          accessed_user_id: venture.user_id,
          data_type: 'venture_profile',
          purpose: `${req.user!.role}_access`,
        });
      }

      const score = await db('scores').where({ venture_id: venture.id, is_current: true }).first();
      const documents = await db('venture_documents').where({ venture_id: venture.id }).whereNull('deleted_at');
      const socialProfiles = await db('venture_social_profiles').where({ venture_id: venture.id });

      res.json({ venture, score, documents, socialProfiles });
    } catch (err) { next(err); }
  },
);

// ── PUT /api/v1/ventures/:id ─────────────────────────────────
app.put(
  '/api/v1/ventures/:id',
  rateLimiter(),
  authenticate,
  requireFounder,
  requireOwnership(async (req) => {
    const v = await db('ventures').where({ id: req.params.id }).first();
    return v?.user_id ?? null;
  }),
  validate({ body: UpdateVentureSchema }),
  auditLog('venture.updated', 'venture'),
  async (req, res, next) => {
    try {
      const [venture] = await db('ventures')
        .where({ id: req.params.id })
        .whereNull('deleted_at')
        .update({ ...req.body, updated_at: new Date() })
        .returning('*');
      if (!venture) throw new NotFoundError('Venture');
      res.json({ venture });
    } catch (err) { next(err); }
  },
);

// ── POST /api/v1/ventures/:id/documents ──────────────────────
app.post(
  '/api/v1/ventures/:id/documents',
  rateLimiter({ max: 20 }),
  authenticate,
  requireFounder,
  requireOwnership(async (req) => {
    const v = await db('ventures').where({ id: req.params.id }).first();
    return v?.user_id ?? null;
  }),
  upload.single('document'),
  async (req, res, next) => {
    try {
      if (!req.file) throw new AppError('No file uploaded', 422, 'no-file');

      const documentType = req.body.document_type;
      if (!documentType) throw new AppError('document_type is required', 422, 'missing-field');

      // Allowed document types
      const ALLOWED_TYPES = [
        'government_id', 'business_registration', 'tax_return', 'bank_statement',
        'audited_accounts', 'customer_contracts', 'mou', 'loi', 'operating_licence',
        'ip_registration', 'regulatory_certificate', 'cv', 'org_chart',
        'employee_contracts', 'pitch_deck',
      ];
      if (!ALLOWED_TYPES.includes(documentType)) {
        throw new AppError(`Invalid document type. Allowed: ${ALLOWED_TYPES.join(', ')}`, 422, 'invalid-document-type');
      }

      const filename = `documents/${req.params.id}/${documentType}/${Date.now()}_${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const file = bucket.file(filename);

      await file.save(req.file.buffer, {
        metadata: { contentType: req.file.mimetype },
        resumable: false,
      });

      // Store as GCS path — NEVER a public URL.
      // Access is always via getSignedUrl() with 1-hour expiry.
      const fileUrl = `gs://${env.GCS_BUCKET}/${filename}`;

      const [doc] = await db('venture_documents').insert({
        venture_id: req.params.id,
        document_type: documentType,
        file_url: fileUrl,
        verified: false,
        verification_tier: null,
      }).returning('*');

      await db('audit_log').insert({
        user_id: req.user!.id,
        action: 'venture.document.uploaded',
        resource_type: 'venture_document',
        resource_id: doc.id,
        new_value: JSON.stringify({ document_type: documentType, filename }),
        ip: req.ip,
        request_id: req.requestId,
      });

      res.status(201).json({
        document: doc,
        message: 'Document uploaded. It will be reviewed and verified within 24–48 hours.',
      });
    } catch (err) { next(err); }
  },
);

// ── GET /api/v1/ventures/:id/documents ───────────────────────
app.get(
  '/api/v1/ventures/:id/documents',
  rateLimiter(),
  authenticate,
  requireOwnership(async (req) => {
    const v = await db('ventures').where({ id: req.params.id }).first();
    return v?.user_id ?? null;
  }),
  async (req, res, next) => {
    try {
      const docs = await db('venture_documents')
        .where({ venture_id: req.params.id })
        .whereNull('deleted_at')
        .orderBy('created_at', 'desc');

      // Attach a fresh 1-hour signed URL to each document
      const withUrls = await Promise.all(docs.map(async (doc) => {
        try {
          const gcsPath = doc.file_url.startsWith('gs://')
            ? doc.file_url.replace(`gs://${env.GCS_BUCKET}/`, '')
            : gcsPathFromUrl(doc.file_url);
          const downloadUrl = await getSignedUrl(gcsPath);
          return { ...doc, file_url: undefined, downloadUrl, expiresIn: 3600 };
        } catch {
          return { ...doc, file_url: undefined, downloadUrl: null };
        }
      }));

      res.json({ documents: withUrls });
    } catch (err) { next(err); }
  },
);

// ── DELETE /api/v1/ventures/:id/documents/:did ───────────────
app.delete(
  '/api/v1/ventures/:id/documents/:did',
  rateLimiter(),
  authenticate,
  requireFounder,
  requireOwnership(async (req) => {
    const v = await db('ventures').where({ id: req.params.id }).first();
    return v?.user_id ?? null;
  }),
  auditLog('venture.document.deleted', 'venture_document'),
  async (req, res, next) => {
    try {
      const doc = await db('venture_documents')
        .where({ id: req.params.did, venture_id: req.params.id })
        .first();
      if (!doc) throw new NotFoundError('Document');

      // Cannot delete verified documents
      if (doc.verified) {
        throw new AppError('Verified documents cannot be deleted. Contact customer.service@ikonetu.com if you need to replace this document.', 400, 'cannot-delete-verified');
      }

      await db('venture_documents')
        .where({ id: req.params.did })
        .update({ deleted_at: new Date() });

      // Remove from GCS
      try {
        const path = doc.file_url.replace(`https://storage.googleapis.com/${env.GCS_BUCKET}/`, '');
        await bucket.file(path).delete();
      } catch { /* file may not exist */ }

      res.json({ success: true });
    } catch (err) { next(err); }
  },
);

// ── POST /api/v1/ventures/:id/social-connect ─────────────────
app.post(
  '/api/v1/ventures/:id/social-connect',
  rateLimiter(),
  authenticate,
  requireFounder,
  requireOwnership(async (req) => {
    const v = await db('ventures').where({ id: req.params.id }).first();
    return v?.user_id ?? null;
  }),
  validate({ body: ConnectSocialSchema }),
  async (req, res, next) => {
    try {
      const { platform, handle, url, followers, engagement_rate } = req.body as z.infer<typeof ConnectSocialSchema>;

      const [profile] = await db('venture_social_profiles')
        .insert({
          venture_id: req.params.id,
          platform, handle, url, followers,
          engagement_rate,
          last_scraped: new Date(),
        })
        .onConflict(['venture_id', 'platform'])
        .merge()
        .returning('*');

      res.status(201).json({ socialProfile: profile });
    } catch (err) { next(err); }
  },
);

// ── GET /api/v1/ventures/:id/social ──────────────────────────
app.get(
  '/api/v1/ventures/:id/social',
  rateLimiter(),
  authenticate,
  async (req, res, next) => {
    try {
      const profiles = await db('venture_social_profiles').where({ venture_id: req.params.id });
      res.json({ socialProfiles: profiles });
    } catch (err) { next(err); }
  },
);

// ── GET /api/v1/ventures/:id/timeline ────────────────────────
app.get(
  '/api/v1/ventures/:id/timeline',
  rateLimiter(),
  authenticate,
  requireOwnership(async (req) => {
    const v = await db('ventures').where({ id: req.params.id }).first();
    return v?.user_id ?? null;
  }),
  async (req, res, next) => {
    try {
      const [scoreHistory, documents, socialProfiles] = await Promise.all([
        db('score_history').where({ venture_id: req.params.id }).orderBy('snapshot_date', 'asc'),
        db('venture_documents').where({ venture_id: req.params.id }).whereNull('deleted_at').orderBy('created_at', 'desc'),
        db('venture_social_profiles').where({ venture_id: req.params.id }),
      ]);

      // Merge into chronological timeline
      const events = [
        ...scoreHistory.map(s => ({ type: 'score', date: s.snapshot_date, data: { score: s.total_score, tier: s.tier } })),
        ...documents.map(d => ({ type: 'document', date: d.created_at, data: { type: d.document_type, verified: d.verified } })),
      ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      res.json({ events, scoreHistory, documents, socialProfiles });
    } catch (err) { next(err); }
  },
);

app.get('/health', (_, res) => res.json({
  service: 'venture-service', status: 'ok', version: '1.0.0', timestamp: new Date().toISOString(),
}));

app.use(errorHandler);

const PORT = parseInt(env.PORT) + 5; // 3006

async function start() {
  env.NODE_ENV;
  const { initRedis } = await import('@ikonetu/shared/middleware');
  await initRedis();
  app.listen(PORT, () => console.log(`✅ venture-service running on port ${PORT}`));
}

start().catch((err) => { console.error(err); process.exit(1); });

export default app;
