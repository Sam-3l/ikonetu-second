import express from 'express';
import { BigQuery } from '@google-cloud/bigquery';
import { z } from 'zod';
import { env } from '@ikonetu/config';
import { db } from '@ikonetu/database';
import {
  requestId, rateLimiter, authenticate, requireRole,
  validate, errorHandler,
} from '@ikonetu/shared/middleware';

const app = express();
app.use(express.json());
app.use(requestId);

const bq = new BigQuery({ projectId: env.BIGQUERY_PROJECT });
const DATASET = env.BIGQUERY_DATASET;

// ── Event ingestion (internal) ───────────────────────────────
export async function track(
  userId: string | null,
  eventType: string,
  eventData: Record<string, unknown> = {},
  meta: { sessionId?: string; device?: string; country?: string } = {}
): Promise<void> {
  await db('analytics_events').insert({
    user_id: userId,
    event_type: eventType,
    event_data: JSON.stringify(eventData),
    session_id: meta.sessionId,
    device: meta.device,
    country: meta.country,
  }).catch(() => {}); // non-blocking — never fail a request due to analytics
}

// ── Helpers ──────────────────────────────────────────────────
async function runQuery(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  const [rows] = await bq.query({ query: sql, params, location: 'EU' });
  return rows as Record<string, unknown>[];
}

function dateRange(req: express.Request): { from: Date; to: Date } {
  const to = req.query.to ? new Date(req.query.to as string) : new Date();
  const from = req.query.from
    ? new Date(req.query.from as string)
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return { from, to };
}

// ════════════════════════════════════════════════════════════
// REAL-TIME ANALYTICS (served from PostgreSQL — fast)
// ════════════════════════════════════════════════════════════

// GET /api/v1/analytics/realtime/active-users
app.get('/api/v1/analytics/realtime/active-users',
  rateLimiter(), authenticate, requireRole('super_admin'),
  async (req, res, next) => {
    try {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
      const [total, byRole] = await Promise.all([
        db('user_sessions').where('expires_at', '>', new Date()).where({ revoked: false }).countDistinct('user_id as count').first(),
        db('user_sessions')
          .where('expires_at', '>', new Date()).where({ revoked: false })
          .join('users', 'user_sessions.user_id', 'users.id')
          .select('users.role').countDistinct('user_sessions.user_id as count')
          .groupBy('users.role'),
      ]);
      res.json({ activeUsers: parseInt(String(total?.count || 0)), byRole, asOf: new Date().toISOString() });
    } catch (err) { next(err); }
  }
);

// GET /api/v1/analytics/realtime/signups
app.get('/api/v1/analytics/realtime/signups',
  rateLimiter(), authenticate, requireRole('super_admin'),
  async (req, res, next) => {
    try {
      const today = new Date(); today.setHours(0,0,0,0);
      const [todayCount, weekCount, monthCount] = await Promise.all([
        db('users').where('created_at', '>=', today).whereNull('deleted_at').count('id as count').first(),
        db('users').where('created_at', '>=', new Date(Date.now() - 7*24*60*60*1000)).whereNull('deleted_at').count('id as count').first(),
        db('users').where('created_at', '>=', new Date(Date.now() - 30*24*60*60*1000)).whereNull('deleted_at').count('id as count').first(),
      ]);
      res.json({
        today: parseInt(String(todayCount?.count||0)),
        week: parseInt(String(weekCount?.count||0)),
        month: parseInt(String(monthCount?.count||0)),
        asOf: new Date().toISOString(),
      });
    } catch (err) { next(err); }
  }
);

// GET /api/v1/analytics/realtime/revenue
app.get('/api/v1/analytics/realtime/revenue',
  rateLimiter(), authenticate, requireRole('super_admin'),
  async (req, res, next) => {
    try {
      const today = new Date(); today.setHours(0,0,0,0);
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

      const [todayRev, monthRev, byStream] = await Promise.all([
        db('revenue_events').where('created_at', '>=', today).sum('amount as total').first(),
        db('revenue_events').where('created_at', '>=', monthStart).sum('amount as total').first(),
        db('revenue_events').where('created_at', '>=', monthStart)
          .select('stream_id').sum('amount as total').groupBy('stream_id').orderBy('total', 'desc'),
      ]);

      res.json({
        today: parseFloat(String(todayRev?.total||0)),
        mtd: parseFloat(String(monthRev?.total||0)),
        byStream,
        currency: 'GBP',
        asOf: new Date().toISOString(),
      });
    } catch (err) { next(err); }
  }
);

