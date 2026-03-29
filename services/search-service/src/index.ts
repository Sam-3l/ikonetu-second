import express from 'express';
import { z } from 'zod';
import { env } from '@ikonetu/config';
import { db } from '@ikonetu/database';
import {
  requestId, rateLimiter, authenticate,
  validate, errorHandler, AppError,
} from '@ikonetu/shared/middleware';

const app = express();
app.use(express.json());
app.use(requestId);

// ════════════════════════════════════════════════════════════
// SEARCH SERVICE — port 3017
// PostgreSQL full-text search using tsvector/tsquery
// No Elasticsearch dependency — works with existing Cloud SQL
//
// Indexes maintained on:
//   ventures(name, description, sector, country)
//   users(name, email) — founders only
//   provider_listings(title, description, category)
//
// Search types:
//   /search/ventures  — investor + lender discovery
//   /search/providers — founder marketplace search
//   /search/founders  — provider lead discovery
//   /search/global    — admin cross-entity search
// ════════════════════════════════════════════════════════════

// ── Full-text search helpers ─────────────────────────────────

function toTsQuery(input: string): string {
  // Convert user input to a safe tsquery
  // "paystack nigeria" → "paystack & nigeria"
  // "pay*" → "pay:*"  (prefix search)
  return input
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(word => {
      // Strip any SQL-dangerous characters
      const safe = word.replace(/[^a-zA-Z0-9\-_]/g, '');
      if (!safe) return null;
      // Trailing * means prefix search
      return word.endsWith('*') ? `${safe}:*` : safe;
    })
    .filter(Boolean)
    .join(' & ');
}

const SearchSchema = z.object({
  q:       z.string().min(1).max(200),
  page:    z.string().optional().default('1'),
  limit:   z.string().optional().default('20'),
  country: z.string().length(2).optional(),
  sector:  z.string().max(100).optional(),
  tier:    z.enum(['EARLY', 'RISING', 'INVESTABLE', 'ELITE']).optional(),
  stage:   z.enum(['idea', 'mvp', 'revenue', 'scaling']).optional(),
  sort:    z.enum(['relevance', 'score_desc', 'score_asc', 'newest']).optional().default('relevance'),
});

// ── GET /api/v1/search/ventures ──────────────────────────────
// Used by: investors browsing founders, lenders finding borrowers
app.get(
  '/api/v1/search/ventures',
  rateLimiter({ max: 60 }),
  authenticate,
  validate({ query: SearchSchema }),
  async (req, res, next) => {
    try {
      const { q, page, limit, country, sector, tier, stage, sort } = req.query as z.infer<typeof SearchSchema>;
      const pageN  = Math.max(1, parseInt(page));
      const limitN = Math.min(50, parseInt(limit));
      const offset = (pageN - 1) * limitN;
      const tsQuery = toTsQuery(q);

      if (!tsQuery) return res.json({ results: [], total: 0, page: pageN, limit: limitN });

      // Build the query with tsvector matching + optional filters
      const baseQuery = db('ventures as v')
        .join('users as u', 'v.user_id', 'u.id')
        .leftJoin('scores as s', function () {
          this.on('s.venture_id', 'v.id').andOn(db.raw('s.is_current = true'));
        })
        .whereNull('v.deleted_at')
        .where({ 'u.status': 'active' })
        .whereRaw(
          `to_tsvector('english', COALESCE(v.name,'') || ' ' || COALESCE(v.description,'') || ' ' || COALESCE(v.sector,'') || ' ' || COALESCE(v.country,'')) @@ to_tsquery('english', ?)`,
          [tsQuery]
        );

      if (country) baseQuery.where('v.country', country);
      if (sector)  baseQuery.where('v.sector', 'ilike', `%${sector}%`);
      if (tier)    baseQuery.where('s.tier', tier);
      if (stage)   baseQuery.where('v.stage', stage);

      // Consent gate — only show founders who consented to investor discovery
      if (req.user!.role === 'investor') {
        baseQuery.join('user_consents as c', function () {
          this.on('c.user_id', 'u.id')
            .andOn(db.raw("c.consent_type = 'score_share_investors'"))
            .andOn(db.raw('c.granted = true'));
        });
      }
      if (req.user!.role === 'lender') {
        baseQuery.join('user_consents as c', function () {
          this.on('c.user_id', 'u.id')
            .andOn(db.raw("c.consent_type = 'lender_pool'"))
            .andOn(db.raw('c.granted = true'));
        });
      }

      // Sort
      switch (sort) {
        case 'score_desc': baseQuery.orderBy('s.total_score', 'desc'); break;
        case 'score_asc':  baseQuery.orderBy('s.total_score', 'asc');  break;
        case 'newest':     baseQuery.orderBy('v.created_at', 'desc');  break;
        default:
          // Relevance — ts_rank
          baseQuery.orderByRaw(
            `ts_rank(to_tsvector('english', COALESCE(v.name,'') || ' ' || COALESCE(v.description,'')), to_tsquery('english', ?)) DESC`,
            [tsQuery]
          );
      }

      const [results, [{ count }]] = await Promise.all([
        baseQuery.clone()
          .select(
            'v.id', 'v.name', 'v.description', 'v.sector', 'v.country',
            'v.stage', 'v.city', 'v.created_at',
            'u.name as founder_name',
            's.total_score', 's.tier', 's.confidence_pct',
            db.raw(`ts_rank(to_tsvector('english', COALESCE(v.name,'') || ' ' || COALESCE(v.description,'')), to_tsquery('english', ?)) as relevance`, [tsQuery])
          )
          .limit(limitN).offset(offset),
        baseQuery.clone().count('v.id as count'),
      ]);

      // Log the search for analytics
      await db('analytics_events').insert({
        user_id: req.user!.id,
        event_type: 'search.ventures',
        event_data: JSON.stringify({ q, filters: { country, sector, tier, stage }, resultCount: parseInt(String(count)) }),
      }).catch(() => {});

      res.json({
        results,
        total: parseInt(String(count)),
        page: pageN,
        limit: limitN,
        query: q,
      });
    } catch (err) { next(err); }
  }
);

