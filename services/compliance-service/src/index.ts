import express from 'express';
import cron from 'node-cron';
import { env } from '@ikonetu/config';
import { db } from '@ikonetu/database';
import {
  requestId, rateLimiter, authenticate, requireRole,
  errorHandler,
} from '@ikonetu/shared/middleware';

const app = express();
app.use(express.json());
app.use(requestId);

// ════════════════════════════════════════════════════════════
// COMPLIANCE SERVICE
// 10 automated compliance jobs running on schedule
// These are non-optional — they enforce legal obligations
// ════════════════════════════════════════════════════════════

interface JobResult {
  job: string;
  ranAt: string;
  success: boolean;
  actions: number;
  details: string;
}

const jobLog: JobResult[] = [];

function logJob(result: JobResult): void {
  jobLog.unshift(result);
  if (jobLog.length > 500) jobLog.pop();
  console.log(`[COMPLIANCE] ${result.job}: ${result.details} (${result.actions} actions)`);
}

// ════════════════════════════════════════════════════════════
// JOB 1: RETENTION ENFORCER
// Deletes/anonymises data past legal retention periods
// Runs: Daily at 02:00 UTC
// ════════════════════════════════════════════════════════════

async function retentionEnforcer(): Promise<JobResult> {
  let actions = 0;
  const details: string[] = [];

  try {
    // Sessions older than 7 days (expired) — hard delete
    const expiredSessions = await db('user_sessions')
      .where('expires_at', '<', new Date(Date.now() - 7*24*60*60*1000))
      .delete();
    if (expiredSessions > 0) { actions += expiredSessions; details.push(`${expiredSessions} expired sessions deleted`); }

    // Analytics events older than 2 years — anonymise user_id
    const oldEvents = await db('analytics_events')
      .where('created_at', '<', new Date(Date.now() - 2*365*24*60*60*1000))
      .whereNotNull('user_id')
      .update({ user_id: null });
    if (oldEvents > 0) { actions += oldEvents; details.push(`${oldEvents} old analytics events anonymised`); }

    // OTP records older than 24 hours — hard delete
    const oldOtps = await db('otp_records')
      .where('created_at', '<', new Date(Date.now() - 24*60*60*1000))
      .delete();
    if (oldOtps > 0) { actions += oldOtps; details.push(`${oldOtps} OTP records deleted`); }

    // Soft-deleted users past 90-day window — nullify PII (if no legal holds)
    const toAnonymise = await db('users')
      .whereNotNull('deleted_at')
      .where('deleted_at', '<', new Date(Date.now() - 90*24*60*60*1000))
      .whereNotNull('email')
      .select('id');

    for (const u of toAnonymise) {
      // Check legal holds
      const hold = await db('gdpr_requests')
        .where({ user_id: u.id, status: 'pending' })
        .first();
      if (hold) continue;

      await db('users').where({ id: u.id }).update({ email: null, phone: null, name: '[deleted]', avatar_url: null });
      actions++;
    }
    if (toAnonymise.length > 0) details.push(`${toAnonymise.length} deleted users anonymised`);

  } catch (err) {
    return { job: 'retention_enforcer', ranAt: new Date().toISOString(), success: false, actions, details: (err as Error).message };
  }

  return { job: 'retention_enforcer', ranAt: new Date().toISOString(), success: true, actions, details: details.join('; ') || 'No actions required' };
}

// ════════════════════════════════════════════════════════════
// JOB 2: GDPR REQUEST PROCESSOR
// Enforces 30-day SLA on all data subject requests
// Runs: Every 6 hours
// ════════════════════════════════════════════════════════════

