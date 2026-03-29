import { getCachedScore, setCachedScore, invalidateScoreCache } from './score-cache';
import express from 'express';
import { createClient } from 'redis';
import { z } from 'zod';
import { env } from '@ikonetu/config';
import { db } from '@ikonetu/database';
import {
  requestId, rateLimiter, authenticate, requireRole,
  validate, auditLog, errorHandler,
  AppError, NotFoundError, ConflictError,
} from '@ikonetu/shared/middleware';

const app = express();
app.use(express.json());
app.use(requestId);

let redis: ReturnType<typeof createClient>;

// ════════════════════════════════════════════════════════════
// SCORING ENGINE — Core types and constants
// ════════════════════════════════════════════════════════════

// INVARIANT: Score is ALWAYS 0–1000 — enforced at engine, API, and DB level
const SCORE_MIN = 0;
const SCORE_MAX = 1000;

// INVARIANT: Tiers are fixed — cannot be changed without a code deploy
const TIERS = {
  EARLY:      { min: 0,   max: 300,  label: 'Early Stage' },
  RISING:     { min: 301, max: 600,  label: 'Rising' },
  INVESTABLE: { min: 601, max: 850,  label: 'Investable' },
  ELITE:      { min: 851, max: 1000, label: 'Elite' },
} as const;

type Tier = keyof typeof TIERS;
type Category = 'identity' | 'financial' | 'media' | 'product' | 'team' | 'legal' | 'market' | 'operations';

// Verification tier multipliers — government data always outweighs self-declaration
const VERIFICATION_MULTIPLIERS: Record<number, number> = {
  1: 1.00,  // Government API — gold standard
  2: 0.95,  // Third-party API (Companies House, etc.)
  3: 0.85,  // Document + AI verification
  4: 0.60,  // Self-declared — lowest weight
};

// Category max points (sum = 1000)
const CATEGORY_MAX: Record<Category, number> = {
  identity:   150,
  financial:  200,
  media:      100,
  product:    150,
  team:       100,
  legal:      150,
  market:     100,
  operations:  50,
};

// ── Signal types ─────────────────────────────────────────────
interface Signal {
  name: string;
  value: string | number | boolean;
  source: string;
  verificationTier: 1 | 2 | 3 | 4;
  rawPoints: number;
  category: Category;
}

interface CategoryResult {
  category: Category;
  rawScore: number;
  weightedScore: number;
  maxPossible: number;
  signalsFound: number;
  signalsVerified: number;
  signals: Signal[];
}

interface ScoreResult {
  ventureId: string;
  totalScore: number;
  tier: Tier;
  confidencePct: number;
  categories: CategoryResult[];
  signals: Signal[];
}

// ════════════════════════════════════════════════════════════
// SIGNAL GATHERERS — one per category
// ════════════════════════════════════════════════════════════

async function gatherIdentitySignals(ventureId: string, venture: Record<string, unknown>): Promise<Signal[]> {
  const signals: Signal[] = [];

  // Registration number (Tier 2 — Companies House/CAC API verification)
  if (venture.registration_number) {
    signals.push({
      name: 'business_registration',
      value: String(venture.registration_number),
      source: 'venture_profile',
      verificationTier: venture.registration_verified ? 2 : 4,
      rawPoints: 50,
      category: 'identity',
    });
  }

  // TIN / Tax registration
  if (venture.tin) {
    signals.push({
      name: 'tax_identification',
      value: String(venture.tin),
      source: 'venture_profile',
      verificationTier: venture.tin_verified ? 2 : 4,
      rawPoints: 35,
      category: 'identity',
    });
  }

  // Date founded
  if (venture.date_founded) {
    const monthsOld = Math.floor((Date.now() - new Date(String(venture.date_founded)).getTime()) / (1000 * 60 * 60 * 24 * 30));
    signals.push({
      name: 'operating_tenure',
      value: monthsOld,
      source: 'venture_profile',
      verificationTier: 4,
      rawPoints: Math.min(30, monthsOld), // 1 point per month, max 30
      category: 'identity',
    });
  }

  // Verified documents — identity tier 1 (government IDs)
  const docs = await db('venture_documents')
    .where({ venture_id: ventureId, document_type: 'government_id', verified: true })
    .first();
  if (docs) {
    signals.push({
      name: 'government_id_verified',
      value: true,
      source: 'document_verification',
      verificationTier: docs.verification_tier || 3,
      rawPoints: 35,
      category: 'identity',
    });
  }

  return signals;
}