// ── GET /api/v1/search/providers ─────────────────────────────
// Used by: founders browsing the service marketplace
app.get(
  '/api/v1/search/providers',
  rateLimiter({ max: 60 }),
  authenticate,
  validate({
    query: z.object({
      q:        z.string().min(1).max(200),
      page:     z.string().optional().default('1'),
      limit:    z.string().optional().default('20'),
      category: z.string().max(100).optional(),
      country:  z.string().length(2).optional(),
      trusted:  z.enum(['true','false']).optional(),
    })
  }),
  async (req, res, next) => {
    try {
      const { q, page, limit, category, country, trusted } = req.query as {
        q: string; page: string; limit: string;
        category?: string; country?: string; trusted?: string;
      };

      const pageN  = Math.max(1, parseInt(page));
      const limitN = Math.min(50, parseInt(limit));
      const tsQuery = toTsQuery(q);

      if (!tsQuery) return res.json({ results: [], total: 0 });

      const baseQuery = db('provider_listings as l')
        .join('provider_profiles as p', 'l.provider_id', 'p.id')
        .join('users as u', 'p.user_id', 'u.id')
        .where({ 'l.active': true })
        .whereNull('l.deleted_at')
        .whereNull('p.deleted_at')
        .whereRaw(
          `to_tsvector('english', COALESCE(l.title,'') || ' ' || COALESCE(l.description,'') || ' ' || COALESCE(l.category,'')) @@ to_tsquery('english', ?)`,
          [tsQuery]
        );

      if (category) baseQuery.where('l.category', 'ilike', `%${category}%`);
      if (trusted === 'true') baseQuery.where('p.trusted_badge', true);

      // PI insurance gate — only show providers with valid PI
      baseQuery.where(function () {
        this.whereNull('p.pi_certificate_expiry')
            .orWhere('p.pi_certificate_expiry', '>', new Date());
      });

      const [results, [{ count }]] = await Promise.all([
        baseQuery.clone()
          .select(
            'l.id', 'l.title', 'l.description', 'l.category', 'l.pricing', 'l.visibility_tier',
            'p.id as provider_id', 'p.firm_name', 'p.trusted_badge', 'p.verified',
            'u.name as provider_name', 'u.country',
            db.raw(`ts_rank(to_tsvector('english', COALESCE(l.title,'') || ' ' || COALESCE(l.description,'')), to_tsquery('english', ?)) as relevance`, [tsQuery])
          )
          .orderByRaw(
            `p.trusted_badge DESC, p.verified DESC, ts_rank(to_tsvector('english', COALESCE(l.title,'') || ' ' || COALESCE(l.description,'')), to_tsquery('english', ?)) DESC`,
            [tsQuery]
          )
          .limit(limitN).offset((pageN - 1) * limitN),
        baseQuery.clone().count('l.id as count'),
      ]);

      res.json({ results, total: parseInt(String(count)), page: pageN, limit: limitN, query: q });
    } catch (err) { next(err); }
  }
);

