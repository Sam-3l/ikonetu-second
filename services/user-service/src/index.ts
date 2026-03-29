import express from 'express';
import multer from 'multer';
import { Storage } from '@google-cloud/storage';
import sharp from 'sharp';
import { z } from 'zod';
import { env } from '@ikonetu/config';
import { db } from '@ikonetu/database';
import {
  requestId, rateLimiter, authenticate, requireRole,
  requireOwnership, validate, auditLog, errorHandler,
  AppError, NotFoundError, ForbiddenError,
} from '@ikonetu/shared/middleware';

const app = express();
app.use(express.json());
app.use(requestId);

// ── Google Cloud Storage ─────────────────────────────────────
const storage = new Storage();
const bucket = storage.bucket(env.GCS_BUCKET);

// Multer — memory storage, 5MB limit, images only
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(_, file, cb) {
    if (!file.mimetype.startsWith('image/')) {
      cb(new AppError('Only image files are accepted', 422, 'invalid-file-type'));
      return;
    }
    cb(null, true);
  },
});

// ── Schemas ──────────────────────────────────────────────────
const UpdateUserSchema = z.object({
  name:     z.string().min(2).max(200).optional(),
  country:  z.string().length(2).optional(),
  language: z.string().max(10).optional(),
});

const UpdateProfileSchema = z.object({
  bio:          z.string().max(1000).optional(),
  website:      z.string().url().optional().or(z.literal('')),
  location:     z.string().max(200).optional(),
  timezone:     z.string().max(100).optional(),
  social_links: z.record(z.string().url()).optional(),
});

const UpdatePreferencesSchema = z.object({
  notification_prefs: z.object({
    email:    z.boolean().optional(),
    push:     z.boolean().optional(),
    whatsapp: z.boolean().optional(),
    in_app:   z.boolean().optional(),
  }).optional(),
  language: z.string().max(10).optional(),
  currency: z.string().length(3).optional(),
});

const NotificationReadSchema = z.object({
  ids: z.array(z.string().uuid()).optional(),
});

// ── Helpers ──────────────────────────────────────────────────
async function getUserOrThrow(id: string) {
  const user = await db('users')
    .where({ id })
    .whereNull('deleted_at')
    .first();
  if (!user) throw new NotFoundError('User');
  return user;
}

function sanitiseUser(user: Record<string, unknown>) {
  const { ...safe } = user;
  delete safe.blacklisted;
  delete safe.blacklist_reason;
  return safe;
}

// ── GET /api/v1/users/:id ────────────────────────────────────
app.get(
  '/api/v1/users/:id',
  rateLimiter(),
  authenticate,
  async (req, res, next) => {
    try {
      const isSelf = req.user!.id === req.params.id;
      const isAdmin = req.user!.role === 'super_admin';

      if (!isSelf && !isAdmin) {
        // Other roles can only see limited public profile
        const user = await db('users')
          .where({ id: req.params.id, status: 'active' })
          .whereNull('deleted_at')
          .select('id', 'name', 'role', 'country', 'avatar_url', 'created_at')
          .first();
        if (!user) throw new NotFoundError('User');
        return res.json({ user });
      }

      const user = await getUserOrThrow(req.params.id);
      const profile = await db('user_profiles').where({ user_id: req.params.id }).first();
      const preferences = await db('user_preferences').where({ user_id: req.params.id }).first();

      await db('audit_log').insert({
        user_id: req.user!.id,
        action: 'user.read',
        resource_type: 'user',
        resource_id: req.params.id,
        ip: req.ip,
        request_id: req.requestId,
      });

      res.json({ user: isAdmin ? user : sanitiseUser(user), profile, preferences });
    } catch (err) { next(err); }
  },
);

// ── PUT /api/v1/users/:id ────────────────────────────────────
app.put(
  '/api/v1/users/:id',
  rateLimiter(),
  authenticate,
  requireOwnership(async (req) => {
    const u = await db('users').where({ id: req.params.id }).first();
    return u?.id ?? null;
  }),
  validate({ body: UpdateUserSchema }),
  auditLog('user.update', 'user'),
  async (req, res, next) => {
    try {
      const updates = req.body as z.infer<typeof UpdateUserSchema>;
      const [user] = await db('users')
        .where({ id: req.params.id })
        .whereNull('deleted_at')
        .update({ ...updates, updated_at: new Date() })
        .returning('*');

      if (!user) throw new NotFoundError('User');
      res.json({ user: sanitiseUser(user) });
    } catch (err) { next(err); }
  },
);