async function gatherFinancialSignals(ventureId: string): Promise<Signal[]> {
  const signals: Signal[] = [];
  const financialData = await db('venture_financial_data')
    .where({ venture_id: ventureId })
    .orderBy('created_at', 'desc')
    .limit(12);

  if (financialData.length === 0) return signals;

  // Revenue evidence
  const totalRevenue = financialData.reduce((sum, d) => sum + parseFloat(d.revenue || 0), 0);
  if (totalRevenue > 0) {
    // Scale: £0 = 0pts, £1M+ = 80pts
    const revenuePoints = Math.min(80, Math.floor(totalRevenue / 12500));
    const bestTier = Math.min(...financialData.filter(d => d.revenue).map(d => d.verification_tier || 4)) as 1 | 2 | 3 | 4;
    signals.push({
      name: 'revenue_evidence',
      value: totalRevenue,
      source: financialData[0]?.source || 'financial_data',
      verificationTier: bestTier,
      rawPoints: revenuePoints,
      category: 'financial',
    });
  }

  // Revenue consistency (multiple months of data)
  if (financialData.length >= 3) {
    signals.push({
      name: 'revenue_consistency',
      value: financialData.length,
      source: 'financial_history',
      verificationTier: 4,
      rawPoints: Math.min(40, financialData.length * 4),
      category: 'financial',
    });
  }

  // Bank account connected (open banking)
  const openBanking = await db('venture_financial_data')
    .where({ venture_id: ventureId })
    .whereIn('source', ['mono', 'okra', 'open_banking'])
    .first();
  if (openBanking) {
    signals.push({
      name: 'bank_account_connected',
      value: true,
      source: openBanking.source,
      verificationTier: 2,
      rawPoints: 50,
      category: 'financial',
    });
  }

  // Financial documents verified
  const finDocs = await db('venture_documents')
    .where({ venture_id: ventureId, verified: true })
    .whereIn('document_type', ['bank_statement', 'tax_return', 'audited_accounts'])
    .select('*');
  if (finDocs.length > 0) {
    const bestTier = Math.min(...finDocs.map(d => d.verification_tier || 4)) as 1 | 2 | 3 | 4;
    signals.push({
      name: 'financial_documents_verified',
      value: finDocs.length,
      source: 'document_verification',
      verificationTier: bestTier,
      rawPoints: Math.min(30, finDocs.length * 10),
      category: 'financial',
    });
  }

  return signals;
}