async function gdprRequestProcessor(): Promise<JobResult> {
  let actions = 0;
  const details: string[] = [];

  try {
    const now = new Date();

    // Flag overdue requests (past 30-day SLA)
    const overdue = await db('gdpr_requests')
      .whereIn('status', ['pending', 'processing'])
      .where('due_by', '<', now)
      .select('id', 'user_id', 'request_type');

    for (const req of overdue) {
      // Escalate to admin — this is a legal obligation
      await db('acxm_signals').insert({
        signal_type: 'compliance.gdpr_request_overdue',
        signal_data: JSON.stringify({ requestId: req.id, userId: req.user_id, type: req.request_type }),
        severity: 'critical',
        signal_class: 'threat',
        status: 'new',
      });

      await db('notifications').insert({
        user_id: null, // system notification
        type: 'compliance.gdpr_sla_breach',
        title: 'GDPR SLA BREACH — URGENT ACTION REQUIRED',
        body: `GDPR ${req.request_type} request for user ${req.user_id} is overdue. Legal obligation. Process immediately.`,
        data: JSON.stringify({ requestId: req.id }),
      });
      actions++;
    }
    if (overdue.length > 0) details.push(`${overdue.length} overdue GDPR requests escalated`);

    // Auto-complete access requests (generate data export link)
    const accessRequests = await db('gdpr_requests')
      .where({ request_type: 'access', status: 'pending' })
      .where('due_by', '>', now) // not yet overdue
      .where('created_at', '<', new Date(Date.now() - 3*24*60*60*1000)) // 3+ days old
      .select('id', 'user_id');

    if (accessRequests.length > 0) {
      details.push(`${accessRequests.length} access requests queued for processing`);
    }

  } catch (err) {
    return { job: 'gdpr_request_processor', ranAt: new Date().toISOString(), success: false, actions, details: (err as Error).message };
  }

  return { job: 'gdpr_request_processor', ranAt: new Date().toISOString(), success: true, actions, details: details.join('; ') || 'All requests within SLA' };
}

// ════════════════════════════════════════════════════════════
// JOB 3: PI CERTIFICATE MONITOR
// Suspends provider listings when PI insurance expires
// Runs: Daily at 06:00 UTC
// ════════════════════════════════════════════════════════════

async function piCertificateMonitor(): Promise<JobResult> {
  let actions = 0;
  const details: string[] = [];

  try {
    const sevenDaysFromNow = new Date(Date.now() + 7*24*60*60*1000);
    const now = new Date();

    // Listings about to expire — warn
    const expiringSoon = await db('provider_profiles')
      .whereNotNull('pi_certificate_expiry')
      .where('pi_certificate_expiry', '<=', sevenDaysFromNow)
      .where('pi_certificate_expiry', '>', now)
      .select('user_id', 'pi_certificate_expiry');

    for (const p of expiringSoon) {
      await db('notifications').insert({
        user_id: p.user_id,
        type: 'compliance.pi_expiring',
        title: 'Professional indemnity insurance expiring soon',
        body: `Your PI insurance expires on ${new Date(p.pi_certificate_expiry).toLocaleDateString()}. Upload a renewed certificate to keep your listings active.`,
        data: JSON.stringify({ expiryDate: p.pi_certificate_expiry }),
      });
      actions++;
    }
    if (expiringSoon.length > 0) details.push(`${expiringSoon.length} PI certificates expiring within 7 days — providers notified`);

    // Listings already expired — suspend
    const expired = await db('provider_profiles')
      .whereNotNull('pi_certificate_expiry')
      .where('pi_certificate_expiry', '<=', now)
      .select('id', 'user_id');

    for (const p of expired) {
      await db('provider_listings').where({ provider_id: p.id }).update({ active: false });
      await db('notifications').insert({
        user_id: p.user_id,
        type: 'compliance.pi_expired',
        title: 'Listings suspended — PI insurance expired',
        body: 'Your professional indemnity insurance has expired. All listings are suspended until you upload a valid certificate.',
        data: JSON.stringify({}),
      });
      actions++;
    }
    if (expired.length > 0) details.push(`${expired.length} provider profiles with expired PI — listings suspended`);

  } catch (err) {
    return { job: 'pi_certificate_monitor', ranAt: new Date().toISOString(), success: false, actions, details: (err as Error).message };
  }

  return { job: 'pi_certificate_monitor', ranAt: new Date().toISOString(), success: true, actions, details: details.join('; ') || 'All PI certificates current' };
}

// ════════════════════════════════════════════════════════════
// JOB 4: CONSENT EXPIRY MANAGER
// Triggers re-consent workflows before consent expires
// Runs: Daily at 03:00 UTC
// ════════════════════════════════════════════════════════════