// ════════════════════════════════════════════════════════════
// USER ANALYTICS
// ════════════════════════════════════════════════════════════

// GET /api/v1/analytics/users/overview
app.get('/api/v1/analytics/users/overview',
  rateLimiter(), authenticate, requireRole('super_admin'),
  async (req, res, next) => {
    try {
      const [total, byRole, byStatus, newLast30, newLast7] = await Promise.all([
        db('users').whereNull('deleted_at').count('id as count').first(),
        db('users').whereNull('deleted_at').select('role').count('id as count').groupBy('role'),
        db('users').whereNull('deleted_at').select('status').count('id as count').groupBy('status'),
        db('users').whereNull('deleted_at').where('created_at', '>=', new Date(Date.now()-30*24*60*60*1000)).count('id as count').first(),
        db('users').whereNull('deleted_at').where('created_at', '>=', new Date(Date.now()-7*24*60*60*1000)).count('id as count').first(),
      ]);

      const totalN = parseInt(String(total?.count||0));
      const last30N = parseInt(String(newLast30?.count||0));
      const last7N  = parseInt(String(newLast7?.count||0));

      res.json({
        total: totalN,
        newLast30Days: last30N,
        newLast7Days: last7N,
        growthRate30d: totalN > last30N ? Math.round((last30N / (totalN - last30N)) * 100) : 0,
        byRole, byStatus,
      });
    } catch (err) { next(err); }
  }
);

// GET /api/v1/analytics/users/growth
app.get('/api/v1/analytics/users/growth',
  rateLimiter(), authenticate, requireRole('super_admin'),
  async (req, res, next) => {
    try {
      const { from, to } = dateRange(req);
      const granularity = req.query.granularity as string || 'daily';

      const truncFn = granularity === 'monthly' ? 'month' : granularity === 'weekly' ? 'week' : 'day';

      const rows = await db('users')
        .whereNull('deleted_at')
        .where('created_at', '>=', from)
        .where('created_at', '<=', to)
        .select(db.raw(`DATE_TRUNC('${truncFn}', created_at) as period`))
        .select(db.raw('COUNT(*) as new_users'))
        .select('role')
        .groupByRaw(`DATE_TRUNC('${truncFn}', created_at), role`)
        .orderBy('period');

      res.json({ growth: rows, from, to, granularity });
    } catch (err) { next(err); }
  }
);

// GET /api/v1/analytics/users/retention
app.get('/api/v1/analytics/users/retention',
  rateLimiter(), authenticate, requireRole('super_admin'),
  async (req, res, next) => {
    try {
      // D1, D7, D30, D90 retention — users who logged in N days after signup
      const cohortSize = await db('users').whereNull('deleted_at')
        .where('created_at', '>=', new Date(Date.now() - 90*24*60*60*1000))
        .count('id as count').first();

      const d1 = await db('users as u')
        .join('user_sessions as s', 'u.id', 's.user_id')
        .whereRaw("s.created_at >= u.created_at + INTERVAL '1 day'")
        .whereRaw("s.created_at <= u.created_at + INTERVAL '2 days'")
        .where('u.created_at', '>=', new Date(Date.now()-90*24*60*60*1000))
        .countDistinct('u.id as count').first();

      const d7 = await db('users as u')
        .join('user_sessions as s', 'u.id', 's.user_id')
        .whereRaw("s.created_at >= u.created_at + INTERVAL '7 days'")
        .whereRaw("s.created_at <= u.created_at + INTERVAL '8 days'")
        .where('u.created_at', '>=', new Date(Date.now()-90*24*60*60*1000))
        .countDistinct('u.id as count').first();

      const d30 = await db('users as u')
        .join('user_sessions as s', 'u.id', 's.user_id')
        .whereRaw("s.created_at >= u.created_at + INTERVAL '30 days'")
        .whereRaw("s.created_at <= u.created_at + INTERVAL '31 days'")
        .where('u.created_at', '>=', new Date(Date.now()-90*24*60*60*1000))
        .countDistinct('u.id as count').first();

      const total = parseInt(String(cohortSize?.count||1));

      res.json({
        cohortSize: total,
        retention: {
          D1:  { users: parseInt(String(d1?.count||0)),  pct: Math.round(parseInt(String(d1?.count||0))/total*100) },
          D7:  { users: parseInt(String(d7?.count||0)),  pct: Math.round(parseInt(String(d7?.count||0))/total*100) },
          D30: { users: parseInt(String(d30?.count||0)), pct: Math.round(parseInt(String(d30?.count||0))/total*100) },
        },
        period: '90-day cohort',
      });
    } catch (err) { next(err); }
  }
);