async function gatherMediaSignals(ventureId: string): Promise<Signal[]> {
  const signals: Signal[] = [];
  const social = await db('venture_social_profiles').where({ venture_id: ventureId });

  for (const profile of social) {
    const followers = parseInt(profile.followers) || 0;
    const engagement = parseFloat(profile.engagement_rate) || 0;

    if (followers > 0) {
      // Follower points: log scale, max 15 per platform
      const followerPoints = Math.min(15, Math.floor(Math.log10(Math.max(1, followers)) * 3));
      signals.push({
        name: `${profile.platform}_followers`,
        value: followers,
        source: `${profile.platform}_api`,
        verificationTier: 2,
        rawPoints: followerPoints,
        category: 'media',
      });
    }

    if (engagement > 0) {
      // Engagement rate — 3%+ is strong
      const engagementPoints = Math.min(10, Math.floor(engagement * 100 / 3));
      signals.push({
        name: `${profile.platform}_engagement`,
        value: engagement,
        source: `${profile.platform}_api`,
        verificationTier: 2,
        rawPoints: engagementPoints,
        category: 'media',
      });
    }
  }

  // Website presence
  const venture = await db('ventures').where({ id: ventureId }).first();
  const profile = await db('user_profiles')
    .join('users', 'user_profiles.user_id', 'users.id')
    .join('ventures', 'ventures.user_id', 'users.id')
    .where('ventures.id', ventureId)
    .select('user_profiles.website')
    .first();

  if (profile?.website) {
    signals.push({
      name: 'website_presence',
      value: profile.website,
      source: 'self_declared',
      verificationTier: 4,
      rawPoints: 15,
      category: 'media',
    });
  }

  // Pitch video
  const pitchVideo = await db('pitch_videos')
    .where({ venture_id: ventureId, status: 'ready' })
    .first();
  if (pitchVideo) {
    signals.push({
      name: 'pitch_video',
      value: true,
      source: 'platform_upload',
      verificationTier: 3,
      rawPoints: 20,
      category: 'media',
    });
  }

  return signals;
}

async function gatherProductSignals(ventureId: string, venture: Record<string, unknown>): Promise<Signal[]> {
  const signals: Signal[] = [];

  // Stage of business
  const stagePoints: Record<string, number> = { idea: 10, mvp: 40, revenue: 80, scaling: 120 };
  if (venture.stage) {
    signals.push({
      name: 'venture_stage',
      value: String(venture.stage),
      source: 'self_declared',
      verificationTier: 4,
      rawPoints: stagePoints[String(venture.stage)] || 0,
      category: 'product',
    });
  }

  // Customer/user evidence from documents
  const customerDocs = await db('venture_documents')
    .where({ venture_id: ventureId, verified: true })
    .whereIn('document_type', ['customer_contracts', 'mou', 'loi'])
    .count('id as count')
    .first();

  const count = parseInt(String(customerDocs?.count || 0));
  if (count > 0) {
    signals.push({
      name: 'customer_evidence',
      value: count,
      source: 'verified_documents',
      verificationTier: 3,
      rawPoints: Math.min(30, count * 10),
      category: 'product',
    });
  }

  return signals;
}

async function gatherTeamSignals(ventureId: string, venture: Record<string, unknown>): Promise<Signal[]> {
  const signals: Signal[] = [];

  // Employee count
  const empCount = parseInt(String(venture.employee_count || 0));
  if (empCount > 0) {
    signals.push({
      name: 'team_size',
      value: empCount,
      source: 'self_declared',
      verificationTier: 4,
      rawPoints: Math.min(40, empCount * 5),
      category: 'team',
    });
  }

  // Verified team credentials in documents
  const credDocs = await db('venture_documents')
    .where({ venture_id: ventureId, verified: true })
    .whereIn('document_type', ['cv', 'linkedin_profile', 'professional_certificate'])
    .count('id as count')
    .first();

  const credCount = parseInt(String(credDocs?.count || 0));
  if (credCount > 0) {
    signals.push({
      name: 'team_credentials_verified',
      value: credCount,
      source: 'verified_documents',
      verificationTier: 3,
      rawPoints: Math.min(60, credCount * 15),
      category: 'team',
    });
  }

  return signals;
}

async function gatherLegalSignals(ventureId: string, venture: Record<string, unknown>): Promise<Signal[]> {
  const signals: Signal[] = [];

  if (venture.registration_number) {
    signals.push({
      name: 'legal_registration',
      value: String(venture.registration_number),
      source: venture.registration_verified ? 'companies_house_api' : 'self_declared',
      verificationTier: venture.registration_verified ? 2 : 4,
      rawPoints: 60,
      category: 'legal',
    });
  }

  if (venture.tin) {
    signals.push({
      name: 'tax_registration',
      value: String(venture.tin),
      source: venture.tin_verified ? 'tax_authority_api' : 'self_declared',
      verificationTier: venture.tin_verified ? 1 : 4,
      rawPoints: 50,
      category: 'legal',
    });
  }

  const legalDocs = await db('venture_documents')
    .where({ venture_id: ventureId, verified: true })
    .whereIn('document_type', ['operating_licence', 'ip_registration', 'regulatory_certificate'])
    .count('id as count')
    .first();

  const legalCount = parseInt(String(legalDocs?.count || 0));
  if (legalCount > 0) {
    signals.push({
      name: 'legal_documents',
      value: legalCount,
      source: 'verified_documents',
      verificationTier: 3,
      rawPoints: Math.min(40, legalCount * 13),
      category: 'legal',
    });
  }

  return signals;
}

