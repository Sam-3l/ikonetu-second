import express from 'express';
import { z } from 'zod';
import { env } from '@ikonetu/config';
import { db } from '@ikonetu/database';
import {
  requestId, rateLimiter, authenticate, requireRole,
  requireInvestor, requireProvider, requireLender, requireUniversity,
  validate, auditLog, errorHandler, AppError, NotFoundError,
} from '@ikonetu/shared/middleware';

const app = express();
app.use(express.json());
app.use(requestId);

// ════════════════════════════════════════════════════════════
// INVESTOR SERVICE
// ════════════════════════════════════════════════════════════

// POST /api/v1/investors/profile
app.post('/api/v1/investors/profile',
  rateLimiter(), authenticate, requireInvestor,
  validate({ body: z.object({
    firm_name:            z.string().max(200).optional(),
    fund_size:            z.number().positive().optional(),
    investment_range_min: z.number().positive().optional(),
    investment_range_max: z.number().positive().optional(),
    currency:             z.string().length(3).default('GBP'),
  })}),
  auditLog('investor.profile.update', 'investor_profile'),
  async (req, res, next) => {
    try {
      const [profile] = await db('investor_profiles')
        .insert({ user_id: req.user!.id, ...req.body })
        .onConflict('user_id').merge({ ...req.body, updated_at: new Date() })
        .returning('*');
      res.json({ profile });
    } catch (err) { next(err); }
  }
);

// POST /api/v1/investors/thesis
app.post('/api/v1/investors/thesis',
  rateLimiter(), authenticate, requireInvestor,
  validate({ body: z.object({
    sectors:           z.array(z.string()).default([]),
    geographies:       z.array(z.string()).default([]),
    score_range_min:   z.number().min(0).max(1000).default(0),
    score_range_max:   z.number().min(0).max(1000).default(1000),
    stage_preferences: z.array(z.enum(['idea','mvp','revenue','scaling'])).default([]),
  })}),
  auditLog('investor.thesis.update', 'investor_thesis'),
  async (req, res, next) => {
    try {
      const profile = await db('investor_profiles').where({ user_id: req.user!.id }).first();
      if (!profile) throw new AppError('Create an investor profile first', 400, 'no-profile');

      const [thesis] = await db('investor_theses')
        .insert({ investor_id: profile.id, ...req.body, sectors: JSON.stringify(req.body.sectors), geographies: JSON.stringify(req.body.geographies), stage_preferences: JSON.stringify(req.body.stage_preferences) })
        .onConflict('investor_id').merge()
        .returning('*');

      res.json({ thesis });
    } catch (err) { next(err); }
  }
);

// GET /api/v1/investors/matches — founders matching thesis
app.get('/api/v1/investors/matches',
  rateLimiter(), authenticate, requireInvestor,
  async (req, res, next) => {
    try {
      const profile = await db('investor_profiles').where({ user_id: req.user!.id }).first();
      if (!profile) throw new AppError('Complete your investor profile to see matches', 400, 'no-profile');

      const thesis = await db('investor_theses').where({ investor_id: profile.id }).first();
      const minScore = thesis?.score_range_min ?? 0;
      const maxScore = thesis?.score_range_max ?? 1000;
      const sectors: string[] = thesis?.sectors ?? [];
      const geographies: string[] = thesis?.geographies ?? [];

      const query = db('scores as s')
        .join('ventures as v', 's.venture_id', 'v.id')
        .join('users as u', 'v.user_id', 'u.id')
        .join('user_consents as c', function() {
          this.on('c.user_id', 'v.user_id')
              .andOn(db.raw("c.consent_type = 'score_share_investors'"))
              .andOn(db.raw('c.granted = true'));
        })
        .where({ 's.is_current': true })
        .where('s.total_score', '>=', minScore)
        .where('s.total_score', '<=', maxScore)
        .whereNull('v.deleted_at')
        .whereNull('u.deleted_at')
        .where({ 'u.status': 'active' });

      if (sectors.length) query.whereIn('v.sector', sectors);
      if (geographies.length) query.whereIn('v.country', geographies);

      const matches = await query
        .select('v.id as venture_id','v.name','v.sector','v.country','v.stage','v.description',
                's.total_score','s.tier','s.confidence_pct')
        .orderBy('s.total_score','desc')
        .limit(50);

      // Upsert match records
      for (const m of matches) {
        await db('investor_matches')
          .insert({ investor_id: profile.id, venture_id: m.venture_id, match_score: m.total_score, match_reasons: JSON.stringify([`Score: ${m.total_score}`]) })
          .onConflict(['investor_id','venture_id']).merge({ match_score: m.total_score });
      }

      res.json({ matches, thesis: { minScore, maxScore, sectors, geographies } });
    } catch (err) { next(err); }
  }
);