// GET /api/v1/analytics/users/segments
app.get('/api/v1/analytics/users/segments',
  rateLimiter(), authenticate, requireRole('super_admin'),
  async (req, res, next) => {
    try {
      const sevenDaysAgo   = new Date(Date.now() - 7*24*60*60*1000);
      const thirtyDaysAgo  = new Date(Date.now() - 30*24*60*60*1000);
      const ninetyDaysAgo  = new Date(Date.now() - 90*24*60*60*1000);

      const [power, active, atRisk, dormant] = await Promise.all([
        // Power: logged in 4+ times last 7 days
        db('user_sessions').where('created_at', '>=', sevenDaysAgo).where({ revoked: false })
          .groupBy('user_id').havingRaw('COUNT(*) >= 4').countDistinct('user_id as count').first(),
        // Active: logged in last 30 days
        db('user_sessions').where('created_at', '>=', thirtyDaysAgo)
          .countDistinct('user_id as count').first(),
        // At-risk: last login 30-90 days ago
        db('users').whereNull('deleted_at')
          .where('last_login', '>=', ninetyDaysAgo).where('last_login', '<', thirtyDaysAgo)
          .count('id as count').first(),
        // Dormant: no login >90 days
        db('users').whereNull('deleted_at')
          .where(q => q.where('last_login', '<', ninetyDaysAgo).orWhereNull('last_login'))
          .count('id as count').first(),
      ]);

      res.json({
        segments: {
          power:   { count: parseInt(String(power?.count||0)),   definition: '4+ logins in 7 days' },
          active:  { count: parseInt(String(active?.count||0)),  definition: 'Active in last 30 days' },
          atRisk:  { count: parseInt(String(atRisk?.count||0)),  definition: 'Last seen 30-90 days ago' },
          dormant: { count: parseInt(String(dormant?.count||0)), definition: 'No activity >90 days' },
        },
      });
    } catch (err) { next(err); }
  }
);

// ════════════════════════════════════════════════════════════
// SCORING ANALYTICS
// ════════════════════════════════════════════════════════════

// GET /api/v1/analytics/scoring/distribution
app.get('/api/v1/analytics/scoring/distribution',
  rateLimiter(), authenticate, requireRole('super_admin', 'investor', 'lender'),
  async (req, res, next) => {
    try {
      const dist = await db('scores').where({ is_current: true })
        .select(db.raw(`
          COUNT(*) as total,
          AVG(total_score) as avg_score,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_score) as median_score,
          MIN(total_score) as min_score, MAX(total_score) as max_score,
          COUNT(*) FILTER (WHERE tier='EARLY') as early,
          COUNT(*) FILTER (WHERE tier='RISING') as rising,
          COUNT(*) FILTER (WHERE tier='INVESTABLE') as investable,
          COUNT(*) FILTER (WHERE tier='ELITE') as elite,
          AVG(confidence_pct) as avg_confidence
        `)).first();

      // Build histogram (10 buckets of 100)
      const histogram = await db('scores').where({ is_current: true })
        .select(db.raw("FLOOR(total_score/100)*100 as bucket, COUNT(*) as count"))
        .groupByRaw('FLOOR(total_score/100)*100')
        .orderBy('bucket');

      res.json({ distribution: dist, histogram });
    } catch (err) { next(err); }
  }
);

// GET /api/v1/analytics/scoring/tier-movement
app.get('/api/v1/analytics/scoring/tier-movement',
  rateLimiter(), authenticate, requireRole('super_admin'),
  async (req, res, next) => {
    try {
      // Compare latest score with 30-day-ago score per venture
      const movements = await db.raw(`
        WITH current_scores AS (
          SELECT venture_id, tier, total_score, scored_at
          FROM scores WHERE is_current = true
        ),
        old_scores AS (
          SELECT DISTINCT ON (venture_id) venture_id, tier as old_tier
          FROM score_history
          WHERE snapshot_date <= NOW() - INTERVAL '30 days'
          ORDER BY venture_id, snapshot_date DESC
        )
        SELECT
          o.old_tier, c.tier as new_tier, COUNT(*) as count
        FROM current_scores c
        JOIN old_scores o ON c.venture_id = o.venture_id
        WHERE o.old_tier != c.tier
        GROUP BY o.old_tier, c.tier
        ORDER BY count DESC
      `);

      res.json({ movements: movements.rows });
    } catch (err) { next(err); }
  }
);