async function gatherMarketSignals(ventureId: string, venture: Record<string, unknown>): Promise<Signal[]> {
  const signals: Signal[] = [];

  if (venture.sector) {
    signals.push({
      name: 'sector_defined',
      value: String(venture.sector),
      source: 'self_declared',
      verificationTier: 4,
      rawPoints: 20,
      category: 'market',
    });
  }

  if (venture.country) {
    signals.push({
      name: 'market_geography',
      value: String(venture.country),
      source: 'self_declared',
      verificationTier: 4,
      rawPoints: 10,
      category: 'market',
    });
  }

  // Google Maps listing (verified by Scout)
  const mapsSignal = await db('score_signals')
    .join('scores', 'score_signals.score_id', 'scores.id')
    .where({ 'scores.venture_id': ventureId, 'score_signals.signal_name': 'google_maps_listing' })
    .first();
  if (mapsSignal) {
    signals.push({
      name: 'google_maps_listing',
      value: true,
      source: 'google_maps_api',
      verificationTier: 2,
      rawPoints: 70,
      category: 'market',
    });
  }

  return signals;
}

async function gatherOperationsSignals(ventureId: string): Promise<Signal[]> {
  const signals: Signal[] = [];

  const operationsDocs = await db('venture_documents')
    .where({ venture_id: ventureId, verified: true })
    .whereIn('document_type', ['org_chart', 'employee_contracts', 'accounting_software', 'hr_system'])
    .count('id as count')
    .first();

  const count = parseInt(String(operationsDocs?.count || 0));
  if (count > 0) {
    signals.push({
      name: 'operational_infrastructure',
      value: count,
      source: 'verified_documents',
      verificationTier: 3,
      rawPoints: Math.min(50, count * 12),
      category: 'operations',
    });
  }

  return signals;
}

// ════════════════════════════════════════════════════════════
// CORE SCORING ENGINE
// ════════════════════════════════════════════════════════════

function applyVerificationWeighting(signal: Signal): number {
  const multiplier = VERIFICATION_MULTIPLIERS[signal.verificationTier] ?? 0.60;
  return signal.rawPoints * multiplier;
}

function classifyTier(score: number): Tier {
  if (score >= TIERS.ELITE.min)      return 'ELITE';
  if (score >= TIERS.INVESTABLE.min) return 'INVESTABLE';
  if (score >= TIERS.RISING.min)     return 'RISING';
  return 'EARLY';
}

function calculateConfidence(allSignals: Signal[]): number {
  if (allSignals.length === 0) return 0;

  // Confidence is weighted by verification tier
  const totalWeight = allSignals.reduce((sum, s) => sum + s.rawPoints, 0);
  const verifiedWeight = allSignals.reduce((sum, s) => {
    const tierBonus = { 1: 1.0, 2: 0.9, 3: 0.7, 4: 0.3 }[s.verificationTier] ?? 0.3;
    return sum + s.rawPoints * tierBonus;
  }, 0);

  return totalWeight > 0 ? Math.round((verifiedWeight / totalWeight) * 100) : 0;
}