// ── DELETE /api/v1/users/:id (right to delete — GDPR Art. 17) ─
app.delete(
  '/api/v1/users/:id',
  rateLimiter({ max: 5 }),
  authenticate,
  requireOwnership(async (req) => {
    const u = await db('users').where({ id: req.params.id }).first();
    return u?.id ?? null;
  }),
  auditLog('user.delete_requested', 'user'),
  async (req, res, next) => {
    try {
      // Create GDPR deletion request — processed by compliance-service
      const dueBy = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

      // Check for legal holds that prevent immediate deletion
      const holds: string[] = [];

      const activeSubscription = await db('subscriptions')
        .where({ user_id: req.params.id, status: 'active' })
        .first();
      if (activeSubscription) holds.push('active_subscription');

      const openBookings = await db('marketplace_bookings')
        .where({ founder_id: req.params.id })
        .whereIn('status', ['pending', 'held', 'disputed'])
        .first();
      if (openBookings) holds.push('open_marketplace_bookings');

      const [gdprRequest] = await db('gdpr_requests').insert({
        user_id: req.params.id,
        request_type: 'deletion',
        status: holds.length > 0 ? 'processing' : 'pending',
        due_by: dueBy,
        legal_holds: JSON.stringify(holds),
        notes: holds.length > 0
          ? `Legal holds present: ${holds.join(', ')}. Partial deletion will proceed.`
          : 'No legal holds. Full deletion queued.',
      }).returning('*');

      // Soft-delete immediately for UX — data retention handles the rest
      await db('users')
        .where({ id: req.params.id })
        .update({ deleted_at: new Date(), status: 'banned' });

      // Revoke all sessions
      await db('user_sessions')
        .where({ user_id: req.params.id })
        .update({ revoked: true, revoked_at: new Date() });

      res.json({
        success: true,
        message: 'Account deletion request received. Your data will be processed within 30 days.',
        requestId: gdprRequest.id,
        dueBy: dueBy.toISOString(),
        legalHolds: holds,
      });
    } catch (err) { next(err); }
  },
);

// ── GET /api/v1/users/:id/preferences ───────────────────────
app.get(
  '/api/v1/users/:id/preferences',
  rateLimiter(),
  authenticate,
  requireOwnership(async (req) => req.params.id),
  async (req, res, next) => {
    try {
      const prefs = await db('user_preferences')
        .where({ user_id: req.params.id })
        .first();
      res.json({ preferences: prefs });
    } catch (err) { next(err); }
  },
);

// ── PUT /api/v1/users/:id/preferences ───────────────────────
app.put(
  '/api/v1/users/:id/preferences',
  rateLimiter(),
  authenticate,
  requireOwnership(async (req) => req.params.id),
  validate({ body: UpdatePreferencesSchema }),
  async (req, res, next) => {
    try {
      const updates = req.body as z.infer<typeof UpdatePreferencesSchema>;

      // Get existing prefs to merge notification_prefs
      const existing = await db('user_preferences').where({ user_id: req.params.id }).first();
      const mergedNotifPrefs = updates.notification_prefs
        ? { ...existing?.notification_prefs, ...updates.notification_prefs }
        : existing?.notification_prefs;

      const [prefs] = await db('user_preferences')
        .where({ user_id: req.params.id })
        .update({
          ...(mergedNotifPrefs && { notification_prefs: JSON.stringify(mergedNotifPrefs) }),
          ...(updates.language && { language: updates.language }),
          ...(updates.currency && { currency: updates.currency }),
          updated_at: new Date(),
        })
        .returning('*');

      res.json({ preferences: prefs });
    } catch (err) { next(err); }
  },
);

// ── GET /api/v1/users/:id/profile ────────────────────────────
app.get(
  '/api/v1/users/:id/profile',
  rateLimiter(),
  authenticate,
  async (req, res, next) => {
    try {
      const profile = await db('user_profiles').where({ user_id: req.params.id }).first();
      if (!profile) throw new NotFoundError('Profile');
      res.json({ profile });
    } catch (err) { next(err); }
  },
);

// ── PUT /api/v1/users/:id/profile ────────────────────────────
app.put(
  '/api/v1/users/:id/profile',
  rateLimiter(),
  authenticate,
  requireOwnership(async (req) => req.params.id),
  validate({ body: UpdateProfileSchema }),
  auditLog('user.profile.update', 'user_profile'),
  async (req, res, next) => {
    try {
      const updates = req.body as z.infer<typeof UpdateProfileSchema>;
      const [profile] = await db('user_profiles')
        .where({ user_id: req.params.id })
        .update({ ...updates, updated_at: new Date() })
        .returning('*');
      res.json({ profile });
    } catch (err) { next(err); }
  },
);