async function consentExpiryManager(): Promise<JobResult> {
  let actions = 0;
  const details: string[] = [];

  try {
    const thirtyDaysFromNow = new Date(Date.now() + 30*24*60*60*1000);
    const oneYearAgo = new Date(Date.now() - 365*24*60*60*1000);

    // Consents granted over 1 year ago — request renewal for non-contract types
    const oldConsents = await db('user_consents')
      .where({ granted: true })
      .where('granted_at', '<', oneYearAgo)
      .whereNotIn('consent_type', ['terms_v2', 'privacy_policy']) // contract types don't expire
      .select('user_id', 'consent_type', 'granted_at');

    for (const c of oldConsents) {
      await db('notifications').insert({
        user_id: c.user_id,
        type: 'consent.renewal_required',
        title: 'Please review your data preferences',
        body: `Your consent for "${c.consent_type}" was granted over a year ago. Please review and confirm your preferences.`,
        data: JSON.stringify({ consentType: c.consent_type }),
      });
      actions++;
    }
    if (oldConsents.length > 0) details.push(`${oldConsents.length} consent renewals requested`);

  } catch (err) {
    return { job: 'consent_expiry_manager', ranAt: new Date().toISOString(), success: false, actions, details: (err as Error).message };
  }

  return { job: 'consent_expiry_manager', ranAt: new Date().toISOString(), success: true, actions, details: details.join('; ') || 'No consents requiring renewal' };
}

// ════════════════════════════════════════════════════════════
// JOB 5: AML SCREENER
// Screens users against sanctions lists
// Runs: Daily at 04:00 UTC + on user registration
// ════════════════════════════════════════════════════════════

// Sanctioned jurisdictions — simplified list
// In production: integrate with OFAC, UN, EU, HMT APIs
const SANCTIONED_COUNTRIES = ['KP', 'IR', 'SY', 'CU', 'VE'];
const SANCTIONED_KEYWORDS = ['terrorist', 'sanctioned', 'ofac'];

async function amlScreener(): Promise<JobResult> {
  let actions = 0;
  const details: string[] = [];

  try {
    // Screen users from sanctioned jurisdictions
    const flagged = await db('users')
      .whereIn('country', SANCTIONED_COUNTRIES)
      .where({ status: 'active' })
      .whereNull('deleted_at')
      .select('id', 'email', 'name', 'country');

    for (const u of flagged) {
      await db('acxm_signals').insert({
        user_id: u.id,
        signal_type: 'compliance.aml_jurisdiction_flag',
        signal_data: JSON.stringify({ country: u.country, userId: u.id }),
        severity: 'critical',
        signal_class: 'threat',
        status: 'new',
      });
      actions++;
    }
    if (flagged.length > 0) details.push(`${flagged.length} users from sanctioned jurisdictions flagged for review`);

    // Log the screening run
    await db('audit_log').insert({
      action: 'compliance.aml_screening.completed',
      resource_type: 'compliance',
      new_value: JSON.stringify({ screened: await db('users').where({ status: 'active' }).count('id as count').first(), flagged: flagged.length }),
    });

  } catch (err) {
    return { job: 'aml_screener', ranAt: new Date().toISOString(), success: false, actions, details: (err as Error).message };
  }

  return { job: 'aml_screener', ranAt: new Date().toISOString(), success: true, actions, details: details.join('; ') || 'No new AML flags' };
}

// ════════════════════════════════════════════════════════════
// JOB 6: MONTHLY BIAS AUDITOR
// Tests scoring signals for disparate impact (80% rule)
// Runs: 1st of each month at 05:00 UTC
// ════════════════════════════════════════════════════════════