function categorizSignals(signals: Signal[]): CategoryResult[] {
  const results: CategoryResult[] = [];

  for (const [category, maxPossible] of Object.entries(CATEGORY_MAX) as [Category, number][]) {
    const categorySignals = signals.filter(s => s.category === category);
    const rawScore = categorySignals.reduce((sum, s) => sum + s.rawPoints, 0);
    const weightedScore = categorySignals.reduce((sum, s) => sum + applyVerificationWeighting(s), 0);

    // Cap at category max
    const cappedWeighted = Math.min(maxPossible, weightedScore);

    results.push({
      category,
      rawScore: Math.round(rawScore * 100) / 100,
      weightedScore: Math.round(cappedWeighted * 100) / 100,
      maxPossible,
      signalsFound: categorySignals.length,
      signalsVerified: categorySignals.filter(s => s.verificationTier <= 3).length,
      signals: categorySignals,
    });
  }

  return results;
}

async function calculateScore(ventureId: string): Promise<ScoreResult> {
  const venture = await db('ventures').where({ id: ventureId }).whereNull('deleted_at').first();
  if (!venture) throw new NotFoundError('Venture');

  // Gather all signals in parallel
  const [identity, financial, media, product, team, legal, market, operations] = await Promise.all([
    gatherIdentitySignals(ventureId, venture),
    gatherFinancialSignals(ventureId),
    gatherMediaSignals(ventureId),
    gatherProductSignals(ventureId, venture),
    gatherTeamSignals(ventureId, venture),
    gatherLegalSignals(ventureId, venture),
    gatherMarketSignals(ventureId, venture),
    gatherOperationsSignals(ventureId),
  ]);

  const allSignals = [...identity, ...financial, ...media, ...product, ...team, ...legal, ...market, ...operations];
  const categories = categorizSignals(allSignals);

  // Total = sum of weighted category scores (already capped per category)
  const totalRaw = categories.reduce((sum, c) => sum + c.weightedScore, 0);

  // INVARIANT: Clamp to 0–1000
  const totalScore = Math.max(SCORE_MIN, Math.min(SCORE_MAX, Math.round(totalRaw)));
  const tier = classifyTier(totalScore);
  const confidencePct = calculateConfidence(allSignals);

  // Validation — these must NEVER fail
  console.assert(totalScore >= 0 && totalScore <= 1000, `Score ${totalScore} out of range`);
  console.assert(confidencePct >= 0 && confidencePct <= 100, `Confidence ${confidencePct} out of range`);
  console.assert(['EARLY', 'RISING', 'INVESTABLE', 'ELITE'].includes(tier), `Invalid tier ${tier}`);

  return { ventureId, totalScore, tier, confidencePct, categories, signals: allSignals };
}

async function persistScore(result: ScoreResult): Promise<string> {
  return db.transaction(async (trx) => {
    // Mark previous score as not current
    await trx('scores')
      .where({ venture_id: result.ventureId, is_current: true })
      .update({ is_current: false });

    // Insert new score
    const [score] = await trx('scores').insert({
      venture_id: result.ventureId,
      total_score: result.totalScore,
      tier: result.tier,
      confidence_pct: result.confidencePct,
      scored_at: new Date(),
      is_current: true,
    }).returning('*');

    // Insert category breakdowns
    await trx('score_breakdowns').insert(
      result.categories.map((c) => ({
        score_id: score.id,
        category: c.category,
        raw_score: c.rawScore,
        weighted_score: c.weightedScore,
        max_possible: c.maxPossible,
        signals_found: c.signalsFound,
        signals_verified: c.signalsVerified,
      }))
    );

    // Insert signals
    if (result.signals.length > 0) {
      await trx('score_signals').insert(
        result.signals.map((s) => ({
          score_id: score.id,
          signal_name: s.name,
          signal_value: String(s.value),
          source: s.source,
          verification_tier: s.verificationTier,
          weight: VERIFICATION_MULTIPLIERS[s.verificationTier],
          points_awarded: applyVerificationWeighting(s),
        }))
      );
    }

    // Immutable monthly snapshot
    const today = new Date();
    const snapshotDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;

    const existingSnapshot = await trx('score_history')
      .where({ venture_id: result.ventureId, snapshot_date: snapshotDate })
      .first();

    if (!existingSnapshot) {
      await trx('score_history').insert({
        venture_id: result.ventureId,
        total_score: result.totalScore,
        tier: result.tier,
        confidence_pct: result.confidencePct,
        snapshot_date: snapshotDate,
        breakdown: JSON.stringify(result.categories.map(c => ({
          category: c.category,
          weightedScore: c.weightedScore,
          maxPossible: c.maxPossible,
        }))),
      });
    }

    // Audit
    await trx('audit_log').insert({
      action: 'score.calculated',
      resource_type: 'score',
      resource_id: score.id,
      new_value: JSON.stringify({
        ventureId: result.ventureId,
        totalScore: result.totalScore,
        tier: result.tier,
        confidencePct: result.confidencePct,
      }),
    });

    return score.id;
  });
}