// POST /api/v1/investors/matches/:id/introduce — R05
app.post('/api/v1/investors/matches/:id/introduce',
  rateLimiter({ max: 20 }), authenticate, requireInvestor,
  auditLog('investor.introduction.requested', 'investor_match'),
  async (req, res, next) => {
    try {
      const profile = await db('investor_profiles').where({ user_id: req.user!.id }).first();
      if (!profile) throw new AppError('Investor profile required', 400, 'no-profile');

      // Check intro credits (R05)
      const balance = await db('credit_balances')
        .where({ user_id: req.user!.id, credit_type: 'introductions' })
        .first();
      if (!balance || balance.balance <= 0) {
        throw new AppError('Insufficient introduction credits. Purchase a pack from Billing.', 402, 'no-credits');
      }

      const match = await db('investor_matches')
        .where({ id: req.params.id, investor_id: profile.id })
        .first();
      if (!match) throw new NotFoundError('Match');

      // Deduct credit
      await db('credit_balances').where({ user_id: req.user!.id, credit_type: 'introductions' }).decrement('balance', 1);

      await db('investor_matches').where({ id: req.params.id }).update({ status: 'introduced', introduced_at: new Date() });

      // Notify founder
      const venture = await db('ventures').where({ id: match.venture_id }).first();
      if (venture) {
        await db('notifications').insert({
          user_id: venture.user_id,
          type: 'investor.introduction',
          title: 'An investor wants to connect with you',
          body: `${profile.firm_name || 'An investor'} has requested an introduction through IkonetU.`,
          data: JSON.stringify({ investorId: profile.id, matchId: match.id }),
        });
      }

      res.json({ success: true, creditsRemaining: balance.balance - 1 });
    } catch (err) { next(err); }
  }
);

// GET/POST /api/v1/investors/deal-rooms
app.get('/api/v1/investors/deal-rooms',
  rateLimiter(), authenticate, requireInvestor,
  async (req, res, next) => {
    try {
      const profile = await db('investor_profiles').where({ user_id: req.user!.id }).first();
      const rooms = await db('deal_rooms')
        .where({ investor_id: profile?.id })
        .whereNull('deleted_at');

      const enriched = await Promise.all(rooms.map(async r => ({
        ...r,
        founderCount: await db('deal_room_founders')
          .where({ deal_room_id: r.id, status: 'active' })
          .count('id as count').first().then(c => parseInt(String(c?.count||0))),
      })));

      res.json({ dealRooms: enriched });
    } catch (err) { next(err); }
  }
);

app.post('/api/v1/investors/deal-rooms',
  rateLimiter(), authenticate, requireInvestor,
  validate({ body: z.object({ name: z.string().min(1).max(200), filters: z.record(z.unknown()).optional() }) }),
  auditLog('investor.deal-room.created', 'deal_room'),
  async (req, res, next) => {
    try {
      const profile = await db('investor_profiles').where({ user_id: req.user!.id }).first();
      if (!profile) throw new AppError('Investor profile required', 400, 'no-profile');

      const [room] = await db('deal_rooms')
        .insert({ investor_id: profile.id, ...req.body })
        .returning('*');
      res.status(201).json({ dealRoom: room });
    } catch (err) { next(err); }
  }
);