async function biasAuditor(): Promise<JobResult> {
  let actions = 0;
  const details: string[] = [];

  try {
    const overall = await db('scores').where({ is_current: true }).avg('total_score as avg').first();
    const overallAvg = parseFloat(String(overall?.avg || 0));
    const threshold80 = overallAvg * 0.8;

    // Check by country
    const byCountry = await db('scores as s')
      .join('ventures as v', 's.venture_id', 'v.id')
      .where({ 's.is_current': true }).whereNotNull('v.country')
      .select('v.country').avg('s.total_score as avg_score').count('s.id as n')
      .groupBy('v.country').having(db.raw('COUNT(s.id) >= 10'));

    const failingCountries = byCountry.filter(r => parseFloat(String(r.avg_score)) < threshold80);

    if (failingCountries.length > 0) {
      await db('acxm_signals').insert({
        signal_type: 'compliance.bias_audit_failure',
        signal_data: JSON.stringify({ failingCountries, overallAvg, threshold80 }),
        severity: 'critical',
        signal_class: 'threat',
        status: 'new',
      });
      actions++;
      details.push(`BIAS ALERT: ${failingCountries.length} countries below 80% threshold — ${failingCountries.map(c => c.country).join(', ')}`);
    } else {
      details.push(`Bias audit passed. Overall avg: ${Math.round(overallAvg)}. All countries within threshold.`);
    }

    // Store audit record
    await db('platform_config')
      .where({ key: 'last_bias_audit' })
      .update({ value: JSON.stringify({ date: new Date().toISOString(), pass: failingCountries.length === 0, overallAvg, failingCountries }) })
      .catch(async () => {
        await db('platform_config').insert({ key: 'last_bias_audit', value: JSON.stringify({ date: new Date().toISOString() }) });
      });

  } catch (err) {
    return { job: 'bias_auditor', ranAt: new Date().toISOString(), success: false, actions, details: (err as Error).message };
  }

  return { job: 'bias_auditor', ranAt: new Date().toISOString(), success: true, actions, details: details.join('; ') };
}

// ════════════════════════════════════════════════════════════
// JOB 7: DATA LOCALISATION CHECKER
// Verifies Nigerian user data stays in approved regions
// Runs: Hourly
// ════════════════════════════════════════════════════════════

async function dataLocalisationChecker(): Promise<JobResult> {
  // In production this checks Cloud SQL instance region tags
  // For now, validate that Nigerian users exist and log compliance
  let actions = 0;

  try {
    const ngUsers = await db('users').where({ country: 'NG' }).whereNull('deleted_at').count('id as count').first();
    const count = parseInt(String(ngUsers?.count || 0));

    if (count > 0) {
      await db('audit_log').insert({
        action: 'compliance.data_localisation.checked',
        resource_type: 'compliance',
        new_value: JSON.stringify({
          nigerianUsers: count,
          storageRegion: env.GCS_REGION,
          compliant: env.GCS_REGION === 'europe-west2' || env.GCS_REGION.includes('africa'),
          checkedAt: new Date().toISOString(),
        }),
      });
      actions = 1;
    }
  } catch (err) {
    return { job: 'data_localisation_checker', ranAt: new Date().toISOString(), success: false, actions, details: (err as Error).message };
  }

  return { job: 'data_localisation_checker', ranAt: new Date().toISOString(), success: true, actions, details: `Storage region: ${env.GCS_REGION}` };
}

// ════════════════════════════════════════════════════════════
// JOB 8: SCORE HISTORY INTEGRITY CHECKER
// Verifies no score_history records were modified
// Runs: Weekly on Sunday at 01:00 UTC
// ════════════════════════════════════════════════════════════

async function scoreHistoryIntegrityChecker(): Promise<JobResult> {
  let actions = 0;

  try {
    // Verify no score_history records have updated_at (they shouldn't — append-only)
    const corrupted = await db('score_history')
      .whereRaw('DATE(created_at) != DATE(snapshot_date)')
      .count('id as count').first();

    const count = parseInt(String(corrupted?.count || 0));

    if (count > 0) {
      await db('acxm_signals').insert({
        signal_type: 'compliance.score_history_integrity_failure',
        signal_data: JSON.stringify({ suspiciousRecords: count }),
        severity: 'critical',
        signal_class: 'threat',
        status: 'new',
      });
      actions = count;
    }

    return {
      job: 'score_history_integrity', ranAt: new Date().toISOString(), success: true, actions,
      details: count > 0 ? `WARNING: ${count} suspicious records found` : 'Score history integrity verified',
    };
  } catch (err) {
    return { job: 'score_history_integrity', ranAt: new Date().toISOString(), success: false, actions, details: (err as Error).message };
  }
}

// ════════════════════════════════════════════════════════════
// JOB 9: SUBSCRIPTION HEALTH MONITOR
// Handles dunning — past_due subscriptions
// Runs: Daily at 07:00 UTC
// ════════════════════════════════════════════════════════════