// ════════════════════════════════════════════════════════════
// ROUTES
// ════════════════════════════════════════════════════════════

// POST /api/v1/scoring/calculate/:venture_id
app.post(
  '/api/v1/scoring/calculate/:venture_id',
  rateLimiter({ max: 10 }),
  authenticate,
  async (req, res, next) => {
    const ventureId = req.params.venture_id;

    // Verify ownership (founders can only trigger their own, admins can trigger any)
    if (req.user!.role === 'founder') {
      const venture = await db('ventures')
        .where({ id: ventureId, user_id: req.user!.id })
        .first();
      if (!venture) {
        return next(new AppError('Venture not found or access denied', 404, 'not-found'));
      }
    }

    try {
      // DISTRIBUTED LOCK — prevent concurrent calculation for same venture
      const lockKey = `score_lock:${ventureId}`;
      const lock = await redis.set(lockKey, '1', { NX: true, EX: 30 });

      if (!lock) {
        throw new ConflictError('Score calculation already in progress for this venture. Please wait and try again.');
      }

      try {
        const result = await calculateScore(ventureId);
        const scoreId = await persistScore(result);
        await invalidateScoreCache(ventureId); // bust cache after recalculation

        res.status(200).json({
          success: true,
          scoreId,
          ventureId: result.ventureId,
          totalScore: result.totalScore,
          tier: result.tier,
          tierLabel: TIERS[result.tier].label,
          confidencePct: result.confidencePct,
          categories: result.categories.map(c => ({
            category: c.category,
            score: c.weightedScore,
            maxPossible: c.maxPossible,
            pct: Math.round((c.weightedScore / c.maxPossible) * 100),
            signalsFound: c.signalsFound,
            signalsVerified: c.signalsVerified,
          })),
          signalCount: result.signals.length,
          calculatedAt: new Date().toISOString(),
        });
      } finally {
        await redis.del(lockKey);
      }
    } catch (err) { next(err); }
  },
);

// GET /api/v1/ventures/:id/score
app.get(
  '/api/v1/ventures/:id/score',
  rateLimiter(),
  authenticate,
  async (req, res, next) => {
    try {
      // Check Redis cache first — 5 min TTL
      const cached = await getCachedScore(req.params.id);
      if (cached) return res.json(cached);

      const score = await db('scores')
        .where({ venture_id: req.params.id, is_current: true })
        .first();

      if (!score) {
        return res.status(200).json({
          hasScore: false,
          message: 'No score calculated yet. Trigger a calculation to generate your score.',
        });
      }

      const breakdowns = await db('score_breakdowns').where({ score_id: score.id });
      const signals = await db('score_signals').where({ score_id: score.id });

      const responseData = {
        hasScore: true,
        score: {
          id: score.id,
          totalScore: score.total_score,
          tier: score.tier,
          tierLabel: TIERS[score.tier as Tier]?.label,
          tierRange: TIERS[score.tier as Tier],
          confidencePct: score.confidence_pct,
          scoredAt: score.scored_at,
          categories: breakdowns,
          signals: signals.map(s => ({
            name: s.signal_name,
            value: s.signal_value,
            source: s.source,
            verificationTier: s.verification_tier,
            pointsAwarded: s.points_awarded,
          })),
          nextTier: getNextTier(score.tier, score.total_score),
        },
      };
      await setCachedScore(req.params.id, responseData);
      res.json(responseData);
    } catch (err) { next(err); }
  },
);