// Add/remove founders from deal room
app.post('/api/v1/investors/deal-rooms/:id/founders',
  rateLimiter(), authenticate, requireInvestor,
  validate({ body: z.object({ ventureId: z.string().uuid() }) }),
  async (req, res, next) => {
    try {
      const profile = await db('investor_profiles').where({ user_id: req.user!.id }).first();
      const room = await db('deal_rooms').where({ id: req.params.id, investor_id: profile?.id }).first();
      if (!room) throw new NotFoundError('Deal room');

      const [entry] = await db('deal_room_founders')
        .insert({ deal_room_id: req.params.id, venture_id: req.body.ventureId })
        .onConflict(['deal_room_id','venture_id']).merge({ status: 'active' })
        .returning('*');

      res.json({ entry });
    } catch (err) { next(err); }
  }
);

// ════════════════════════════════════════════════════════════
// SERVICE PROVIDER SERVICE
// ════════════════════════════════════════════════════════════

app.post('/api/v1/providers/profile',
  rateLimiter(), authenticate, requireProvider,
  validate({ body: z.object({
    firm_name:      z.string().max(200).optional(),
    services:       z.array(z.string()).default([]),
    coverage_areas: z.array(z.string()).default([]),
  })}),
  auditLog('provider.profile.update', 'provider_profile'),
  async (req, res, next) => {
    try {
      const [profile] = await db('provider_profiles')
        .insert({ user_id: req.user!.id, ...req.body, services: JSON.stringify(req.body.services), coverage_areas: JSON.stringify(req.body.coverage_areas) })
        .onConflict('user_id').merge()
        .returning('*');
      res.json({ profile });
    } catch (err) { next(err); }
  }
);

// GET /api/v1/providers/matches — founders with score gaps
app.get('/api/v1/providers/matches',
  rateLimiter(), authenticate, requireProvider,
  async (req, res, next) => {
    try {
      const profile = await db('provider_profiles').where({ user_id: req.user!.id }).first();
      if (!profile) throw new AppError('Complete your provider profile to see matches', 400, 'no-profile');

      const services: string[] = profile.services || [];
      const CATEGORY_MAP: Record<string, string> = {
        'legal_services': 'legal', 'accounting_tax': 'financial',
        'hr_people': 'team', 'technology': 'product',
        'marketing_brand': 'media', 'strategy_advisory': 'market',
      };

      // Find founders with low scores in categories this provider serves
      const relevantCategories = services.map(s => CATEGORY_MAP[s]).filter(Boolean);

      const matches = await db('score_breakdowns as sb')
        .join('scores as s', 'sb.score_id', 's.id')
        .join('ventures as v', 's.venture_id', 'v.id')
        .join('users as u', 'v.user_id', 'u.id')
        .where({ 's.is_current': true })
        .whereNull('v.deleted_at')
        .where('sb.weighted_score', '<', db.raw('sb.max_possible * 0.5')) // <50% of max
        .modify(q => { if (relevantCategories.length) q.whereIn('sb.category', relevantCategories); })
        .select(
          'v.id as venture_id', 'v.name', 'v.country', 'v.sector',
          's.total_score', 's.tier',
          'sb.category', 'sb.weighted_score', 'sb.max_possible',
          db.raw('sb.max_possible - sb.weighted_score as score_gap')
        )
        .orderBy('score_gap', 'desc')
        .limit(30);

      // Upsert leads
      for (const m of matches) {
        await db('provider_leads')
          .insert({ provider_id: profile.id, venture_id: m.venture_id, score_gap: m.score_gap, service_needed: m.category })
          .onConflict(['provider_id','venture_id']).merge({ score_gap: m.score_gap });
      }

      res.json({ matches });
    } catch (err) { next(err); }
  }
);