// GET /api/v1/analytics/scoring/bias-audit
app.get('/api/v1/analytics/scoring/bias-audit',
  rateLimiter(), authenticate, requireRole('super_admin'),
  async (req, res, next) => {
    try {
      // 80% rule: avg score for any group must be >= 80% of overall avg
      const overall = await db('scores').where({ is_current: true }).avg('total_score as avg').first();
      const overallAvg = parseFloat(String(overall?.avg||0));
      const threshold = overallAvg * 0.8;

      const byCountry = await db('scores as s')
        .join('ventures as v', 's.venture_id', 'v.id')
        .where({ 's.is_current': true })
        .whereNotNull('v.country')
        .select('v.country')
        .avg('s.total_score as avg_score')
        .count('s.id as sample_size')
        .groupBy('v.country')
        .having(db.raw('COUNT(s.id) >= 5'))
        .orderBy('avg_score');

      const bySector = await db('scores as s')
        .join('ventures as v', 's.venture_id', 'v.id')
        .where({ 's.is_current': true })
        .whereNotNull('v.sector')
        .select('v.sector')
        .avg('s.total_score as avg_score')
        .count('s.id as sample_size')
        .groupBy('v.sector')
        .having(db.raw('COUNT(s.id) >= 5'))
        .orderBy('avg_score');

      const flaggedCountries = byCountry.filter(r => parseFloat(String(r.avg_score)) < threshold);
      const flaggedSectors = bySector.filter(r => parseFloat(String(r.avg_score)) < threshold);

      res.json({
        overallAvg: Math.round(overallAvg),
        threshold80pct: Math.round(threshold),
        biasRulePass: flaggedCountries.length === 0 && flaggedSectors.length === 0,
        flaggedCountries,
        flaggedSectors,
        byCountry,
        bySector,
        auditDate: new Date().toISOString(),
        note: 'Groups with avg score below 80% of overall average are flagged for review',
      });
    } catch (err) { next(err); }
  }
);

// GET /api/v1/analytics/scoring/progression
app.get('/api/v1/analytics/scoring/progression',
  rateLimiter(), authenticate, requireRole('super_admin'),
  async (req, res, next) => {
    try {
      const progression = await db('score_history')
        .select(db.raw("DATE_TRUNC('month', snapshot_date) as month"))
        .avg('total_score as avg_score')
        .count(db.raw('DISTINCT venture_id as venture_count'))
        .groupByRaw("DATE_TRUNC('month', snapshot_date)")
        .orderBy('month');

      res.json({ progression });
    } catch (err) { next(err); }
  }
);

// ════════════════════════════════════════════════════════════
// REVENUE ANALYTICS
// ════════════════════════════════════════════════════════════

// GET /api/v1/analytics/revenue/overview
app.get('/api/v1/analytics/revenue/overview',
  rateLimiter(), authenticate, requireRole('super_admin'),
  async (req, res, next) => {
    try {
      const now = new Date();
      const monthStart  = new Date(now.getFullYear(), now.getMonth(), 1);
      const prevMonthStart = new Date(now.getFullYear(), now.getMonth()-1, 1);
      const prevMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 0);

      const [mrr, prevMrr, allTime, byStream, subs] = await Promise.all([
        db('revenue_events').where('created_at', '>=', monthStart).sum('amount as total').first(),
        db('revenue_events').where('created_at', '>=', prevMonthStart).where('created_at', '<=', prevMonthEnd).sum('amount as total').first(),
        db('revenue_events').sum('amount as total').first(),
        db('revenue_events').where('created_at', '>=', monthStart)
          .select('stream_id').sum('amount as total').count('id as transactions').groupBy('stream_id').orderBy('total','desc'),
        db('subscriptions').whereIn('status',['active','trialing']).count('id as count').first(),
      ]);

      const mrrVal  = parseFloat(String(mrr?.total||0));
      const prevVal = parseFloat(String(prevMrr?.total||0));
      const momGrowth = prevVal > 0 ? ((mrrVal-prevVal)/prevVal)*100 : 0;

      res.json({
        mrr: mrrVal,
        arr: mrrVal * 12,
        mrrGrowthMoM: Math.round(momGrowth*10)/10,
        totalAllTime: parseFloat(String(allTime?.total||0)),
        activeSubscriptions: parseInt(String(subs?.count||0)),
        byStream,
        currency: 'GBP',
      });
    } catch (err) { next(err); }
  }
);

