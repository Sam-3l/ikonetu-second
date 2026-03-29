import express from 'express';
import { z } from 'zod';
import { env } from '@ikonetu/config';
import { db } from '@ikonetu/database';
import {
  requestId, rateLimiter, authenticate, requireRole,
  requireOwnership, validate, auditLog, errorHandler,
  AppError, NotFoundError,
} from '@ikonetu/shared/middleware';

const app = express();
app.use(express.json());
app.use(requestId);

// ── Consent types with metadata ──────────────────────────────
const CONSENT_TYPES = {
  'marketing_email':       { required: false, description: 'Marketing and promotional emails', lawfulBasis: 'consent' },
  'score_share_investors': { required: false, description: 'Share your IkonetU Score with investors', lawfulBasis: 'consent' },
  'score_share_lenders':   { required: false, description: 'Share your Bankability Score with lenders', lawfulBasis: 'consent' },
  'lender_pool':           { required: false, description: 'Appear in the lender pre-qualified borrower pool', lawfulBasis: 'consent' },
  'open_banking':          { required: false, description: 'Connect bank account via open banking (Mono/Okra)', lawfulBasis: 'consent' },
  'social_profile_scan':   { required: false, description: 'Automated scan of social media profiles for scoring', lawfulBasis: 'legitimate_interests' },
  'analytics':             { required: false, description: 'Platform usage analytics for service improvement', lawfulBasis: 'legitimate_interests' },
  'push_notifications':    { required: false, description: 'Push notifications to your device', lawfulBasis: 'consent' },
  'terms_v2':              { required: true,  description: 'Terms and Conditions v2.0', lawfulBasis: 'contract' },
  'privacy_policy':        { required: true,  description: 'Privacy Policy', lawfulBasis: 'contract' },
} as const;

type ConsentType = keyof typeof CONSENT_TYPES;

// ── Schemas ──────────────────────────────────────────────────
const GrantConsentSchema = z.object({
  consent_type: z.enum(Object.keys(CONSENT_TYPES) as [ConsentType, ...ConsentType[]]),
  version: z.string().min(1).max(20).default('1.0'),
  metadata: z.record(z.unknown()).optional(),
});

const RevokeConsentSchema = z.object({
  reason: z.string().max(500).optional(),
});

// ── POST /api/v1/users/:id/consents ──────────────────────────
app.post(
  '/api/v1/users/:id/consents',
  rateLimiter(),
  authenticate,
  requireOwnership(async (req) => req.params.id),
  validate({ body: GrantConsentSchema }),
  async (req, res, next) => {
    try {
      const { consent_type, version, metadata } = req.body as z.infer<typeof GrantConsentSchema>;
      const userId = req.params.id;
      const consentMeta = CONSENT_TYPES[consent_type as ConsentType];

      // Upsert consent — if already exists, update it
      const existing = await db('user_consents')
        .where({ user_id: userId, consent_type })
        .first();

      let consent;
      if (existing) {
        [consent] = await db('user_consents')
          .where({ id: existing.id })
          .update({
            granted: true,
            granted_at: new Date(),
            revoked_at: null,
            ip: req.ip,
            version,
            updated_at: new Date(),
          })
          .returning('*');
      } else {
        [consent] = await db('user_consents').insert({
          user_id: userId,
          consent_type,
          granted: true,
          granted_at: new Date(),
          ip: req.ip,
          version,
        }).returning('*');
      }

      await db('audit_log').insert({
        user_id: req.user!.id,
        action: 'consent.granted',
        resource_type: 'user_consent',
        resource_id: consent.id,
        new_value: JSON.stringify({ consent_type, version, lawfulBasis: consentMeta.lawfulBasis }),
        ip: req.ip,
        request_id: req.requestId,
      });

      res.status(201).json({
        consent,
        description: consentMeta.description,
        lawfulBasis: consentMeta.lawfulBasis,
      });
    } catch (err) { next(err); }
  },
);

// ── GET /api/v1/users/:id/consents ───────────────────────────
app.get(
  '/api/v1/users/:id/consents',
  rateLimiter(),
  authenticate,
  requireOwnership(async (req) => req.params.id),
  async (req, res, next) => {
    try {
      const consents = await db('user_consents')
        .where({ user_id: req.params.id })
        .orderBy('consent_type');

      // Enrich with metadata
      const enriched = consents.map((c) => ({
        ...c,
        description: CONSENT_TYPES[c.consent_type as ConsentType]?.description,
        lawfulBasis: CONSENT_TYPES[c.consent_type as ConsentType]?.lawfulBasis,
        required: CONSENT_TYPES[c.consent_type as ConsentType]?.required,
      }));

      // Also show what consents they haven't yet granted
      const missingConsents = Object.entries(CONSENT_TYPES)
        .filter(([type]) => !consents.find((c) => c.consent_type === type))
        .map(([type, meta]) => ({
          consent_type: type,
          granted: false,
          ...meta,
        }));

      res.json({ consents: enriched, missing: missingConsents });
    } catch (err) { next(err); }
  },
);

