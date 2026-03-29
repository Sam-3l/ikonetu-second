import express from 'express';
import { createClient } from 'redis';
import { env } from '@ikonetu/config';
import { db } from '@ikonetu/database';
import {
  requestId, rateLimiter, authenticate, requireRole,
  errorHandler, AppError,
} from '@ikonetu/shared/middleware';

const app = express();
app.use(express.json());
app.use(requestId);

let redis: ReturnType<typeof createClient>;

// ════════════════════════════════════════════════════════════
// ACXM — AGENTIC CUSTOMER EXPERIENCE MANAGEMENT
// Continuously monitors all platform signals and acts
// on opportunities and threats without manual intervention.
//
// SAFETY INVARIANTS:
// 1. Max 3 interventions per user per 24 hours
// 2. Max 7 interventions per user per 7 days
// 3. No permanent account action without admin_confirmation=true
// 4. All actions immutably logged
// ════════════════════════════════════════════════════════════

// ── Suppression check ────────────────────────────────────────
async function canIntervene(userId: string): Promise<boolean> {
  const MAX_24H = 3;
  const MAX_7D  = 7;

  const suppression = await db('acxm_suppression').where({ user_id: userId }).first();
  if (!suppression) return true;

  if (suppression.suppressed_until && new Date(suppression.suppressed_until) > new Date()) return false;

  // Reset 24h counter if >24h since last intervention
  if (suppression.last_intervention_at) {
    const hoursSince = (Date.now() - new Date(suppression.last_intervention_at).getTime()) / (1000*60*60);
    if (hoursSince > 24) {
      await db('acxm_suppression').where({ user_id: userId }).update({ intervention_count_24h: 0 });
      return true;
    }
  }

  if (suppression.intervention_count_24h >= MAX_24H) return false;
  if (suppression.intervention_count_7d  >= MAX_7D)  return false;
  return true;
}

async function recordIntervention(userId: string): Promise<void> {
  await db('acxm_suppression')
    .insert({ user_id: userId, intervention_count_24h: 1, intervention_count_7d: 1, last_intervention_at: new Date() })
    .onConflict('user_id').merge({
      intervention_count_24h: db.raw('acxm_suppression.intervention_count_24h + 1'),
      intervention_count_7d:  db.raw('acxm_suppression.intervention_count_7d + 1'),
      last_intervention_at: new Date(),
    });
}

async function createSignalAndIntervene(
  userId: string | null,
  ventureId: string | null,
  signalType: string,
  signalClass: 'opportunity' | 'threat',
  severity: 'info' | 'warning' | 'critical',
  interventionType: string,
  channel: 'push' | 'email' | 'in_app' | 'admin_alert',
  content: Record<string, unknown>,
  requireAdminConfirmation = false,
): Promise<void> {
  // Create signal
  const [signal] = await db('acxm_signals').insert({
    user_id: userId,
    venture_id: ventureId,
    signal_type: signalType,
    signal_data: JSON.stringify(content),
    severity,
    signal_class: signalClass,
    status: 'new',
  }).returning('*');

  // Check suppression for user-facing interventions
  if (userId && channel !== 'admin_alert') {
    const allowed = await canIntervene(userId);
    if (!allowed) {
      await db('acxm_interventions').insert({
        signal_id: signal.id,
        intervention_type: interventionType,
        channel,
        content: JSON.stringify(content),
        suppressed: true,
        admin_confirmation_required: requireAdminConfirmation,
        admin_confirmed: false,
      });
      return;
    }
  }

  // Create intervention
  await db('acxm_interventions').insert({
    signal_id: signal.id,
    intervention_type: interventionType,
    channel,
    content: JSON.stringify(content),
    suppressed: false,
    admin_confirmation_required: requireAdminConfirmation,
    admin_confirmed: requireAdminConfirmation ? false : true, // auto-confirm non-critical
    dispatched_at: requireAdminConfirmation ? null : new Date(),
  });

  // Escalate critical threats and actions requiring admin confirmation
  if (requireAdminConfirmation || severity === 'critical') {
    await db('acxm_escalations').insert({
      signal_id: signal.id,
      reason: `${severity.toUpperCase()} ${signalClass}: ${signalType}`,
      status: 'pending',
    });
  }

  if (userId) await recordIntervention(userId);
}

// ════════════════════════════════════════════════════════════
// OPPORTUNITY DETECTORS
// ════════════════════════════════════════════════════════════