// GET /api/v1/analytics/revenue/mrr-movement
app.get('/api/v1/analytics/revenue/mrr-movement',
  rateLimiter(), authenticate, requireRole('super_admin'),
  async (req, res, next) => {
    try {
      const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);

      const [newMrr, expansion, churn] = await Promise.all([
        // New MRR — subscriptions created this month
        db('revenue_events').where('created_at', '>=', monthStart)
          .where({ event_type: 'subscription.created' }).sum('amount as total').first(),
        // Expansion — upgrades this month
        db('revenue_events').where('created_at', '>=', monthStart)
          .where({ event_type: 'subscription.upgraded' }).sum('amount as total').first(),
        // Churned — cancellations this month
        db('revenue_events').where('created_at', '>=', monthStart)
          .where({ event_type: 'subscription.cancelled' }).sum('amount as total').first(),
      ]);

      const newVal = parseFloat(String(newMrr?.total||0));
      const expVal = parseFloat(String(expansion?.total||0));
      const churnVal = parseFloat(String(churn?.total||0));
      const netNew = newVal + expVal - churnVal;

      res.json({
        waterfall: {
          newMrr: newVal,
          expansion: expVal,
          contraction: 0,
          churned: churnVal,
          netNew,
        },
        month: monthStart.toISOString().slice(0,7),
      });
    } catch (err) { next(err); }
  }
);

// GET /api/v1/analytics/revenue/forecast
app.get('/api/v1/analytics/revenue/forecast',
  rateLimiter(), authenticate, requireRole('super_admin'),
  async (req, res, next) => {
    try {
      const months = parseInt(req.query.months as string) || 6;

      // Simple linear regression on last 6 months of MRR
      const history = await db('revenue_events')
        .where('created_at', '>=', new Date(Date.now() - 180*24*60*60*1000))
        .select(db.raw("DATE_TRUNC('month', created_at) as month"))
        .sum('amount as revenue')
        .groupByRaw("DATE_TRUNC('month', created_at)")
        .orderBy('month');

      const values = history.map(h => parseFloat(String(h.revenue)));
      const n = values.length;

      if (n < 2) {
        return res.json({ forecast: [], message: 'Insufficient data for forecast (need 2+ months)' });
      }

      // Linear regression
      const xBar = (n-1)/2;
      const yBar = values.reduce((a,b) => a+b,0)/n;
      const slope = values.reduce((sum,y,x) => sum + (x-xBar)*(y-yBar),0) /
                    values.reduce((sum,_,x) => sum + (x-xBar)**2,0);
      const intercept = yBar - slope * xBar;

      const forecast = [];
      for (let i = 1; i <= months; i++) {
        const predicted = Math.max(0, intercept + slope * (n-1+i));
        const confidence = Math.max(60, 95 - i*5); // confidence decreases with horizon
        forecast.push({
          month: new Date(Date.now() + i*30*24*60*60*1000).toISOString().slice(0,7),
          predicted: Math.round(predicted),
          low: Math.round(predicted * 0.8),
          high: Math.round(predicted * 1.2),
          confidencePct: confidence,
        });
      }

      res.json({ historical: history, forecast, model: 'linear_regression', currency: 'GBP' });
    } catch (err) { next(err); }
  }
);

// ════════════════════════════════════════════════════════════
// FUNNEL ANALYTICS
// ════════════════════════════════════════════════════════════

