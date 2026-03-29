import express from 'express';
import { createClient } from 'redis';
import { z } from 'zod';
import { env } from '@ikonetu/config';
import { db } from '@ikonetu/database';
import {
  requestId, rateLimiter, authenticate, requireRole,
  validate, errorHandler, AppError,
} from '@ikonetu/shared/middleware';

// ════════════════════════════════════════════════════════════
// API METERING SERVICE — port 3017
// Redis-based real-time quota enforcement for R01 Score API
// Counters: per-minute, per-hour, per-day, per-month
// Overage: charged at R01_per_query rate via Stripe metered billing
// ════════════════════════════════════════════════════════════

const app = express();
app.use(express.json());
app.use(requestId);

let redis: ReturnType<typeof createClient>;

// ── Counter keys ─────────────────────────────────────────────
const KEYS = {
  minute: (uid: string) => `meter:${uid}:${minuteWindow()}`,
  hour:   (uid: string) => `meter:${uid}:${hourWindow()}`,
  day:    (uid: string) => `meter:${uid}:${dayWindow()}`,
  month:  (uid: string) => `meter:${uid}:${monthWindow()}`,
};

function minuteWindow() { return `m:${Math.floor(Date.now() / 60_000)}`; }
function hourWindow()   { return `h:${Math.floor(Date.now() / 3_600_000)}`; }
function dayWindow()    { return `d:${new Date().toISOString().slice(0, 10)}`; }
function monthWindow()  { return `mo:${new Date().toISOString().slice(0, 7)}`; }

// ── Rate limits (configurable per subscription tier) ─────────
const LIMITS = {
  free:       { perMinute: 5,   perHour: 50,   perDay: 200,   perMonth: 1_000 },
  starter:    { perMinute: 20,  perHour: 200,  perDay: 2_000, perMonth: 10_000 },
  growth:     { perMinute: 100, perHour: 1_000,perDay: 10_000,perMonth: 50_000 },
  enterprise: { perMinute: 500, perHour: 5_000,perDay: 50_000,perMonth: 200_000 },
};

type Tier = keyof typeof LIMITS;

async function getUserTier(userId: string): Promise<Tier> {
  const sub = await db('subscriptions')
    .where({ user_id: userId })
    .whereIn('status', ['active', 'trialing'])
    .join('plans', 'subscriptions.plan_id', 'plans.id')
    .select('plans.name')
    .first();

  if (!sub) return 'free';
  const name = String(sub.name || '').toLowerCase();
  if (name.includes('enterprise')) return 'enterprise';
  if (name.includes('growth') || name.includes('pro')) return 'growth';
  if (name.includes('starter')) return 'starter';
  return 'free';
}

// ── Middleware: check quota before allowing API call ─────────
export async function checkApiQuota(
  userId: string,
  endpoint: string = 'score_query'
): Promise<{ allowed: boolean; remaining: number; resetAt: string; tier: string }> {
  const tier = await getUserTier(userId);
  const limits = LIMITS[tier];

  const [minCount, hourCount, dayCount, monthCount] = await Promise.all([
    redis.incr(KEYS.minute(userId)).then(v => { redis.expire(KEYS.minute(userId), 61); return v; }),
    redis.incr(KEYS.hour(userId)).then(v => { redis.expire(KEYS.hour(userId), 3601); return v; }),
    redis.incr(KEYS.day(userId)).then(v => { redis.expire(KEYS.day(userId), 86401); return v; }),
    redis.incr(KEYS.month(userId)).then(v => { redis.expire(KEYS.month(userId), 2678401); return v; }),
  ]);

  // Determine the binding constraint
  if (minCount > limits.perMinute) {
    const resetAt = new Date(Math.ceil(Date.now() / 60_000) * 60_000).toISOString();
    // Decrement — don't count this failed check
    await redis.decr(KEYS.minute(userId));
    return { allowed: false, remaining: 0, resetAt, tier };
  }
  if (hourCount > limits.perHour) {
    const resetAt = new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000).toISOString();
    await redis.decr(KEYS.hour(userId));
    return { allowed: false, remaining: 0, resetAt, tier };
  }
  if (dayCount > limits.perDay) {
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(0,0,0,0);
    await redis.decr(KEYS.day(userId));
    return { allowed: false, remaining: 0, resetAt: tomorrow.toISOString(), tier };
  }
  if (monthCount > limits.perMonth) {
    // Overage — charge metered or block
    const nextMonth = new Date(); nextMonth.setMonth(nextMonth.getMonth() + 1); nextMonth.setDate(1); nextMonth.setHours(0,0,0,0);
    await redis.decr(KEYS.month(userId));
    return { allowed: false, remaining: 0, resetAt: nextMonth.toISOString(), tier };
  }

  // Also sync to DB for billing accuracy (async — non-blocking)
  db('api_usage')
    .insert({ user_id: userId, endpoint, calls_today: 1, calls_month: 1, quota_monthly: limits.perMonth })
    .onConflict(['user_id', 'endpoint'])
    .merge({
      calls_today: db.raw('api_usage.calls_today + 1'),
      calls_month: db.raw('api_usage.calls_month + 1'),
      updated_at: new Date(),
    })
    .catch(() => {}); // non-blocking

  return {
    allowed: true,
    remaining: Math.min(
      limits.perMinute - minCount,
      limits.perHour - hourCount,
      limits.perDay - dayCount,
      limits.perMonth - monthCount,
    ),
    resetAt: new Date(Math.ceil(Date.now() / 60_000) * 60_000).toISOString(),
    tier,
  };
}