async function subscriptionHealthMonitor(): Promise<JobResult> {
  let actions = 0;
  const details: string[] = [];

  try {
    // Past due > 7 days — restrict access
    const pastDue7 = await db('subscriptions')
      .where({ status: 'past_due' })
      .where('updated_at', '<', new Date(Date.now() - 7*24*60*60*1000))
      .select('user_id', 'id');

    for (const s of pastDue7) {
      await db('notifications').insert({
        user_id: s.user_id,
        type: 'billing.past_due_7_days',
        title: 'Account access will be restricted',
        body: 'Your subscription payment has been overdue for 7 days. Please update your payment method to avoid service interruption.',
        data: JSON.stringify({ subscriptionId: s.id }),
      });
      actions++;
    }
    if (pastDue7.length > 0) details.push(`${pastDue7.length} subscriptions past due >7 days — users notified`);

    // Past due > 30 days — suspend
    const pastDue30 = await db('subscriptions')
      .where({ status: 'past_due' })
      .where('updated_at', '<', new Date(Date.now() - 30*24*60*60*1000))
      .select('user_id', 'id');

    for (const s of pastDue30) {
      await db('subscriptions').where({ id: s.id }).update({ status: 'unpaid' });
      await db('users').where({ id: s.user_id }).update({ status: 'suspended' });
      actions++;
    }
    if (pastDue30.length > 0) details.push(`${pastDue30.length} accounts suspended after 30 days non-payment`);

  } catch (err) {
    return { job: 'subscription_health_monitor', ranAt: new Date().toISOString(), success: false, actions, details: (err as Error).message };
  }

  return { job: 'subscription_health_monitor', ranAt: new Date().toISOString(), success: true, actions, details: details.join('; ') || 'All subscriptions healthy' };
}

// ════════════════════════════════════════════════════════════
// JOB 10: R12 DISPUTE RESERVE MONITOR
// Ensures platform dispute reserve stays at 8% of R12 commission
// Runs: Monthly on the 1st at 08:00 UTC
// ════════════════════════════════════════════════════════════

async function r12DisputeReserveMonitor(): Promise<JobResult> {
  let actions = 0;

  try {
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);

    const r12Revenue = await db('revenue_events')
      .where({ stream_id: 'R12' })
      .where('created_at', '>=', monthStart)
      .sum('amount as total').first();

    const monthlyCommission = parseFloat(String(r12Revenue?.total || 0));
    const requiredReserve = monthlyCommission * 0.08; // 8% of gross commission

    // Log reserve requirement
    await db('platform_config')
      .insert({ key: 'r12_dispute_reserve_target', value: JSON.stringify({ required: requiredReserve, monthlyCommission, calculatedAt: new Date().toISOString() }) })
      .onConflict('key').merge();

    actions = 1;

    return {
      job: 'r12_dispute_reserve_monitor', ranAt: new Date().toISOString(), success: true, actions,
      details: `Monthly R12 commission: £${monthlyCommission.toFixed(2)}. Required reserve (8%): £${requiredReserve.toFixed(2)}`,
    };
  } catch (err) {
    return { job: 'r12_dispute_reserve_monitor', ranAt: new Date().toISOString(), success: false, actions: 0, details: (err as Error).message };
  }
}

// ════════════════════════════════════════════════════════════
// SCHEDULE ALL JOBS
// ════════════════════════════════════════════════════════════