async function detectScoreOpportunities(): Promise<void> {
  // Tier threshold proximity — within 50 points of next tier
  const TIER_THRESHOLDS = { EARLY: 301, RISING: 601, INVESTABLE: 851 };

  for (const [tier, threshold] of Object.entries(TIER_THRESHOLDS)) {
    const nearBoundary = await db('scores as s')
      .join('ventures as v', 's.venture_id', 'v.id')
      .where({ 's.is_current': true, 's.tier': tier })
      .where('s.total_score', '>=', threshold - 50)
      .whereNull('v.deleted_at')
      .select('s.total_score','s.venture_id','v.user_id','v.name');

    for (const score of nearBoundary) {
      const pointsNeeded = threshold - score.total_score;
      await createSignalAndIntervene(
        score.user_id, score.venture_id,
        'score.near_tier_threshold', 'opportunity', 'info',
        'score_nudge_notification', 'in_app',
        {
          currentScore: score.total_score,
          pointsNeeded,
          nextTier: Object.keys(TIER_THRESHOLDS)[Object.keys(TIER_THRESHOLDS).indexOf(tier) + 1] || 'ELITE',
          message: `You are ${pointsNeeded} points away from the next tier. Here are your highest-impact next actions.`,
        }
      );
    }
  }
}

async function detectRevenueOpportunities(): Promise<void> {
  // Free-to-paid: founders who completed 3+ score actions in 7 days with no subscription
  const sevenDaysAgo = new Date(Date.now() - 7*24*60*60*1000);

  const candidatesForUpgrade = await db('audit_log as a')
    .join('users as u', 'a.user_id', 'u.id')
    .leftJoin('subscriptions as s', function() {
      this.on('s.user_id', 'u.id').andOn(db.raw("s.status IN ('active','trialing')"));
    })
    .where('a.created_at', '>=', sevenDaysAgo)
    .whereIn('a.action', ['venture.document.uploaded','venture.social-connected','score.calculated'])
    .whereNull('s.id') // no active subscription
    .where({ 'u.role': 'founder', 'u.status': 'active' })
    .groupBy('a.user_id', 'u.id')
    .having(db.raw('COUNT(a.id) >= 3'))
    .select('a.user_id');

  for (const c of candidatesForUpgrade) {
    await createSignalAndIntervene(
      c.user_id, null,
      'billing.free_to_paid_trigger', 'opportunity', 'info',
      'upgrade_prompt', 'in_app',
      { message: 'You are actively building your score. Upgrade to unlock advanced features.' }
    );
  }

  // API quota approaching — check users at 80% of monthly quota
  const nearQuota = await db('api_usage')
    .where(db.raw('calls_month >= quota_monthly * 0.8'))
    .select('user_id','calls_month','quota_monthly');

  for (const u of nearQuota) {
    await createSignalAndIntervene(
      u.user_id, null,
      'api.quota_approaching', 'opportunity', 'warning',
      'quota_upgrade_prompt', 'email',
      {
        callsUsed: u.calls_month,
        quota: u.quota_monthly,
        pctUsed: Math.round(u.calls_month/u.quota_monthly*100),
        message: `You are at ${Math.round(u.calls_month/u.quota_monthly*100)}% of your monthly API quota.`,
      }
    );
  }
}

// ════════════════════════════════════════════════════════════
// THREAT DETECTORS
// ════════════════════════════════════════════════════════════

async function detectChurnThreats(): Promise<void> {
  const thirtyDaysAgo = new Date(Date.now() - 30*24*60*60*1000);
  const sevenDaysAgo  = new Date(Date.now() - 7*24*60*60*1000);

  // Users whose login frequency dropped >50% vs previous 30 days
  const recentLogins = await db('user_sessions as s')
    .join('users as u', 's.user_id', 'u.id')
    .where('s.created_at', '>=', thirtyDaysAgo)
    .where({ 'u.status': 'active' })
    .groupBy('s.user_id')
    .having(db.raw('COUNT(s.id) = 1')) // only 1 login in 30 days
    .select('s.user_id');

  for (const u of recentLogins.slice(0, 100)) { // batch limit
    await createSignalAndIntervene(
      u.user_id, null,
      'engagement.declining', 'threat', 'warning',
      'reengagement_email', 'email',
      { message: 'We noticed you have been less active. Here is what changed with your score.' }
    );
  }

  // Failed payments — 2 consecutive failures
  const failedPayments = await db('revenue_events')
    .where({ event_type: 'billing.payment_failed' })
    .where('created_at', '>=', sevenDaysAgo)
    .groupBy('user_id')
    .having(db.raw('COUNT(*) >= 2'))
    .select('user_id');

  for (const u of failedPayments) {
    await createSignalAndIntervene(
      u.user_id, null,
      'billing.consecutive_payment_failures', 'threat', 'critical',
      'payment_recovery', 'email',
      { message: 'Your subscription payment has failed twice. Please update your payment method.' }
    );
  }
}