function getNextTier(currentTier: string, score: number) {
  if (currentTier === 'ELITE') return null;
  const nextTierKey = currentTier === 'EARLY' ? 'RISING'
    : currentTier === 'RISING' ? 'INVESTABLE' : 'ELITE';
  const nextTier = TIERS[nextTierKey as Tier];
  return {
    tier: nextTierKey,
    label: nextTier.label,
    pointsNeeded: nextTier.min - score,
    targetScore: nextTier.min,
  };
}

// GET /api/v1/ventures/:id/score/history
app.get(
  '/api/v1/ventures/:id/score/history',
  rateLimiter(),
  authenticate,
  async (req, res, next) => {
    try {
      const history = await db('score_history')
        .where({ venture_id: req.params.id })
        .orderBy('snapshot_date', 'asc')
        .select('total_score', 'tier', 'confidence_pct', 'snapshot_date');

      res.json({ history });
    } catch (err) { next(err); }
  },
);

// GET /api/v1/ventures/:id/next-actions
app.get(
  '/api/v1/ventures/:id/next-actions',
  rateLimiter(),
  authenticate,
  async (req, res, next) => {
    try {
      const score = await db('scores').where({ venture_id: req.params.id, is_current: true }).first();
      const breakdowns = score ? await db('score_breakdowns').where({ score_id: score.id }) : [];

      // Generate personalised next-best-actions based on score gaps
      const actions = [];

      // Find categories with most room for improvement
      const gaps = breakdowns
        .map(b => ({
          category: b.category,
          current: b.weighted_score,
          max: b.max_possible,
          gap: b.max_possible - b.weighted_score,
          pct: Math.round((b.weighted_score / b.max_possible) * 100),
        }))
        .sort((a, b) => b.gap - a.gap);

      for (const gap of gaps.slice(0, 3)) {
        if (gap.category === 'financial' && gap.pct < 50) {
          actions.push({
            id: 'connect_bank',
            category: 'financial',
            title: 'Connect your bank account',
            description: 'Open banking connection unlocks 50 points and elevates your financial verification to Tier 2.',
            estimatedPoints: 50,
            difficulty: 'easy',
            action: 'connect_open_banking',
          });
        }
        if (gap.category === 'legal' && gap.pct < 40) {
          actions.push({
            id: 'upload_registration',
            category: 'legal',
            title: 'Upload your business registration certificate',
            description: 'Verified registration documents unlock up to 60 points in your legal category.',
            estimatedPoints: 60,
            difficulty: 'easy',
            action: 'upload_document',
            params: { document_type: 'business_registration' },
          });
        }
        if (gap.category === 'media' && gap.pct < 30) {
          actions.push({
            id: 'add_pitch_video',
            category: 'media',
            title: 'Add a pitch video',
            description: 'A 2–3 minute pitch video adds 20 points and significantly boosts investor engagement.',
            estimatedPoints: 20,
            difficulty: 'medium',
            action: 'upload_pitch_video',
          });
        }
        if (gap.category === 'identity' && gap.pct < 50) {
          actions.push({
            id: 'verify_government_id',
            category: 'identity',
            title: 'Verify your government ID',
            description: 'Government ID verification is a Tier 3 signal worth 35 points and builds investor trust.',
            estimatedPoints: 35,
            difficulty: 'easy',
            action: 'upload_document',
            params: { document_type: 'government_id' },
          });
        }
      }

      res.json({
        currentScore: score?.total_score ?? 0,
        currentTier: score?.tier ?? 'EARLY',
        nextActions: actions.slice(0, 5),
        totalPotentialPoints: actions.reduce((sum, a) => sum + a.estimatedPoints, 0),
      });
    } catch (err) { next(err); }
  },
);