// GET /api/v1/analytics/funnels/onboarding
app.get('/api/v1/analytics/funnels/onboarding',
  rateLimiter(), authenticate, requireRole('super_admin'),
  async (req, res, next) => {
    try {
      const role = req.query.role as string;
      const since = new Date(Date.now() - 30*24*60*60*1000);

      const query = db('users').where('created_at', '>=', since).whereNull('deleted_at');
      if (role) query.where({ role });

      const [registered, emailVerified, profileComplete, venturCreated, firstScore] = await Promise.all([
        query.clone().count('id as count').first(),
        query.clone().where({ email_verified: true }).count('id as count').first(),
        query.clone().where({ onboarding_completed: true }).count('id as count').first(),
        db('ventures').where('created_at', '>=', since).whereNull('deleted_at')
          .modify(q => { if (role) q.join('users','ventures.user_id','users.id').where('users.role', role); })
          .countDistinct('user_id as count').first(),
        db('scores').where('created_at', '>=', since)
          .countDistinct('venture_id as count').first(),
      ]);

      const steps = [
        { step: 'registered',       count: parseInt(String(registered?.count||0)),     label: 'Registered' },
        { step: 'email_verified',   count: parseInt(String(emailVerified?.count||0)),   label: 'Email verified' },
        { step: 'profile_complete', count: parseInt(String(profileComplete?.count||0)), label: 'Profile complete' },
        { step: 'venture_created',  count: parseInt(String(venturCreated?.count||0)),   label: 'Venture created' },
        { step: 'first_score',      count: parseInt(String(firstScore?.count||0)),      label: 'First score calculated' },
      ];

      // Add drop-off rates
      const enriched = steps.map((s, i) => ({
        ...s,
        dropOffPct: i === 0 ? 0 : steps[0].count > 0
          ? Math.round((1 - s.count/steps[i-1].count)*100) : 0,
        conversionPct: steps[0].count > 0 ? Math.round(s.count/steps[0].count*100) : 0,
      }));

      res.json({ funnel: enriched, period: '30 days', role: role || 'all' });
    } catch (err) { next(err); }
  }
);

// ════════════════════════════════════════════════════════════
// PLATFORM ANALYTICS
// ════════════════════════════════════════════════════════════

// GET /api/v1/analytics/platform/health
app.get('/api/v1/analytics/platform/health',
  rateLimiter(), authenticate, requireRole('super_admin'),
  async (req, res, next) => {
    try {
      const last24h = new Date(Date.now() - 24*60*60*1000);

      const [errors, apiCalls, scans, scores] = await Promise.all([
        db('audit_log').where('created_at', '>=', last24h).where('action', 'like', '%.error%').count('id as count').first(),
        db('analytics_events').where('created_at', '>=', last24h).count('id as count').first(),
        db('analytics_events').where('created_at', '>=', last24h).where({ event_type: 'scout.scan.completed' }).count('id as count').first(),
        db('scores').where('created_at', '>=', last24h).count('id as count').first(),
      ]);

      res.json({
        last24h: {
          errors: parseInt(String(errors?.count||0)),
          events: parseInt(String(apiCalls?.count||0)),
          scansCompleted: parseInt(String(scans?.count||0)),
          scoresCalculated: parseInt(String(scores?.count||0)),
        },
        status: parseInt(String(errors?.count||0)) < 100 ? 'healthy' : 'degraded',
        checkedAt: new Date().toISOString(),
      });
    } catch (err) { next(err); }
  }
);

// GET /api/v1/analytics/platform/matches
app.get('/api/v1/analytics/platform/matches',
  rateLimiter(), authenticate, requireRole('super_admin'),
  async (req, res, next) => {
    try {
      const stats = await db('investor_matches')
        .select(db.raw(`
          COUNT(*) as total_matches,
          COUNT(*) FILTER (WHERE status='introduced') as introductions,
          COUNT(*) FILTER (WHERE status='interested') as interested,
          AVG(match_score) as avg_match_score
        `)).first();
      res.json({ matches: stats });
    } catch (err) { next(err); }
  }
);

// POST /api/v1/analytics/track (frontend event ingestion)
app.post('/api/v1/analytics/track',
  rateLimiter({ max: 500 }),
  async (req, res, next) => {
    try {
      const { eventType, eventData, sessionId, device, country } = req.body as {
        eventType: string;
        eventData?: Record<string, unknown>;
        sessionId?: string;
        device?: string;
        country?: string;
      };

      if (!eventType) return res.json({ ok: false });

      await track(null, eventType, eventData||{}, { sessionId, device, country });
      res.json({ ok: true });
    } catch (err) { next(err); }
  }
);

app.get('/health', (_, res) => res.json({
  service: 'analytics-service', status: 'ok', version: '1.0.0',
  timestamp: new Date().toISOString(),
}));

app.use(errorHandler);

const PORT = parseInt(env.PORT) + 10; // 3011
async function start() {
  env.NODE_ENV;
  const { initRedis } = await import('@ikonetu/shared/middleware');
  await initRedis();
  app.listen(PORT, () => console.log(`✅ analytics-service running on port ${PORT}`));
}
start().catch((err) => { console.error(err); process.exit(1); });

export default app;
export { track };