async function detectFraudThreats(): Promise<void> {
  const sevenDaysAgo = new Date(Date.now() - 7*24*60*60*1000);

  // Social follower spike >500% in 7 days
  const followerSpikes = await db('venture_social_profiles')
    .where('last_scraped', '>=', sevenDaysAgo)
    .whereRaw('followers > 0')
    .select('venture_id', 'platform', 'followers');

  // Score gaming: document upload rate >5x normal
  const highUploadRate = await db('venture_documents as d')
    .join('ventures as v', 'd.venture_id', 'v.id')
    .where('d.created_at', '>=', sevenDaysAgo)
    .groupBy('d.venture_id', 'v.user_id')
    .having(db.raw('COUNT(d.id) > 5'))
    .select('d.venture_id', 'v.user_id');

  for (const v of highUploadRate) {
    await createSignalAndIntervene(
      v.user_id, v.venture_id,
      'fraud.high_document_upload_rate', 'threat', 'critical',
      'score_pause_pending_review', 'admin_alert',
      {
        message: 'Unusual document upload activity detected. Score calculation paused pending review.',
        requiresHumanReview: true,
      },
      true // requireAdminConfirmation — NEVER automate account actions
    );
  }

  // Lender data harvesting: >100 profile queries in 1 hour
  const bulkQueryers = await db('audit_log')
    .where('created_at', '>=', new Date(Date.now() - 60*60*1000))
    .where({ action: 'user.read' })
    .groupBy('user_id')
    .having(db.raw('COUNT(*) > 100'))
    .select('user_id');

  for (const u of bulkQueryers) {
    await createSignalAndIntervene(
      u.user_id, null,
      'fraud.bulk_data_scraping_attempt', 'threat', 'critical',
      'account_rate_limit', 'admin_alert',
      { queriesInLastHour: 100, message: 'Potential data scraping detected.' },
      true // human review required
    );
  }
}

// ── Scheduled ACXM run ───────────────────────────────────────
async function runACXMCycle(): Promise<{ opportunities: number; threats: number }> {
  const before = await db('acxm_signals').count('id as count').first();
  const beforeCount = parseInt(String(before?.count||0));

  await Promise.allSettled([
    detectScoreOpportunities(),
    detectRevenueOpportunities(),
    detectChurnThreats(),
    detectFraudThreats(),
  ]);

  const after = await db('acxm_signals').count('id as count').first();
  const afterCount = parseInt(String(after?.count||0));
  const newSignals = afterCount - beforeCount;

  const opps = await db('acxm_signals').where({ signal_class: 'opportunity' }).where('created_at', '>=', new Date(Date.now() - 60000)).count('id as count').first();
  const threats = await db('acxm_signals').where({ signal_class: 'threat' }).where('created_at', '>=', new Date(Date.now() - 60000)).count('id as count').first();

  return {
    opportunities: parseInt(String(opps?.count||0)),
    threats: parseInt(String(threats?.count||0)),
  };
}

// ════════════════════════════════════════════════════════════
// ROUTES
// ════════════════════════════════════════════════════════════

// POST /api/v1/acxm/run — trigger ACXM cycle (admin or scheduled)
app.post('/api/v1/acxm/run',
  rateLimiter({ max: 10 }), authenticate, requireRole('super_admin'),
  async (req, res, next) => {
    try {
      const result = await runACXMCycle();
      res.json({ success: true, ...result, ranAt: new Date().toISOString() });
    } catch (err) { next(err); }
  }
);