// ── GET /api/v1/search/founders ──────────────────────────────
// Used by: service providers looking for leads
app.get(
  '/api/v1/search/founders',
  rateLimiter({ max: 60 }),
  authenticate,
  validate({ query: SearchSchema }),
  async (req, res, next) => {
    try {
      const { q, page, limit, country, sector, sort } = req.query as z.infer<typeof SearchSchema>;
      const pageN  = Math.max(1, parseInt(page));
      const limitN = Math.min(50, parseInt(limit));
      const tsQuery = toTsQuery(q);

      if (!tsQuery) return res.json({ results: [], total: 0 });

      const baseQuery = db('ventures as v')
        .join('users as u', 'v.user_id', 'u.id')
        .leftJoin('scores as s', function () {
          this.on('s.venture_id', 'v.id').andOn(db.raw('s.is_current = true'));
        })
        .whereNull('v.deleted_at')
        .where({ 'u.status': 'active', 'u.role': 'founder' })
        .whereRaw(
          `to_tsvector('english', COALESCE(v.name,'') || ' ' || COALESCE(v.description,'') || ' ' || COALESCE(v.sector,'')) @@ to_tsquery('english', ?)`,
          [tsQuery]
        );

      if (country) baseQuery.where('v.country', country);
      if (sector)  baseQuery.where('v.sector', 'ilike', `%${sector}%`);

      const [results, [{ count }]] = await Promise.all([
        baseQuery.clone()
          .select(
            'v.id', 'v.name', 'v.sector', 'v.country', 'v.stage',
            's.total_score', 's.tier',
            db.raw(`ts_rank(to_tsvector('english', COALESCE(v.name,'') || ' ' || COALESCE(v.description,'')), to_tsquery('english', ?)) as relevance`, [tsQuery])
          )
          .orderByRaw(
            `ts_rank(to_tsvector('english', COALESCE(v.name,'') || ' ' || COALESCE(v.description,'')), to_tsquery('english', ?)) DESC`,
            [tsQuery]
          )
          .limit(limitN).offset((pageN - 1) * limitN),
        baseQuery.clone().count('v.id as count'),
      ]);

      res.json({ results, total: parseInt(String(count)), page: pageN, limit: limitN });
    } catch (err) { next(err); }
  }
);

// ── GET /api/v1/search/global ────────────────────────────────
// Admin only — searches across users, ventures, providers simultaneously
app.get(
  '/api/v1/search/global',
  rateLimiter({ max: 30 }),
  authenticate,
  async (req, res, next) => {
    try {
      if (req.user!.role !== 'super_admin') {
        return res.status(403).json({ error: 'Admin only' });
      }

      const q = String(req.query.q || '').trim();
      if (!q || q.length < 2) return res.json({ users: [], ventures: [], providers: [] });

      const tsQuery = toTsQuery(q);
      if (!tsQuery) return res.json({ users: [], ventures: [], providers: [] });

      const [users, ventures, providers] = await Promise.all([
        db('users')
          .whereNull('deleted_at')
          .where(function () {
            this.where('name', 'ilike', `%${q}%`)
                .orWhere('email', 'ilike', `%${q}%`);
          })
          .select('id', 'name', 'email', 'role', 'status', 'created_at')
          .limit(10),

        db('ventures as v')
          .leftJoin('scores as s', function () {
            this.on('s.venture_id', 'v.id').andOn(db.raw('s.is_current = true'));
          })
          .whereNull('v.deleted_at')
          .whereRaw(
            `to_tsvector('english', COALESCE(v.name,'') || ' ' || COALESCE(v.sector,'')) @@ to_tsquery('english', ?)`,
            [tsQuery]
          )
          .select('v.id', 'v.name', 'v.sector', 'v.country', 's.total_score', 's.tier')
          .limit(10),

        db('provider_listings as l')
          .join('provider_profiles as p', 'l.provider_id', 'p.id')
          .where({ 'l.active': true })
          .whereNull('l.deleted_at')
          .whereRaw(
            `to_tsvector('english', COALESCE(l.title,'') || ' ' || COALESCE(l.category,'')) @@ to_tsquery('english', ?)`,
            [tsQuery]
          )
          .select('l.id', 'l.title', 'l.category', 'p.firm_name', 'p.trusted_badge')
          .limit(10),
      ]);

      res.json({ users, ventures, providers, query: q });
    } catch (err) { next(err); }
  }
);