// ════════════════════════════════════════════════════════════
// ROUTES
// ════════════════════════════════════════════════════════════

// GET /api/v1/metering/quota — caller's current quota status
app.get(
  '/api/v1/metering/quota',
  rateLimiter(),
  authenticate,
  async (req, res, next) => {
    try {
      const tier = await getUserTier(req.user!.id);
      const limits = LIMITS[tier];

      const [minuteCount, hourCount, dayCount, monthCount] = await Promise.all([
        redis.get(KEYS.minute(req.user!.id)).then(v => parseInt(v || '0')),
        redis.get(KEYS.hour(req.user!.id)).then(v => parseInt(v || '0')),
        redis.get(KEYS.day(req.user!.id)).then(v => parseInt(v || '0')),
        redis.get(KEYS.month(req.user!.id)).then(v => parseInt(v || '0')),
      ]);

      res.json({
        tier,
        limits,
        current: { minute: minuteCount, hour: hourCount, day: dayCount, month: monthCount },
        remaining: {
          minute: Math.max(0, limits.perMinute - minuteCount),
          hour:   Math.max(0, limits.perHour - hourCount),
          day:    Math.max(0, limits.perDay - dayCount),
          month:  Math.max(0, limits.perMonth - monthCount),
        },
        pctUsed: Math.round((monthCount / limits.perMonth) * 100),
        upgradeAvailable: tier !== 'enterprise',
      });
    } catch (err) { next(err); }
  }
);

// POST /api/v1/metering/check — internal endpoint for other services
// Called by scoring-service before serving API queries
app.post(
  '/api/v1/metering/check',
  rateLimiter({ max: 1000, keyPrefix: 'meter_check' }),
  authenticate,
  validate({ body: z.object({ userId: z.string().uuid(), endpoint: z.string().default('score_query') }) }),
  async (req, res, next) => {
    try {
      const result = await checkApiQuota(req.body.userId, req.body.endpoint);
      if (!result.allowed) {
        return res.status(429).json({
          type: 'https://ikonetu.com/errors/quota-exceeded',
          title: 'API quota exceeded',
          status: 429,
          tier: result.tier,
          remaining: 0,
          resetAt: result.resetAt,
          upgradeUrl: '/billing',
        });
      }
      res.json(result);
    } catch (err) { next(err); }
  }
);

// GET /api/v1/metering/usage/:userId — admin view
app.get(
  '/api/v1/metering/usage/:userId',
  rateLimiter(),
  authenticate,
  requireRole('super_admin'),
  async (req, res, next) => {
    try {
      const usage = await db('api_usage')
        .where({ user_id: req.params.userId })
        .select('*');
      const tier = await getUserTier(req.params.userId);
      res.json({ usage, tier, limits: LIMITS[tier] });
    } catch (err) { next(err); }
  }
);

// GET /api/v1/metering/stats — platform-wide API usage (admin)
app.get(
  '/api/v1/metering/stats',
  rateLimiter(),
  authenticate,
  requireRole('super_admin'),
  async (req, res, next) => {
    try {
      const [totalCalls, topUsers, dailyTotal] = await Promise.all([
        db('api_usage').sum('calls_month as total').first(),
        db('api_usage')
          .join('users', 'api_usage.user_id', 'users.id')
          .select('users.email', 'api_usage.calls_month', 'api_usage.calls_today')
          .orderBy('calls_month', 'desc').limit(10),
        db('api_usage').sum('calls_today as total').first(),
      ]);

      res.json({
        totalCallsThisMonth: parseInt(String(totalCalls?.total || 0)),
        totalCallsToday: parseInt(String(dailyTotal?.total || 0)),
        topUsers,
        estimatedR01Revenue: parseInt(String(totalCalls?.total || 0)) * 0.15,
      });
    } catch (err) { next(err); }
  }
);

app.get('/health', (_, res) => res.json({
  service: 'api-metering-service', status: 'ok', version: '1.0.0',
  tiers: Object.keys(LIMITS),
  timestamp: new Date().toISOString(),
}));

app.use(errorHandler);

const PORT = parseInt(env.PORT) + 16; // 3017
async function start() {
  env.NODE_ENV;
  redis = createClient({ url: env.REDIS_URL });
  await redis.connect();
  app.listen(PORT, () => {
    console.log(`✅ api-metering-service running on port ${PORT}`);
    console.log(`   Tiers: ${Object.keys(LIMITS).join(', ')}`);
  });
}
start().catch((err) => { console.error(err); process.exit(1); });

export { checkApiQuota };
export default app;