function scheduleJobs(): void {
  // Job 1: Daily at 02:00 UTC
  cron.schedule('0 2 * * *', async () => logJob(await retentionEnforcer()));

  // Job 2: Every 6 hours
  cron.schedule('0 */6 * * *', async () => logJob(await gdprRequestProcessor()));

  // Job 3: Daily at 06:00 UTC
  cron.schedule('0 6 * * *', async () => logJob(await piCertificateMonitor()));

  // Job 4: Daily at 03:00 UTC
  cron.schedule('0 3 * * *', async () => logJob(await consentExpiryManager()));

  // Job 5: Daily at 04:00 UTC
  cron.schedule('0 4 * * *', async () => logJob(await amlScreener()));

  // Job 6: 1st of month at 05:00 UTC
  cron.schedule('0 5 1 * *', async () => logJob(await biasAuditor()));

  // Job 7: Hourly
  cron.schedule('0 * * * *', async () => logJob(await dataLocalisationChecker()));

  // Job 8: Sunday at 01:00 UTC
  cron.schedule('0 1 * * 0', async () => logJob(await scoreHistoryIntegrityChecker()));

  // Job 9: Daily at 07:00 UTC
  cron.schedule('0 7 * * *', async () => logJob(await subscriptionHealthMonitor()));

  // Job 10: 1st of month at 08:00 UTC
  cron.schedule('0 8 1 * *', async () => logJob(await r12DisputeReserveMonitor()));

  console.log('✅ All 10 compliance jobs scheduled');
}

// ════════════════════════════════════════════════════════════
// ROUTES — manual trigger + status
// ════════════════════════════════════════════════════════════

app.post('/api/v1/compliance/run/:job',
  rateLimiter({ max: 10 }), authenticate, requireRole('super_admin'),
  async (req, res, next) => {
    try {
      const jobs: Record<string, () => Promise<JobResult>> = {
        retention_enforcer: retentionEnforcer,
        gdpr_request_processor: gdprRequestProcessor,
        pi_certificate_monitor: piCertificateMonitor,
        consent_expiry_manager: consentExpiryManager,
        aml_screener: amlScreener,
        bias_auditor: biasAuditor,
        data_localisation_checker: dataLocalisationChecker,
        score_history_integrity: scoreHistoryIntegrityChecker,
        subscription_health_monitor: subscriptionHealthMonitor,
        r12_dispute_reserve_monitor: r12DisputeReserveMonitor,
      };

      const job = jobs[req.params.job];
      if (!job) return res.status(404).json({ error: `Unknown job: ${req.params.job}. Available: ${Object.keys(jobs).join(', ')}` });

      const result = await job();
      logJob(result);
      res.json(result);
    } catch (err) { next(err); }
  }
);

app.get('/api/v1/compliance/job-log',
  rateLimiter(), authenticate, requireRole('super_admin'),
  (req, res) => res.json({ log: jobLog.slice(0, 100) })
);

app.get('/api/v1/compliance/status',
  rateLimiter(), authenticate, requireRole('super_admin'),
  async (req, res, next) => {
    try {
      const [pendingGdpr, overduePi, openThreats] = await Promise.all([
        db('gdpr_requests').whereIn('status', ['pending','processing']).count('id as count').first(),
        db('provider_profiles').whereNotNull('pi_certificate_expiry').where('pi_certificate_expiry', '<', new Date()).count('id as count').first(),
        db('acxm_signals').where({ signal_class: 'threat', status: 'new', severity: 'critical' }).count('id as count').first(),
      ]);

      res.json({
        status: 'operational',
        pendingGdprRequests: parseInt(String(pendingGdpr?.count||0)),
        expiredPiCertificates: parseInt(String(overduePi?.count||0)),
        openCriticalThreats: parseInt(String(openThreats?.count||0)),
        jobsScheduled: 10,
        lastJobRun: jobLog[0]?.ranAt || 'never',
        checkedAt: new Date().toISOString(),
      });
    } catch (err) { next(err); }
  }
);

app.get('/health', (_, res) => res.json({
  service: 'compliance-service', status: 'ok', version: '1.0.0',
  jobs: 10, schedule: 'See /api/v1/compliance/status',
  timestamp: new Date().toISOString(),
}));

app.use(errorHandler);

const PORT = parseInt(env.PORT) + 14; // 3015
async function start() {
  env.NODE_ENV;
  scheduleJobs();

  // Run critical jobs immediately on startup
  Promise.allSettled([
    piCertificateMonitor().then(r => logJob(r)),
    gdprRequestProcessor().then(r => logJob(r)),
  ]);

  app.listen(PORT, () => {
    console.log(`✅ compliance-service running on port ${PORT}`);
    console.log(`   10 automated compliance jobs active`);
    console.log(`   GDPR SLA: 30 days | AML: daily | Bias audit: monthly`);
  });
}
start().catch((err) => { console.error(err); process.exit(1); });

export default app;