// ── GET /api/v1/search/suggestions ──────────────────────────
// Autocomplete — fast prefix search, no auth required
app.get(
  '/api/v1/search/suggestions',
  rateLimiter({ max: 120 }),
  async (req, res, next) => {
    try {
      const q = String(req.query.q || '').trim();
      const type = String(req.query.type || 'ventures');

      if (!q || q.length < 2) return res.json({ suggestions: [] });

      let suggestions: { label: string; id: string; type: string }[] = [];

      if (type === 'ventures' || type === 'all') {
        const ventures = await db('ventures')
          .whereNull('deleted_at')
          .where('name', 'ilike', `${q}%`)
          .select('id', 'name', 'sector')
          .limit(5);
        suggestions.push(...ventures.map(v => ({ label: `${v.name} (${v.sector || 'Venture'})`, id: v.id, type: 'venture' })));
      }

      if (type === 'providers' || type === 'all') {
        const providers = await db('provider_listings')
          .where({ active: true })
          .whereNull('deleted_at')
          .where('title', 'ilike', `${q}%`)
          .select('id', 'title', 'category')
          .limit(5);
        suggestions.push(...providers.map(p => ({ label: `${p.title} (${p.category})`, id: p.id, type: 'provider' })));
      }

      res.json({ suggestions: suggestions.slice(0, 8) });
    } catch (err) { next(err); }
  }
);

// ── Migration: add search indexes ───────────────────────────
// Run once via: POST /api/v1/search/admin/build-indexes
app.post(
  '/api/v1/search/admin/build-indexes',
  rateLimiter({ max: 2 }),
  authenticate,
  async (req, res, next) => {
    try {
      if (req.user!.role !== 'super_admin') return res.status(403).json({ error: 'Admin only' });

      const indexes = [
        // GIN indexes for full-text search — much faster than sequential scans
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ventures_fts
           ON ventures USING GIN(to_tsvector('english', COALESCE(name,'') || ' ' || COALESCE(description,'') || ' ' || COALESCE(sector,'') || ' ' || COALESCE(country,'')))`,

        `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_provider_listings_fts
           ON provider_listings USING GIN(to_tsvector('english', COALESCE(title,'') || ' ' || COALESCE(description,'') || ' ' || COALESCE(category,'')))`,

        `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_name_search
           ON users USING GIN(to_tsvector('english', COALESCE(name,'') || ' ' || COALESCE(email,'')))`,

        // Regular indexes for filter columns
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ventures_country ON ventures(country) WHERE deleted_at IS NULL`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ventures_sector  ON ventures(sector)  WHERE deleted_at IS NULL`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ventures_stage   ON ventures(stage)   WHERE deleted_at IS NULL`,
      ];

      const results: string[] = [];
      for (const sql of indexes) {
        try {
          await db.raw(sql);
          results.push(`✅ ${sql.slice(0, 60)}...`);
        } catch (e: any) {
          results.push(`⚠️  ${e.message}`);
        }
      }

      res.json({ success: true, results });
    } catch (err) { next(err); }
  }
);

app.get('/health', (_, res) => res.json({
  service: 'search-service', status: 'ok', version: '1.0.0',
  engine: 'PostgreSQL tsvector', timestamp: new Date().toISOString(),
}));

app.use(errorHandler);

const PORT = parseInt(env.PORT) + 16; // 3017
async function start() {
  env.NODE_ENV;
  const { initRedis } = await import('@ikonetu/shared/middleware');
  await initRedis();
  app.listen(PORT, () => {
    console.log(`✅ search-service running on port ${PORT}`);
    console.log(`   Engine: PostgreSQL tsvector (no Elasticsearch dependency)`);
    console.log(`   Run POST /api/v1/search/admin/build-indexes once to create GIN indexes`);
  });
}
start().catch((err) => { console.error(err); process.exit(1); });

export default app;
