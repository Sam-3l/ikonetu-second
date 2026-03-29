import express from 'express';
import { z } from 'zod';
import { env } from '@ikonetu/config';
import { db } from '@ikonetu/database';
import {
  requestId, rateLimiter, authenticate, requireRole,
  validate, auditLog, errorHandler, AppError, NotFoundError,
} from '@ikonetu/shared/middleware';

// ════════════════════════════════════════════════════════════
// GOLDEN EYE — ADMIN SERVICE
// LIGHT MODE ONLY. ALWAYS. NO EXCEPTIONS.
// ════════════════════════════════════════════════════════════

const app = express();
app.use(express.json());
app.use(requestId);

// Design invariant enforced in every response header
app.use((_, res, next) => {
  res.setHeader('X-IkonetU-Theme', 'light-mode-only');
  res.setHeader('X-IkonetU-Dark-Mode', 'disabled-permanently');
  next();
});

// ── All admin routes require super_admin ─────────────────────
app.use('/api/v1/admin', authenticate, requireRole('super_admin'));

// ════════════════════════════════════════════════════════════
// OVERVIEW DASHBOARD
// ════════════════════════════════════════════════════════════

app.get('/api/v1/admin/dashboard', async (req, res, next) => {
  try {
    const today = new Date(); today.setHours(0,0,0,0);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    const [
      totalUsers, newUsersToday, activeSubscriptions,
      revenueToday, revenueMtd,
      scoresCalculated, pendingVerifications,
      acxmOpportunities, acxmThreats,
      gdprRequests, openDisputes,
    ] = await Promise.all([
      db('users').whereNull('deleted_at').count('id as count').first(),
      db('users').where('created_at', '>=', today).whereNull('deleted_at').count('id as count').first(),
      db('subscriptions').whereIn('status',['active','trialing']).count('id as count').first(),
      db('revenue_events').where('created_at', '>=', today).sum('amount as total').first(),
      db('revenue_events').where('created_at', '>=', monthStart).sum('amount as total').first(),
      db('scores').where('created_at', '>=', today).count('id as count').first(),
      db('venture_documents').where({ verified: false }).whereNull('deleted_at').count('id as count').first(),
      db('acxm_signals').where({ signal_class: 'opportunity', status: 'new' }).count('id as count').first(),
      db('acxm_signals').where({ signal_class: 'threat', status: 'new' }).count('id as count').first(),
      db('gdpr_requests').where({ status: 'pending' }).count('id as count').first(),
      db('marketplace_bookings').where({ status: 'disputed' }).count('id as count').first(),
    ]);

    res.json({
      platform: {
        totalUsers: parseInt(String(totalUsers?.count||0)),
        newUsersToday: parseInt(String(newUsersToday?.count||0)),
        activeSubscriptions: parseInt(String(activeSubscriptions?.count||0)),
      },
      revenue: {
        today: parseFloat(String(revenueToday?.total||0)),
        mtd: parseFloat(String(revenueMtd?.total||0)),
        currency: 'GBP',
      },
      scoring: {
        calculatedToday: parseInt(String(scoresCalculated?.count||0)),
        pendingDocumentVerifications: parseInt(String(pendingVerifications?.count||0)),
      },
      acxm: {
        openOpportunities: parseInt(String(acxmOpportunities?.count||0)),
        openThreats: parseInt(String(acxmThreats?.count||0)),
      },
      compliance: {
        pendingGdprRequests: parseInt(String(gdprRequests?.count||0)),
        openDisputes: parseInt(String(openDisputes?.count||0)),
      },
      theme: 'light-mode-only',
      generatedAt: new Date().toISOString(),
    });
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════
// USER MANAGEMENT
// ════════════════════════════════════════════════════════════

app.get('/api/v1/admin/users', async (req, res, next) => {
  try {
    const page = parseInt(req.query.page as string)||1;
    const limit = Math.min(parseInt(req.query.limit as string)||50, 100);
    const { role, status, country, search } = req.query as Record<string, string>;

    const query = db('users').whereNull('deleted_at');
    if (role)   query.where({ role });
    if (status) query.where({ status });
    if (country) query.where({ country });
    if (search) {
      query.where(q => q.where('email','ilike',`%${search}%`).orWhere('name','ilike',`%${search}%`));
    }

    const [users, [{ count }]] = await Promise.all([
      query.clone().select(
        'id','email','name','role','country','status','last_login','created_at','onboarding_completed'
      ).orderBy('created_at','desc').limit(limit).offset((page-1)*limit),
      query.clone().count('id as count'),
    ]);

    // Enrich with score for founders
    const enriched = await Promise.all(users.map(async (u) => {
      if (u.role !== 'founder') return u;
      const venture = await db('ventures').where({ user_id: u.id }).whereNull('deleted_at').first();
      const score = venture ? await db('scores').where({ venture_id: venture.id, is_current: true }).first() : null;
      return { ...u, score: score ? { total: score.total_score, tier: score.tier } : null };
    }));

    res.json({ users: enriched, total: parseInt(String(count)), page, limit });
  } catch (err) { next(err); }
});

app.get('/api/v1/admin/users/:id', async (req, res, next) => {
  try {
    const user = await db('users').where({ id: req.params.id }).first();
    if (!user) throw new NotFoundError('User');

    const [profile, preferences, consents, sessions, gdprRequests, auditTrail] = await Promise.all([
      db('user_profiles').where({ user_id: user.id }).first(),
      db('user_preferences').where({ user_id: user.id }).first(),
      db('user_consents').where({ user_id: user.id }),
      db('user_sessions').where({ user_id: user.id }).orderBy('created_at','desc').limit(10),
      db('gdpr_requests').where({ user_id: user.id }),
      db('audit_log').where({ user_id: user.id }).orderBy('created_at','desc').limit(50),
    ]);

    // Ventures and scores
    const ventures = await db('ventures').where({ user_id: user.id }).whereNull('deleted_at');
    const venturesWithScores = await Promise.all(ventures.map(async v => ({
      ...v,
      currentScore: await db('scores').where({ venture_id: v.id, is_current: true }).first(),
      scoreHistory: await db('score_history').where({ venture_id: v.id }).orderBy('snapshot_date','desc').limit(12),
    })));

    res.json({ user, profile, preferences, consents, sessions, gdprRequests, auditTrail, ventures: venturesWithScores });
  } catch (err) { next(err); }
});

app.put('/api/v1/admin/users/:id',
  validate({ body: z.object({
    status: z.enum(['active','suspended','banned']).optional(),
    role: z.enum(['founder','investor','provider','lender','university','super_admin']).optional(),
    name: z.string().optional(),
  })}),
  auditLog('admin.user.update', 'user'),
  async (req, res, next) => {
    try {
      const [user] = await db('users')
        .where({ id: req.params.id })
        .update({ ...req.body, updated_at: new Date() })
        .returning('*');
      if (!user) throw new NotFoundError('User');
      res.json({ user });
    } catch (err) { next(err); }
  }
);

// Impersonation — read-only, fully logged
app.post('/api/v1/admin/users/:id/impersonate',
  auditLog('admin.impersonation.started', 'user'),
  async (req, res, next) => {
    try {
      const target = await db('users').where({ id: req.params.id }).first();
      if (!target) throw new NotFoundError('User');

      // Log prominently
      await db('audit_log').insert({
        user_id: req.user!.id,
        action: 'admin.impersonation.started',
        resource_type: 'user',
        resource_id: req.params.id,
        new_value: JSON.stringify({ adminId: req.user!.id, targetUserId: req.params.id, readOnly: true }),
        ip: req.ip,
        request_id: req.requestId,
      });

      // Issue a special read-only impersonation token (30 min, read-only flag)
      const jwt = await import('jsonwebtoken');
      const impersonationToken = jwt.default.sign(
        {
          sub: req.params.id,
          email: target.email,
          role: target.role,
          status: target.status,
          sessionId: 'impersonation',
          isImpersonation: true,
          impersonatedBy: req.user!.id,
          readOnly: true,
        },
        env.JWT_SECRET,
        { expiresIn: 1800, issuer: 'ikonetu-admin' }
      );

      res.json({
        impersonationToken,
        warning: 'IMPERSONATION ACTIVE. All actions are read-only and fully logged. This token expires in 30 minutes.',
        targetUser: { id: target.id, email: target.email, role: target.role },
        adminUser: req.user!.id,
      });
    } catch (err) { next(err); }
  }
);

// ════════════════════════════════════════════════════════════
// VENTURE MANAGEMENT + VERIFICATION QUEUE
// ════════════════════════════════════════════════════════════

app.get('/api/v1/admin/ventures', async (req, res, next) => {
  try {
    const page = parseInt(req.query.page as string)||1;
    const limit = Math.min(parseInt(req.query.limit as string)||50,100);
    const { tier, country, sector } = req.query as Record<string, string>;

    const query = db('ventures as v')
      .join('users as u', 'v.user_id', 'u.id')
      .leftJoin('scores as s', function() { this.on('s.venture_id','v.id').andOn('s.is_current', db.raw('true')); })
      .whereNull('v.deleted_at');

    if (tier)    query.where('s.tier', tier);
    if (country) query.where('v.country', country);
    if (sector)  query.where('v.sector', sector);

    const [ventures, [{ count }]] = await Promise.all([
      query.clone()
        .select('v.id','v.name','v.sector','v.country','v.stage','v.created_at',
                'u.email','u.name as founder_name',
                's.total_score','s.tier','s.confidence_pct')
        .orderBy('v.created_at','desc').limit(limit).offset((page-1)*limit),
      query.clone().count('v.id as count'),
    ]);

    res.json({ ventures, total: parseInt(String(count)), page, limit });
  } catch (err) { next(err); }
});

// Document verification queue
app.get('/api/v1/admin/ventures/verification-queue', async (req, res, next) => {
  try {
    const docs = await db('venture_documents as d')
      .join('ventures as v', 'd.venture_id', 'v.id')
      .join('users as u', 'v.user_id', 'u.id')
      .where({ 'd.verified': false })
      .whereNull('d.deleted_at')
      .select('d.id','d.document_type','d.file_url','d.created_at',
              'v.id as venture_id','v.name as venture_name',
              'u.email as founder_email','u.name as founder_name')
      .orderBy('d.created_at','asc')
      .limit(100);

    res.json({ queue: docs, total: docs.length });
  } catch (err) { next(err); }
});

// Approve document
app.post('/api/v1/admin/ventures/:id/documents/:docId/approve',
  auditLog('admin.document.approved', 'venture_document'),
  async (req, res, next) => {
    try {
      const { verificationTier } = req.body as { verificationTier: number };
      if (!verificationTier || verificationTier < 1 || verificationTier > 4) {
        throw new AppError('verificationTier must be 1–4', 422, 'invalid-tier');
      }

      await db('venture_documents').where({ id: req.params.docId, venture_id: req.params.id })
        .update({ verified: true, verification_tier: verificationTier, verified_at: new Date(), verifier: req.user!.id });

      res.json({ success: true });
    } catch (err) { next(err); }
  }
);

// Reject document
app.post('/api/v1/admin/ventures/:id/documents/:docId/reject',
  auditLog('admin.document.rejected', 'venture_document'),
  async (req, res, next) => {
    try {
      const { reason } = req.body as { reason: string };
      await db('venture_documents').where({ id: req.params.docId }).update({ deleted_at: new Date() });

      const doc = await db('venture_documents').where({ id: req.params.docId }).first();
      if (doc) {
        const venture = await db('ventures').where({ id: doc.venture_id }).first();
        if (venture) {
          await db('notifications').insert({
            user_id: venture.user_id,
            type: 'document.rejected',
            title: 'Document rejected',
            body: reason || 'Your document was rejected. Please re-upload with the correct file.',
            data: JSON.stringify({ documentType: doc.document_type, reason }),
          });
        }
      }

      res.json({ success: true });
    } catch (err) { next(err); }
  }
);

// Force score recalculation
app.post('/api/v1/admin/users/:id/recalculate-score',
  auditLog('admin.score.recalculate', 'venture'),
  async (req, res, next) => {
    try {
      const venture = await db('ventures').where({ user_id: req.params.id }).whereNull('deleted_at').first();
      if (!venture) throw new NotFoundError('Venture');

      // Call scoring service internally
      const axios = await import('axios');
      const response = await axios.default.post(
        `${env.SCORING_SERVICE_URL}/api/v1/scoring/calculate/${venture.id}`,
        {},
        { headers: { 'Authorization': `Bearer ${req.headers.authorization?.slice(7)}` } }
      );

      res.json(response.data);
    } catch (err) { next(err); }
  }
);

// ════════════════════════════════════════════════════════════
// SCORING ENGINE MANAGEMENT
// ════════════════════════════════════════════════════════════

app.get('/api/v1/admin/scoring/rules', async (req, res, next) => {
  try {
    const rules = await db('scoring_rules').orderBy('category').orderBy('signal_type');
    res.json({ rules });
  } catch (err) { next(err); }
});

app.put('/api/v1/admin/scoring/rules/:id',
  validate({ body: z.object({
    weight: z.number().min(0).max(1).optional(),
    max_points: z.number().min(0).optional(),
    active: z.boolean().optional(),
    rule_logic: z.record(z.unknown()).optional(),
  })}),
  auditLog('admin.scoring.rule.update', 'scoring_rule'),
  async (req, res, next) => {
    try {
      const [rule] = await db('scoring_rules')
        .where({ id: req.params.id })
        .update({ ...req.body, version: db.raw('version + 1'), updated_at: new Date() })
        .returning('*');
      if (!rule) throw new NotFoundError('Scoring rule');
      res.json({ rule });
    } catch (err) { next(err); }
  }
);

// Score simulation — what-if analysis
app.post('/api/v1/admin/scoring/simulate', async (req, res, next) => {
  try {
    const { ruleId, newWeight, newMaxPoints } = req.body as {
      ruleId: string; newWeight?: number; newMaxPoints?: number;
    };

    const rule = await db('scoring_rules').where({ id: ruleId }).first();
    if (!rule) throw new NotFoundError('Scoring rule');

    // Count affected ventures
    const affectedSignals = await db('score_signals').where({ signal_name: rule.signal_type }).count('id as count').first();
    const affected = parseInt(String(affectedSignals?.count||0));

    const weightDelta = newWeight ? newWeight - rule.weight : 0;
    const pointsDelta = newMaxPoints ? newMaxPoints - rule.max_points : 0;

    res.json({
      rule: { id: ruleId, currentWeight: rule.weight, currentMaxPoints: rule.max_points },
      simulation: {
        affectedVentures: affected,
        weightDelta,
        pointsDelta,
        estimatedAvgScoreImpact: Math.round(pointsDelta * rule.weight),
        warning: affected > 1000 ? 'This change affects >1000 ventures. Consider a phased rollout.' : null,
      },
    });
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════
// PLATFORM CONFIG & FEATURE FLAGS
// ════════════════════════════════════════════════════════════

app.get('/api/v1/admin/config', async (req, res, next) => {
  try {
    const config = await db('platform_config').select('key','value','updated_at');
    res.json({ config });
  } catch (err) { next(err); }
});

app.put('/api/v1/admin/config/:key',
  auditLog('admin.config.update', 'platform_config'),
  async (req, res, next) => {
    try {
      const { key } = req.params;
      const { value } = req.body as { value: unknown };

      // Hard-locked config — cannot change these via API
      const LOCKED = ['r12_commission_pct', 'r11_active', 'dark_mode_enabled'];
      if (LOCKED.includes(key)) {
        throw new AppError(
          `${key} is a hard-locked system invariant. It cannot be changed via the admin API. A code deploy with multi-party approval is required.`,
          403, 'locked-config'
        );
      }

      await db('platform_config')
        .where({ key })
        .update({ value: JSON.stringify(value), updated_by: req.user!.id, updated_at: new Date() });

      res.json({ success: true, key, value });
    } catch (err) { next(err); }
  }
);

app.get('/api/v1/admin/feature-flags', async (req, res, next) => {
  try {
    const flags = await db('feature_flags').select('*');
    res.json({ flags });
  } catch (err) { next(err); }
});

app.put('/api/v1/admin/feature-flags/:key',
  auditLog('admin.feature-flag.update', 'feature_flag'),
  async (req, res, next) => {
    try {
      const { enabled, rollout_pct, roles } = req.body as {
        enabled?: boolean; rollout_pct?: number; roles?: string[];
      };

      // Dark mode flag is permanently false
      if (req.params.key === 'dark_mode' && enabled) {
        throw new AppError('dark_mode cannot be enabled. This is a permanent design principle of IkonetU.', 403, 'dark-mode-locked');
      }

      await db('feature_flags')
        .where({ key: req.params.key })
        .update({ enabled, rollout_pct, roles: JSON.stringify(roles), updated_by: req.user!.id, updated_at: new Date() });

      res.json({ success: true });
    } catch (err) { next(err); }
  }
);

// ════════════════════════════════════════════════════════════
// COMPLIANCE CENTRE
// ════════════════════════════════════════════════════════════

app.get('/api/v1/admin/compliance/audit-log', async (req, res, next) => {
  try {
    const page = parseInt(req.query.page as string)||1;
    const limit = Math.min(parseInt(req.query.limit as string)||100,500);
    const { userId, action, resourceType, from, to } = req.query as Record<string,string>;

    const query = db('audit_log');
    if (userId)       query.where({ user_id: userId });
    if (action)       query.where('action','ilike',`%${action}%`);
    if (resourceType) query.where({ resource_type: resourceType });
    if (from) query.where('created_at','>=',new Date(from));
    if (to)   query.where('created_at','<=',new Date(to));

    const [entries, [{ count }]] = await Promise.all([
      query.clone().orderBy('created_at','desc').limit(limit).offset((page-1)*limit),
      query.clone().count('id as count'),
    ]);

    res.json({ entries, total: parseInt(String(count)), page, limit });
  } catch (err) { next(err); }
});

app.get('/api/v1/admin/compliance/gdpr-requests', async (req, res, next) => {
  try {
    const requests = await db('gdpr_requests')
      .join('users','gdpr_requests.user_id','users.id')
      .select('gdpr_requests.*','users.email','users.name')
      .orderBy('gdpr_requests.due_by','asc');

    const enriched = requests.map(r => ({
      ...r,
      overdue: new Date(r.due_by) < new Date() && r.status !== 'completed',
      daysRemaining: Math.ceil((new Date(r.due_by).getTime() - Date.now()) / (1000*60*60*24)),
    }));

    res.json({ requests: enriched });
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════
// REVENUE MANAGEMENT
// ════════════════════════════════════════════════════════════

app.get('/api/v1/admin/revenue/streams', async (req, res, next) => {
  try {
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);

    const streams = await db('revenue_events')
      .select('stream_id')
      .sum('amount as total_all_time')
      .sum(db.raw("CASE WHEN created_at >= ? THEN amount ELSE 0 END as mtd", [monthStart]))
      .count('id as transactions')
      .groupBy('stream_id')
      .orderBy('total_all_time','desc');

    // Mark R11 as on-hold
    const enriched = streams.map(s => ({
      ...s,
      status: s.stream_id === 'R11' ? 'on-hold-legal-pending' : 'active',
    }));

    res.json({ streams: enriched });
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════
// ACXM COMMAND CENTRE
// ════════════════════════════════════════════════════════════

app.get('/api/v1/admin/acxm/signals', async (req, res, next) => {
  try {
    const { signalClass, status, severity } = req.query as Record<string,string>;
    const page = parseInt(req.query.page as string)||1;
    const limit = Math.min(parseInt(req.query.limit as string)||50,100);

    const query = db('acxm_signals as a')
      .leftJoin('users as u','a.user_id','u.id')
      .leftJoin('ventures as v','a.venture_id','v.id');

    if (signalClass) query.where({ 'a.signal_class': signalClass });
    if (status)      query.where({ 'a.status': status });
    if (severity)    query.where({ 'a.severity': severity });

    const [signals, [{ count }]] = await Promise.all([
      query.clone().select('a.*','u.email','u.name','v.name as venture_name')
        .orderBy('a.detected_at','desc').limit(limit).offset((page-1)*limit),
      query.clone().count('a.id as count'),
    ]);

    res.json({ signals, total: parseInt(String(count)), page, limit });
  } catch (err) { next(err); }
});

app.get('/api/v1/admin/acxm/escalations', async (req, res, next) => {
  try {
    const escalations = await db('acxm_escalations as e')
      .join('acxm_signals as s','e.signal_id','s.id')
      .leftJoin('users as u','s.user_id','u.id')
      .where({ 'e.status': 'pending' })
      .select('e.*','s.signal_type','s.signal_class','s.severity','u.email','u.name')
      .orderBy('e.escalated_at','asc');

    res.json({ escalations });
  } catch (err) { next(err); }
});

app.put('/api/v1/admin/acxm/escalations/:id',
  auditLog('admin.acxm.escalation.resolved', 'acxm_escalation'),
  async (req, res, next) => {
    try {
      const { resolution_notes, action } = req.body as { resolution_notes: string; action: string };
      await db('acxm_escalations').where({ id: req.params.id })
        .update({ status: 'resolved', resolved_at: new Date(), resolution_notes, admin_id: req.user!.id });
      res.json({ success: true });
    } catch (err) { next(err); }
  }
);

// ════════════════════════════════════════════════════════════
// NOTIFICATION CENTRE
// ════════════════════════════════════════════════════════════

app.post('/api/v1/admin/notifications/broadcast',
  validate({ body: z.object({
    role:     z.enum(['founder','investor','provider','lender','university']).optional(),
    title:    z.string().min(1).max(200),
    body:     z.string().min(1).max(1000),
    type:     z.string().default('admin.broadcast'),
    channels: z.array(z.enum(['push','email','in_app'])).default(['in_app']),
  })}),
  auditLog('admin.notification.broadcast', 'notification'),
  async (req, res, next) => {
    try {
      const { role, title, body, type, channels } = req.body as {
        role?: string; title: string; body: string; type: string; channels: string[];
      };

      const query = db('users').where({ status: 'active' }).whereNull('deleted_at');
      if (role) query.where({ role });
      const users = await query.select('id');

      // Batch notifications
      const batch = users.map(u => ({
        user_id: u.id, type, title, body, data: JSON.stringify({ source: 'admin_broadcast' }),
      }));

      if (batch.length > 0) {
        await db('notifications').insert(batch);
      }

      res.json({ success: true, sent: batch.length, role: role||'all' });
    } catch (err) { next(err); }
  }
);

app.get('/health', (_, res) => res.json({
  service: 'admin-service',
  name: 'Golden Eye',
  theme: 'LIGHT MODE ONLY — ALWAYS — NO EXCEPTIONS',
  status: 'ok',
  version: '1.0.0',
  timestamp: new Date().toISOString(),
}));

app.use(errorHandler);

const PORT = parseInt(env.PORT) + 11; // 3012
async function start() {
  env.NODE_ENV;
  const { initRedis } = await import('@ikonetu/shared/middleware');
  await initRedis();
  app.listen(PORT, () => {
    console.log(`✅ admin-service (Golden Eye) running on port ${PORT}`);
    console.log(`   Theme: LIGHT MODE ONLY — permanently enforced`);
  });
}
start().catch((err) => { console.error(err); process.exit(1); });

export default app;