// POST /api/v1/providers/matches/:id/connect — R07 lead fee
app.post('/api/v1/providers/matches/:id/connect',
  rateLimiter(), authenticate, requireProvider,
  auditLog('provider.lead.connected', 'provider_lead'),
  async (req, res, next) => {
    try {
      const profile = await db('provider_profiles').where({ user_id: req.user!.id }).first();

      const balance = await db('credit_balances')
        .where({ user_id: req.user!.id, credit_type: 'leads' })
        .first();
      if (!balance || balance.balance <= 0) {
        throw new AppError('Insufficient lead credits. Purchase a pack from Billing.', 402, 'no-credits');
      }

      await db('credit_balances').where({ user_id: req.user!.id, credit_type: 'leads' }).decrement('balance', 1);
      await db('provider_leads')
        .where({ id: req.params.id, provider_id: profile?.id })
        .update({ status: 'accepted', connected_at: new Date() });

      res.json({ success: true, creditsRemaining: balance.balance - 1 });
    } catch (err) { next(err); }
  }
);

// ════════════════════════════════════════════════════════════
// LENDER SERVICE
// ════════════════════════════════════════════════════════════

app.post('/api/v1/lenders/profile',
  rateLimiter(), authenticate, requireLender,
  validate({ body: z.object({
    institution_name: z.string().min(2).max(200),
    licence_type:     z.string().max(100).optional(),
  })}),
  auditLog('lender.profile.update', 'lender_profile'),
  async (req, res, next) => {
    try {
      const [profile] = await db('lender_profiles')
        .insert({ user_id: req.user!.id, ...req.body })
        .onConflict('user_id').merge()
        .returning('*');
      res.json({ profile });
    } catch (err) { next(err); }
  }
);

// GET /api/v1/lenders/pool — pre-qualified borrowers
app.get('/api/v1/lenders/pool',
  rateLimiter(), authenticate, requireLender,
  async (req, res, next) => {
    try {
      const profile = await db('lender_profiles').where({ user_id: req.user!.id }).first();
      const criteria = profile ? await db('lender_criteria').where({ lender_id: profile.id }).first() : null;

      const minScore = criteria?.min_score ?? 0;
      const minBankability = criteria?.min_bankability ?? 0;

      const pool = await db('bankability_scores as b')
        .join('ventures as v', 'b.venture_id', 'v.id')
        .join('scores as s', function() { this.on('s.venture_id','b.venture_id').andOn(db.raw('s.is_current = true')); })
        .join('user_consents as c', function() {
          this.on('c.user_id','v.user_id')
              .andOn(db.raw("c.consent_type = 'lender_pool'"))
              .andOn(db.raw('c.granted = true'));
        })
        .where('s.total_score', '>=', minScore)
        .where('b.total_score', '>=', minBankability)
        .whereNull('v.deleted_at')
        .select('v.id','v.name','v.sector','v.country','v.stage',
                's.total_score as iku_score','s.tier',
                'b.total_score as bankability_score')
        .orderBy('b.total_score','desc')
        .limit(100);

      // Log data access
      for (const p of pool) {
        await db('data_access_log').insert({
          accessor_id: req.user!.id,
          accessed_user_id: p.id,
          data_type: 'lender_pool_view',
          purpose: 'lender_prospecting',
        }).catch(() => {});
      }

      res.json({ pool, criteria: { minScore, minBankability } });
    } catch (err) { next(err); }
  }
);

// GET /api/v1/lenders/alerts
app.get('/api/v1/lenders/alerts',
  rateLimiter(), authenticate, requireLender,
  async (req, res, next) => {
    try {
      const lenderProfile = await db('lender_profiles').where({ user_id: req.user!.id }).first();
      if (!lenderProfile) return res.json({ alerts: [] });

      const alerts = await db('lender_alerts as a')
        .join('lender_portfolios as p', 'a.portfolio_id', 'p.id')
        .join('ventures as v', 'p.venture_id', 'v.id')
        .where({ 'p.lender_id': lenderProfile.id, 'a.acknowledged': false })
        .select('a.*','v.name as venture_name','v.country')
        .orderBy('a.created_at','desc');

      res.json({ alerts });
    } catch (err) { next(err); }
  }
);