// GET /api/v1/scoring/distribution (admin)
app.get(
  '/api/v1/scoring/distribution',
  rateLimiter(),
  authenticate,
  requireRole('super_admin'),
  async (req, res, next) => {
    try {
      const distribution = await db('scores')
        .where({ is_current: true })
        .select(db.raw(`
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE tier = 'EARLY') as early,
          COUNT(*) FILTER (WHERE tier = 'RISING') as rising,
          COUNT(*) FILTER (WHERE tier = 'INVESTABLE') as investable,
          COUNT(*) FILTER (WHERE tier = 'ELITE') as elite,
          AVG(total_score) as avg_score,
          AVG(confidence_pct) as avg_confidence,
          MIN(total_score) as min_score,
          MAX(total_score) as max_score
        `))
        .first();

      res.json({ distribution });
    } catch (err) { next(err); }
  },
);

// GET /api/v1/scoring/tiers
app.get('/api/v1/scoring/tiers', rateLimiter(), async (req, res) => {
  res.json({ tiers: Object.entries(TIERS).map(([key, val]) => ({ tier: key, ...val })) });
});

// GET /api/v1/scoring/categories
app.get('/api/v1/scoring/categories', rateLimiter(), async (req, res) => {
  res.json({
    categories: Object.entries(CATEGORY_MAX).map(([category, maxPoints]) => ({
      category,
      maxPoints,
      weight: Math.round((maxPoints / 1000) * 100),
    })),
    totalMaxPoints: SCORE_MAX,
  });
});

// POST /api/v1/scoring/batch-recalculate (admin — async)
app.post(
  '/api/v1/scoring/batch-recalculate',
  rateLimiter({ max: 2 }),
  authenticate,
  requireRole('super_admin'),
  async (req, res, next) => {
    try {
      const ventures = await db('ventures').whereNull('deleted_at').select('id');
      const total = ventures.length;

      // Queue all — process asynchronously
      let completed = 0;
      let failed = 0;

      // Fire and forget — admin gets a job ID to check progress
      const jobId = `batch_${Date.now()}`;
      await redis.set(`batch_job:${jobId}`, JSON.stringify({ total, completed: 0, failed: 0, status: 'running' }), { EX: 3600 });

      res.json({ jobId, total, message: `Batch recalculation started for ${total} ventures.` });

      // Process in background (fire-and-forget from API perspective)
      (async () => {
        for (const v of ventures) {
          const lockKey = `score_lock:${v.id}`;
          const lock = await redis.set(lockKey, '1', { NX: true, EX: 30 });
          if (!lock) { failed++; continue; }
          try {
            const result = await calculateScore(v.id);
            await persistScore(result);
            completed++;
          } catch {
            failed++;
          } finally {
            await redis.del(lockKey);
          }
          await redis.set(`batch_job:${jobId}`, JSON.stringify({ total, completed, failed, status: 'running' }));
        }
        await redis.set(`batch_job:${jobId}`, JSON.stringify({ total, completed, failed, status: 'done' }), { EX: 3600 });
      })();
    } catch (err) { next(err); }
  },
);

app.get('/health', (_, res) => res.json({
  service: 'scoring-service', status: 'ok', version: '1.0.0',
  invariants: { scoreRange: '0-1000', tiers: 'EARLY/RISING/INVESTABLE/ELITE', categories: 8 },
  timestamp: new Date().toISOString(),
}));

app.use(errorHandler);

const PORT = parseInt(env.PORT) + 2; // 3003

async function start() {
  env.NODE_ENV;
  redis = createClient({ url: env.REDIS_URL });
  await redis.connect();
  console.log(`✅ scoring-service running on port ${PORT}`);
  console.log(`   Score range: ${SCORE_MIN}–${SCORE_MAX}`);
  console.log(`   Categories: ${Object.keys(CATEGORY_MAX).join(', ')}`);
  app.listen(PORT);
}

start().catch((err) => { console.error(err); process.exit(1); });

export default app;