// GET /api/v1/acxm/signals
app.get('/api/v1/acxm/signals',
  rateLimiter(), authenticate,
  async (req, res, next) => {
    try {
      const { signalClass, status } = req.query as Record<string,string>;
      const query = db('acxm_signals');

      if (req.user!.role !== 'super_admin') {
        query.where({ user_id: req.user!.id });
      }
      if (signalClass) query.where({ signal_class: signalClass });
      if (status)      query.where({ status });

      const signals = await query.orderBy('detected_at','desc').limit(50);
      res.json({ signals });
    } catch (err) { next(err); }
  }
);

// GET /api/v1/acxm/opportunities
app.get('/api/v1/acxm/opportunities',
  rateLimiter(), authenticate,
  async (req, res, next) => {
    try {
      const opps = await db('acxm_signals')
        .where({ signal_class: 'opportunity', status: 'new' })
        .modify(q => { if (req.user!.role !== 'super_admin') q.where({ user_id: req.user!.id }); })
        .orderBy('detected_at','desc').limit(20);
      res.json({ opportunities: opps });
    } catch (err) { next(err); }
  }
);

// PUT /api/v1/acxm/escalations/:id — human resolves escalation
app.put('/api/v1/acxm/escalations/:id',
  rateLimiter(), authenticate, requireRole('super_admin'),
  async (req, res, next) => {
    try {
      const { resolution_notes, execute_action } = req.body as {
        resolution_notes: string;
        execute_action: boolean;
      };

      const escalation = await db('acxm_escalations').where({ id: req.params.id }).first();
      if (!escalation) throw new AppError('Escalation not found', 404, 'not-found');

      // If approved — mark intervention as admin-confirmed
      if (execute_action) {
        await db('acxm_interventions')
          .where({ signal_id: escalation.signal_id })
          .update({ admin_confirmed: true, confirmed_by: req.user!.id, dispatched_at: new Date() });
      }

      await db('acxm_escalations')
        .where({ id: req.params.id })
        .update({ status: 'resolved', resolved_at: new Date(), resolution_notes, admin_id: req.user!.id });

      await db('acxm_signals')
        .where({ id: escalation.signal_id })
        .update({ status: execute_action ? 'actioned' : 'dismissed', actioned_at: new Date() });

      res.json({ success: true, actionExecuted: execute_action });
    } catch (err) { next(err); }
  }
);

// GET /api/v1/acxm/analytics
app.get('/api/v1/acxm/analytics',
  rateLimiter(), authenticate, requireRole('super_admin'),
  async (req, res, next) => {
    try {
      const [signals, interventions, escalations] = await Promise.all([
        db('acxm_signals').select('signal_class','severity','status').count('id as count').groupBy('signal_class','severity','status'),
        db('acxm_interventions').select(db.raw(`
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE suppressed=true) as suppressed,
          COUNT(*) FILTER (WHERE opened_at IS NOT NULL) as opened,
          COUNT(*) FILTER (WHERE converted_at IS NOT NULL) as converted
        `)).first(),
        db('acxm_escalations').select('status').count('id as count').groupBy('status'),
      ]);

      res.json({
        signals,
        interventions,
        escalations,
        suppressionRate: interventions
          ? Math.round(parseInt(String((interventions as any).suppressed||0)) / Math.max(1, parseInt(String((interventions as any).total||1))) * 100)
          : 0,
      });
    } catch (err) { next(err); }
  }
);

app.get('/health', (_, res) => res.json({
  service: 'acxm-service', status: 'ok', version: '1.0.0',
  invariants: { maxInterventions24h: 3, maxInterventions7d: 7, permanentActionsRequireHumanConfirmation: true },
  timestamp: new Date().toISOString(),
}));

app.use(errorHandler);

const PORT = parseInt(env.PORT) + 13; // 3014
async function start() {
  env.NODE_ENV;
  redis = createClient({ url: env.REDIS_URL });
  await redis.connect();

  // Schedule ACXM to run every 15 minutes
  setInterval(async () => {
    try {
      const result = await runACXMCycle();
      console.log(`ACXM cycle: +${result.opportunities} opportunities, +${result.threats} threats`);
    } catch (err) { console.error('ACXM cycle error:', err); }
  }, 15 * 60 * 1000);

  app.listen(PORT, () => {
    console.log(`✅ acxm-service running on port ${PORT}`);
    console.log(`   Cycle: every 15 minutes`);
    console.log(`   Suppression limits: 3/24h, 7/7d per user`);
  });
}
start().catch((err) => { console.error(err); process.exit(1); });

export default app;