// PUT /api/v1/lenders/alerts/:id (acknowledge)
app.put('/api/v1/lenders/alerts/:id',
  rateLimiter(), authenticate, requireLender,
  async (req, res, next) => {
    try {
      await db('lender_alerts').where({ id: req.params.id }).update({ acknowledged: true });
      res.json({ success: true });
    } catch (err) { next(err); }
  }
);

// ════════════════════════════════════════════════════════════
// UNIVERSITY SERVICE
// ════════════════════════════════════════════════════════════

app.post('/api/v1/universities/profile',
  rateLimiter(), authenticate, requireUniversity,
  validate({ body: z.object({
    institution_name: z.string().min(2).max(200),
    country:          z.string().length(2).optional(),
    city:             z.string().max(100).optional(),
    email_domain:     z.string().max(200).optional(),
  })}),
  async (req, res, next) => {
    try {
      const [profile] = await db('university_profiles')
        .insert({ user_id: req.user!.id, ...req.body })
        .onConflict('user_id').merge()
        .returning('*');
      res.json({ profile });
    } catch (err) { next(err); }
  }
);

// GET /api/v1/universities/founders — matched by email domain
app.get('/api/v1/universities/founders',
  rateLimiter(), authenticate, requireUniversity,
  async (req, res, next) => {
    try {
      const uniProfile = await db('university_profiles').where({ user_id: req.user!.id }).first();
      if (!uniProfile) throw new AppError('Complete your university profile first', 400, 'no-profile');

      const founders = await db('users as u')
        .join('ventures as v', 'u.user_id', 'u.id')
        .leftJoin('scores as s', function() { this.on('s.venture_id','v.id').andOn(db.raw('s.is_current = true')); })
        .where({ 'u.role': 'founder' })
        .whereNull('u.deleted_at')
        .modify(q => {
          if (uniProfile.email_domain) {
            q.where('u.email', 'ilike', `%@${uniProfile.email_domain}`);
          }
        })
        .select('v.id','v.name','v.sector','v.country','s.total_score','s.tier')
        .orderBy('s.total_score','desc')
        .limit(200);

      res.json({
        founders,
        summary: {
          total: founders.length,
          avgScore: founders.length > 0
            ? Math.round(founders.reduce((s,f) => s + (f.total_score||0), 0) / founders.length)
            : 0,
          byTier: ['EARLY','RISING','INVESTABLE','ELITE'].reduce((acc, tier) => ({
            ...acc, [tier]: founders.filter(f => f.tier === tier).length,
          }), {}),
        },
      });
    } catch (err) { next(err); }
  }
);

// GET /api/v1/universities/rankings — public leaderboard
app.get('/api/v1/universities/rankings',
  rateLimiter(),
  async (req, res, next) => {
    try {
      const rankings = await db('university_profiles as up')
        .join('university_founders as uf', 'uf.university_id', 'up.id')
        .join('scores as s', function() {
          this.on('s.venture_id', 'uf.venture_id').andOn(db.raw('s.is_current = true'));
        })
        .select('up.id','up.institution_name','up.country','up.city')
        .count('uf.venture_id as founder_count')
        .avg('s.total_score as avg_score')
        .countRaw("DISTINCT CASE WHEN s.tier IN ('INVESTABLE','ELITE') THEN uf.venture_id END as investable_count")
        .groupBy('up.id','up.institution_name','up.country','up.city')
        .having(db.raw('COUNT(uf.venture_id) >= 1'))
        .orderBy('avg_score','desc');

      res.json({ rankings });
    } catch (err) { next(err); }
  }
);

app.get('/health', (_, res) => res.json({
  service: 'roles-service',
  covers: ['investor','provider','lender','university'],
  status: 'ok', version: '1.0.0',
  timestamp: new Date().toISOString(),
}));

app.use(errorHandler);

const PORT = parseInt(env.PORT) + 12; // 3013
async function start() {
  env.NODE_ENV;
  const { initRedis } = await import('@ikonetu/shared/middleware');
  await initRedis();
  app.listen(PORT, () => console.log(`✅ roles-service running on port ${PORT}`));
}
start().catch((err) => { console.error(err); process.exit(1); });

export default app;