// ── POST /api/v1/users/:id/avatar ────────────────────────────
app.post(
  '/api/v1/users/:id/avatar',
  rateLimiter({ max: 10 }),
  authenticate,
  requireOwnership(async (req) => req.params.id),
  upload.single('avatar'),
  async (req, res, next) => {
    try {
      if (!req.file) throw new AppError('No file uploaded', 422, 'no-file');

      // Resize and optimise with Sharp — 256×256 webp
      const optimised = await sharp(req.file.buffer)
        .resize(256, 256, { fit: 'cover', position: 'centre' })
        .webp({ quality: 85 })
        .toBuffer();

      const filename = `avatars/${req.params.id}/${Date.now()}.webp`;
      const file = bucket.file(filename);

      await file.save(optimised, {
        metadata: { contentType: 'image/webp' },
        resumable: false,
      });

      // Make publicly readable
      await file.makePublic();

      const avatarUrl = `https://storage.googleapis.com/${env.GCS_BUCKET}/${filename}`;

      // Delete old avatar if present
      const user = await db('users').where({ id: req.params.id }).first();
      if (user?.avatar_url) {
        try {
          const oldPath = user.avatar_url.replace(`https://storage.googleapis.com/${env.GCS_BUCKET}/`, '');
          await bucket.file(oldPath).delete();
        } catch { /* old file may not exist */ }
      }

      await db('users')
        .where({ id: req.params.id })
        .update({ avatar_url: avatarUrl, updated_at: new Date() });

      await db('audit_log').insert({
        user_id: req.user!.id,
        action: 'user.avatar.upload',
        resource_type: 'user',
        resource_id: req.params.id,
        new_value: JSON.stringify({ avatarUrl }),
        ip: req.ip,
        request_id: req.requestId,
      });

      res.json({ success: true, avatarUrl });
    } catch (err) { next(err); }
  },
);

// ── GET /api/v1/users/:id/notifications ─────────────────────
app.get(
  '/api/v1/users/:id/notifications',
  rateLimiter(),
  authenticate,
  requireOwnership(async (req) => req.params.id),
  async (req, res, next) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
      const unreadOnly = req.query.unread === 'true';

      const query = db('notifications')
        .where({ user_id: req.params.id })
        .orderBy('created_at', 'desc')
        .limit(limit)
        .offset((page - 1) * limit);

      if (unreadOnly) query.where({ read: false });

      const [notifications, [{ count }]] = await Promise.all([
        query.select('*'),
        db('notifications')
          .where({ user_id: req.params.id, read: false })
          .count('id as count'),
      ]);

      res.json({ notifications, unreadCount: parseInt(count as string), page, limit });
    } catch (err) { next(err); }
  },
);

// ── PUT /api/v1/users/:id/notifications/:nid ─────────────────
app.put(
  '/api/v1/users/:id/notifications/:nid',
  rateLimiter(),
  authenticate,
  requireOwnership(async (req) => req.params.id),
  async (req, res, next) => {
    try {
      await db('notifications')
        .where({ id: req.params.nid, user_id: req.params.id })
        .update({ read: true, read_at: new Date() });
      res.json({ success: true });
    } catch (err) { next(err); }
  },
);

// ── PUT /api/v1/users/:id/notifications/read-all ─────────────
app.put(
  '/api/v1/users/:id/notifications/read-all',
  rateLimiter(),
  authenticate,
  requireOwnership(async (req) => req.params.id),
  async (req, res, next) => {
    try {
      const count = await db('notifications')
        .where({ user_id: req.params.id, read: false })
        .update({ read: true, read_at: new Date() });
      res.json({ success: true, markedRead: count });
    } catch (err) { next(err); }
  },
);

// ── GET /api/v1/users/:id/activity ───────────────────────────
app.get(
  '/api/v1/users/:id/activity',
  rateLimiter(),
  authenticate,
  requireOwnership(async (req) => req.params.id),
  async (req, res, next) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 30, 100);
      const events = await db('audit_log')
        .where({ user_id: req.params.id })
        .whereIn('action', [
          'user.login', 'user.profile.update', 'user.avatar.upload',
          'venture.created', 'venture.updated',
          'score.calculated', 'score.tier.changed',
          'user.logout',
        ])
        .orderBy('created_at', 'desc')
        .limit(limit)
        .select('id', 'action', 'resource_type', 'resource_id', 'created_at');

      res.json({ events });
    } catch (err) { next(err); }
  },
);