// ── DELETE /api/v1/users/:id/consents/:type (revoke) ─────────
app.delete(
  '/api/v1/users/:id/consents/:type',
  rateLimiter(),
  authenticate,
  requireOwnership(async (req) => req.params.id),
  validate({ body: RevokeConsentSchema }),
  async (req, res, next) => {
    try {
      const { type } = req.params;

      // Cannot revoke required consents
      const meta = CONSENT_TYPES[type as ConsentType];
      if (!meta) throw new AppError(`Unknown consent type: ${type}`, 422, 'invalid-consent-type');
      if (meta.required) {
        throw new AppError(
          `Cannot revoke ${type} — this consent is required for the platform to operate. To remove this consent, close your account.`,
          400,
          'consent-required',
        );
      }

      const [consent] = await db('user_consents')
        .where({ user_id: req.params.id, consent_type: type })
        .update({ granted: false, revoked_at: new Date(), updated_at: new Date() })
        .returning('*');

      if (!consent) throw new NotFoundError('Consent');

      await db('audit_log').insert({
        user_id: req.user!.id,
        action: 'consent.revoked',
        resource_type: 'user_consent',
        resource_id: consent.id,
        old_value: JSON.stringify({ consent_type: type, previously_granted: true }),
        new_value: JSON.stringify({ consent_type: type, granted: false, reason: req.body.reason }),
        ip: req.ip,
        request_id: req.requestId,
      });

      // Downstream effects of consent revocation
      if (type === 'score_share_investors') {
        await db('investor_matches')
          .where({ venture_id: db('ventures').where({ user_id: req.params.id }).select('id') })
          .update({ status: 'rejected' });
      }

      if (type === 'lender_pool') {
        await db('lender_portfolios')
          .where({ venture_id: db('ventures').where({ user_id: req.params.id }).select('id') })
          .where({ status: 'monitoring' })
          .update({ monitoring_active: false });
      }

      res.json({
        success: true,
        message: `Consent for ${meta.description} has been revoked.`,
        effectiveAt: new Date().toISOString(),
      });
    } catch (err) { next(err); }
  },
);

// ── GET /api/v1/consents/types (public — list all consent types) ─
app.get('/api/v1/consents/types', rateLimiter(), async (req, res, next) => {
  try {
    res.json({
      types: Object.entries(CONSENT_TYPES).map(([type, meta]) => ({ type, ...meta })),
    });
  } catch (err) { next(err); }
});

// ── GDPR request queue (admin) ────────────────────────────────
app.get(
  '/api/v1/admin/compliance/gdpr-requests',
  rateLimiter(),
  authenticate,
  requireRole('super_admin'),
  async (req, res, next) => {
    try {
      const status = req.query.status as string || 'pending';
      const requests = await db('gdpr_requests')
        .where({ status })
        .orderBy('due_by', 'asc')
        .join('users', 'gdpr_requests.user_id', 'users.id')
        .select(
          'gdpr_requests.*',
          'users.email', 'users.name',
        );

      // Flag overdue requests
      const now = new Date();
      const enriched = requests.map((r) => ({
        ...r,
        overdue: new Date(r.due_by) < now && r.status !== 'completed',
        daysRemaining: Math.ceil((new Date(r.due_by).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
      }));

      res.json({ requests: enriched });
    } catch (err) { next(err); }
  },
);

// ── Process GDPR deletion request (admin) ────────────────────
app.post(
  '/api/v1/admin/compliance/gdpr-requests/:id/process',
  rateLimiter(),
  authenticate,
  requireRole('super_admin'),
  auditLog('admin.gdpr.process', 'gdpr_request'),
  async (req, res, next) => {
    try {
      const request = await db('gdpr_requests').where({ id: req.params.id }).first();
      if (!request) throw new NotFoundError('GDPR request');

      const userId = request.user_id;
      const retained: string[] = [];

      // Full deletion cascade — order matters (FK constraints)
      if (request.request_type === 'deletion') {
        // Anonymise audit log entries (cannot delete — legal requirement)
        await db('audit_log')
          .where({ user_id: userId })
          .update({ user_id: null });

        // Score history — anonymise, do not delete (7yr financial record)
        const ventures = await db('ventures').where({ user_id: userId }).select('id');
        const ventureIds = ventures.map((v) => v.id);
        if (ventureIds.length) {
          await db('score_history')
            .whereIn('venture_id', ventureIds)
            .update({ venture_id: db.raw('venture_id') }); // stays — venture soft deleted
          retained.push('score_history (7yr retention)');
        }

        // Delete personal data
        await db('user_consents').where({ user_id: userId }).delete();
        await db('user_sessions').where({ user_id: userId }).delete();
        await db('notifications').where({ user_id: userId }).delete();
        await db('user_preferences').where({ user_id: userId }).delete();
        await db('user_profiles').where({ user_id: userId }).delete();

        // Soft delete user — nullify PII
        await db('users').where({ id: userId }).update({
          email: null,
          phone: null,
          name: '[deleted]',
          avatar_url: null,
          deleted_at: new Date(),
          status: 'banned',
        });

        await db('gdpr_requests')
          .where({ id: req.params.id })
          .update({
            status: 'completed',
            completed_at: new Date(),
            notes: `Deletion completed. Retained: ${retained.join(', ') || 'nothing'}`,
          });
      }

      res.json({ success: true, userId, retained });
    } catch (err) { next(err); }
  },
);

app.get('/health', (_, res) => res.json({
  service: 'consent-service', status: 'ok', version: '1.0.0',
  timestamp: new Date().toISOString(),
}));

app.use(errorHandler);

const PORT = parseInt(env.PORT) + 3; // 3004

async function start() {
  env.NODE_ENV;
  const { initRedis } = await import('@ikonetu/shared/middleware');
  await initRedis();
  app.listen(PORT, () => console.log(`✅ consent-service running on port ${PORT}`));
}

start().catch((err) => { console.error(err); process.exit(1); });

export default app;