// ── GET /api/v1/users/:id/export (GDPR data portability) ─────
app.get(
  '/api/v1/users/:id/export',
  rateLimiter({ max: 3 }),
  authenticate,
  requireOwnership(async (req) => req.params.id),
  async (req, res, next) => {
    try {
      const userId = req.params.id;

      const [user, profile, preferences, consents, ventures, notifications] = await Promise.all([
        db('users').where({ id: userId }).first(),
        db('user_profiles').where({ user_id: userId }).first(),
        db('user_preferences').where({ user_id: userId }).first(),
        db('user_consents').where({ user_id: userId }).select('consent_type', 'granted', 'granted_at', 'revoked_at', 'version'),
        db('ventures').where({ user_id: userId }).whereNull('deleted_at').select('id', 'name', 'sector', 'country', 'created_at'),
        db('notifications').where({ user_id: userId }).orderBy('created_at', 'desc').limit(100),
      ]);

      // Log the export
      await db('audit_log').insert({
        user_id: req.user!.id,
        action: 'user.data_export',
        resource_type: 'user',
        resource_id: userId,
        ip: req.ip,
        request_id: req.requestId,
      });

      const exportData = {
        exportedAt: new Date().toISOString(),
        exportedBy: 'IkonetU Technology Limited',
        legalBasis: 'GDPR Article 20 — Right to data portability',
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          country: user.country,
          createdAt: user.created_at,
        },
        profile,
        preferences,
        consents,
        ventures,
        recentNotifications: notifications,
      };

      res.setHeader('Content-Disposition', `attachment; filename="ikonetu-data-export-${userId}.json"`);
      res.setHeader('Content-Type', 'application/json');
      res.json(exportData);
    } catch (err) { next(err); }
  },
);

// ── Admin: list all users ─────────────────────────────────────
app.get(
  '/api/v1/admin/users',
  rateLimiter(),
  authenticate,
  requireRole('super_admin'),
  async (req, res, next) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const role = req.query.role as string | undefined;
      const status = req.query.status as string | undefined;
      const search = req.query.search as string | undefined;

      const query = db('users').whereNull('deleted_at');
      if (role) query.where({ role });
      if (status) query.where({ status });
      if (search) {
        query.where((q) => {
          q.where('email', 'ilike', `%${search}%`)
           .orWhere('name', 'ilike', `%${search}%`);
        });
      }

      const [users, [{ count }]] = await Promise.all([
        query.clone()
          .select('id', 'email', 'name', 'role', 'country', 'status', 'last_login', 'created_at')
          .orderBy('created_at', 'desc')
          .limit(limit)
          .offset((page - 1) * limit),
        query.clone().count('id as count'),
      ]);

      res.json({ users, total: parseInt(count as string), page, limit });
    } catch (err) { next(err); }
  },
);

// ── Admin: suspend user ───────────────────────────────────────
app.post(
  '/api/v1/admin/users/:id/suspend',
  rateLimiter(),
  authenticate,
  requireRole('super_admin'),
  auditLog('admin.user.suspend', 'user'),
  async (req, res, next) => {
    try {
      const { reason } = req.body as { reason?: string };
      await db('users')
        .where({ id: req.params.id })
        .update({ status: 'suspended', updated_at: new Date() });

      await db('user_sessions')
        .where({ user_id: req.params.id })
        .update({ revoked: true, revoked_at: new Date() });

      if (reason) {
        await db('notifications').insert({
          user_id: req.params.id,
          type: 'account.suspended',
          title: 'Your account has been suspended',
          body: reason || 'Your account has been suspended. Contact customer.service@ikonetu.com for assistance.',
          data: JSON.stringify({ reason }),
        });
      }

      res.json({ success: true });
    } catch (err) { next(err); }
  },
);

// ── Admin: reinstate user ─────────────────────────────────────
app.post(
  '/api/v1/admin/users/:id/reinstate',
  rateLimiter(),
  authenticate,
  requireRole('super_admin'),
  auditLog('admin.user.reinstate', 'user'),
  async (req, res, next) => {
    try {
      await db('users')
        .where({ id: req.params.id })
        .update({ status: 'active', updated_at: new Date() });
      res.json({ success: true });
    } catch (err) { next(err); }
  },
);

// ── Health ────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({
  service: 'user-service', status: 'ok', version: '1.0.0',
  timestamp: new Date().toISOString(),
}));

app.use(errorHandler);

const PORT = parseInt(env.PORT) + 1; // 3002

async function start() {
  env.NODE_ENV;
  const { initRedis } = await import('@ikonetu/shared/middleware');
  await initRedis();
  app.listen(PORT, () => {
    console.log(`✅ user-service running on port ${PORT}`);
  });
}

start().catch((err) => { console.error(err); process.exit(1); });

export default app;
