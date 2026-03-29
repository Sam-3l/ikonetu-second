import express from 'express';
import { z } from 'zod';
import { env } from '@ikonetu/config';
import { db } from '@ikonetu/database';
import {
  requestId, rateLimiter, authenticate, requireRole,
  validate, errorHandler, AppError, NotFoundError,
} from '@ikonetu/shared/middleware';

const app = express();
app.use(express.json());
app.use(requestId);

// ════════════════════════════════════════════════════════════
// BANKABILITY SCORE
// 6 components, each 0–100, weighted average = final score
// INVARIANT: total_score is always 0–100
// ════════════════════════════════════════════════════════════

const COMPONENTS = {
  revenue_consistency: {
    label: 'Revenue consistency',
    weight: 0.25,
    description: 'Consistent monthly revenue over 6+ months',
  },
  registration_status: {
    label: 'Business registration',
    weight: 0.20,
    description: 'Legally registered business with government verification',
  },
  tax_compliance: {
    label: 'Tax compliance',
    weight: 0.20,
    description: 'Active TIN and up-to-date tax filings',
  },
  team_payroll: {
    label: 'Team & payroll',
    weight: 0.15,
    description: 'Evidence of regular staff payroll',
  },
  assets_insurance: {
    label: 'Assets & insurance',
    weight: 0.10,
    description: 'Business assets and insurance coverage',
  },
  credit_bureau: {
    label: 'Credit bureau',
    weight: 0.10,
    description: 'Credit bureau data or equivalent financial history',
  },
} as const;

type Component = keyof typeof COMPONENTS;

interface ComponentScore {
  component: Component;
  score: number;       // 0–100
  weighted: number;
  signals: string[];
  verificationTier: number;
}

interface BankabilityResult {
  ventureId: string;
  totalScore: number;  // 0–100 — HARD CONSTRAINT
  components: ComponentScore[];
  lenderRecommendation: string;
  strengthAreas: string[];
  improvementAreas: string[];
}

// ── Component calculators ────────────────────────────────────

async function scoreRevenueConsistency(ventureId: string): Promise<ComponentScore> {
  const financialData = await db('venture_financial_data')
    .where({ venture_id: ventureId })
    .whereNotNull('revenue')
    .orderBy('created_at', 'desc')
    .limit(12);

  const signals: string[] = [];
  let score = 0;

  if (financialData.length >= 6) {
    score += 40;
    signals.push(`${financialData.length} months of revenue data`);
  } else if (financialData.length >= 3) {
    score += 20;
    signals.push(`${financialData.length} months of revenue data (6 required for full score)`);
  }

  const openBanking = financialData.find(d => ['mono', 'okra', 'open_banking'].includes(d.source));
  if (openBanking) {
    score += 30;
    signals.push('Open banking verified revenue data');
  }

  // Revenue trend — growing is positive
  if (financialData.length >= 3) {
    const recent = financialData.slice(0, 3).reduce((s, d) => s + parseFloat(d.revenue || '0'), 0) / 3;
    const older = financialData.slice(-3).reduce((s, d) => s + parseFloat(d.revenue || '0'), 0) / 3;
    if (recent > older * 1.1) {
      score += 30;
      signals.push('Growing revenue trend');
    } else if (recent >= older) {
      score += 15;
      signals.push('Stable revenue trend');
    }
  }

  return {
    component: 'revenue_consistency',
    score: Math.min(100, score),
    weighted: Math.min(100, score) * COMPONENTS.revenue_consistency.weight,
    signals,
    verificationTier: openBanking ? 2 : 4,
  };
}

async function scoreRegistrationStatus(ventureId: string, venture: Record<string, unknown>): Promise<ComponentScore> {
  const signals: string[] = [];
  let score = 0;

  if (venture.registration_number) {
    score += 50;
    signals.push('Business registration number on file');
    if (venture.registration_verified) {
      score += 30;
      signals.push('Registration verified via Companies House / CAC API');
    }
  }

  const regDoc = await db('venture_documents')
    .where({ venture_id: ventureId, document_type: 'business_registration', verified: true })
    .first();

  if (regDoc) {
    score += 20;
    signals.push('Verified registration certificate uploaded');
  }

  return {
    component: 'registration_status',
    score: Math.min(100, score),
    weighted: Math.min(100, score) * COMPONENTS.registration_status.weight,
    signals,
    verificationTier: venture.registration_verified ? 2 : (regDoc ? 3 : 4),
  };
}

async function scoreTaxCompliance(ventureId: string, venture: Record<string, unknown>): Promise<ComponentScore> {
  const signals: string[] = [];
  let score = 0;

  if (venture.tin) {
    score += 40;
    signals.push('Tax Identification Number on file');
    if (venture.tin_verified) {
      score += 30;
      signals.push('TIN verified via tax authority API');
    }
  }

  const taxDocs = await db('venture_documents')
    .where({ venture_id: ventureId, verified: true })
    .whereIn('document_type', ['tax_return', 'tax_clearance'])
    .count('id as count')
    .first();

  const taxCount = parseInt(String(taxDocs?.count || 0));
  if (taxCount > 0) {
    score += Math.min(30, taxCount * 15);
    signals.push(`${taxCount} verified tax document${taxCount > 1 ? 's' : ''}`);
  }

  return {
    component: 'tax_compliance',
    score: Math.min(100, score),
    weighted: Math.min(100, score) * COMPONENTS.tax_compliance.weight,
    signals,
    verificationTier: venture.tin_verified ? 1 : (taxCount > 0 ? 3 : 4),
  };
}

async function scoreTeamPayroll(ventureId: string, venture: Record<string, unknown>): Promise<ComponentScore> {
  const signals: string[] = [];
  let score = 0;
  const empCount = parseInt(String(venture.employee_count || 0));

  if (empCount > 0) {
    score += Math.min(40, empCount * 8);
    signals.push(`${empCount} employee${empCount > 1 ? 's' : ''} declared`);
  }

  const payrollDocs = await db('venture_documents')
    .where({ venture_id: ventureId, verified: true })
    .whereIn('document_type', ['payroll_record', 'employee_contracts'])
    .count('id as count')
    .first();

  const payCount = parseInt(String(payrollDocs?.count || 0));
  if (payCount > 0) {
    score += 60;
    signals.push('Verified payroll documentation');
  }

  return {
    component: 'team_payroll',
    score: Math.min(100, score),
    weighted: Math.min(100, score) * COMPONENTS.team_payroll.weight,
    signals,
    verificationTier: payCount > 0 ? 3 : 4,
  };
}

async function scoreAssetsInsurance(ventureId: string): Promise<ComponentScore> {
  const signals: string[] = [];
  let score = 0;

  const assetDocs = await db('venture_documents')
    .where({ venture_id: ventureId, verified: true })
    .whereIn('document_type', ['insurance_certificate', 'asset_registry', 'property_deed'])
    .select('*');

  for (const doc of assetDocs) {
    if (doc.document_type === 'insurance_certificate') {
      score += 50;
      signals.push('Business insurance verified');
    } else {
      score += 25;
      signals.push('Asset documentation verified');
    }
  }

  return {
    component: 'assets_insurance',
    score: Math.min(100, score),
    weighted: Math.min(100, score) * COMPONENTS.assets_insurance.weight,
    signals,
    verificationTier: assetDocs.length > 0 ? 3 : 4,
  };
}

async function scoreCreditBureau(ventureId: string): Promise<ComponentScore> {
  const signals: string[] = [];
  let score = 0;

  // Credit bureau data — would come from Dun & Bradstreet, XDS, CreditRegistry Nigeria, etc.
  const creditDoc = await db('venture_documents')
    .where({ venture_id: ventureId, verified: true })
    .whereIn('document_type', ['credit_bureau_report', 'credit_reference'])
    .first();

  if (creditDoc) {
    score += 100;
    signals.push('Verified credit bureau report');
  } else {
    // Fallback: bank statement quality
    const bankStatements = await db('venture_documents')
      .where({ venture_id: ventureId, verified: true, document_type: 'bank_statement' })
      .count('id as count')
      .first();

    const stmtCount = parseInt(String(bankStatements?.count || 0));
    if (stmtCount >= 6) {
      score += 60;
      signals.push(`${stmtCount} months of verified bank statements`);
    } else if (stmtCount > 0) {
      score += 30;
      signals.push(`${stmtCount} verified bank statement${stmtCount > 1 ? 's' : ''} (6 needed for full score)`);
    }
  }

  return {
    component: 'credit_bureau',
    score: Math.min(100, score),
    weighted: Math.min(100, score) * COMPONENTS.credit_bureau.weight,
    signals,
    verificationTier: creditDoc ? 1 : 3,
  };
}

// ── Core bankability calculation ─────────────────────────────

async function calculateBankability(ventureId: string): Promise<BankabilityResult> {
  const venture = await db('ventures').where({ id: ventureId }).whereNull('deleted_at').first();
  if (!venture) throw new NotFoundError('Venture');

  const [revenue, registration, tax, payroll, assets, credit] = await Promise.all([
    scoreRevenueConsistency(ventureId),
    scoreRegistrationStatus(ventureId, venture),
    scoreTaxCompliance(ventureId, venture),
    scoreTeamPayroll(ventureId, venture),
    scoreAssetsInsurance(ventureId),
    scoreCreditBureau(ventureId),
  ]);

  const components = [revenue, registration, tax, payroll, assets, credit];
  const totalWeighted = components.reduce((sum, c) => sum + c.weighted, 0);

  // INVARIANT: always 0–100
  const totalScore = Math.max(0, Math.min(100, Math.round(totalWeighted)));

  const strengthAreas = components
    .filter(c => c.score >= 60)
    .map(c => COMPONENTS[c.component].label);

  const improvementAreas = components
    .filter(c => c.score < 40)
    .sort((a, b) => (COMPONENTS[b.component].weight - COMPONENTS[a.component].weight))
    .map(c => COMPONENTS[c.component].label);

  const lenderRecommendation =
    totalScore >= 80 ? 'Strong bankability profile. Recommended for standard due diligence.'
    : totalScore >= 60 ? 'Moderate bankability. Proceed with standard due diligence and document review.'
    : totalScore >= 40 ? 'Emerging bankability. Enhanced due diligence recommended.'
    : 'Early-stage bankability. Significant documentation gaps present.';

  return { ventureId, totalScore, components, lenderRecommendation, strengthAreas, improvementAreas };
}

// ════════════════════════════════════════════════════════════
// ROUTES
// ════════════════════════════════════════════════════════════

// POST /api/v1/bankability/calculate/:venture_id
app.post(
  '/api/v1/bankability/calculate/:venture_id',
  rateLimiter({ max: 10 }),
  authenticate,
  async (req, res, next) => {
    try {
      const result = await calculateBankability(req.params.venture_id);

      // Persist
      await db('bankability_scores')
        .insert({
          venture_id: req.params.venture_id,
          total_score: result.totalScore,
          revenue_consistency: result.components.find(c => c.component === 'revenue_consistency')?.score ?? 0,
          registration_status: result.components.find(c => c.component === 'registration_status')?.score ?? 0,
          tax_compliance: result.components.find(c => c.component === 'tax_compliance')?.score ?? 0,
          team_payroll: result.components.find(c => c.component === 'team_payroll')?.score ?? 0,
          assets_insurance: result.components.find(c => c.component === 'assets_insurance')?.score ?? 0,
          credit_bureau: result.components.find(c => c.component === 'credit_bureau')?.score ?? 0,
          scored_at: new Date(),
        })
        // Always INSERT — never overwrite. Full history preserved.
        // GET /bankability/:id uses ORDER BY scored_at DESC LIMIT 1.

      await db('audit_log').insert({
        action: 'bankability.calculated',
        resource_type: 'bankability_score',
        resource_id: req.params.venture_id,
        new_value: JSON.stringify({ totalScore: result.totalScore }),
        ip: req.ip,
        request_id: req.requestId,
      });

      res.json({
        ventureId: result.ventureId,
        totalScore: result.totalScore,
        grade: result.totalScore >= 80 ? 'A' : result.totalScore >= 60 ? 'B' : result.totalScore >= 40 ? 'C' : 'D',
        components: result.components.map(c => ({
          component: c.component,
          label: COMPONENTS[c.component].label,
          score: c.score,
          weight: COMPONENTS[c.component].weight,
          weightedContribution: Math.round(c.weighted * 100) / 100,
          signals: c.signals,
          verificationTier: c.verificationTier,
        })),
        lenderRecommendation: result.lenderRecommendation,
        strengthAreas: result.strengthAreas,
        improvementAreas: result.improvementAreas,
        calculatedAt: new Date().toISOString(),
      });
    } catch (err) { next(err); }
  },
);

// GET /api/v1/bankability/:venture_id
app.get(
  '/api/v1/bankability/:venture_id',
  rateLimiter(),
  authenticate,
  async (req, res, next) => {
    try {
      // Lenders must have consent to view bankability
      if (req.user!.role === 'lender') {
        const venture = await db('ventures').where({ id: req.params.venture_id }).first();
        if (!venture) throw new NotFoundError('Venture');

        const consent = await db('user_consents')
          .where({ user_id: venture.user_id, consent_type: 'score_share_lenders', granted: true })
          .first();

        if (!consent) {
          return res.status(403).json({
            type: 'https://ikonetu.com/errors/no-consent',
            title: 'This founder has not consented to share bankability data with lenders.',
            status: 403,
          });
        }

        // Log data access
        await db('data_access_log').insert({
          accessor_id: req.user!.id,
          accessed_user_id: venture.user_id,
          data_type: 'bankability_score',
          purpose: 'lender_assessment',
        });
      }

      const score = await db('bankability_scores')
        .where({ venture_id: req.params.venture_id })
        .orderBy('scored_at', 'desc')
        .first();

      if (!score) {
        return res.json({ hasScore: false, message: 'No bankability score calculated yet.' });
      }

      res.json({
        hasScore: true,
        totalScore: score.total_score,
        grade: score.total_score >= 80 ? 'A' : score.total_score >= 60 ? 'B' : score.total_score >= 40 ? 'C' : 'D',
        components: {
          revenue_consistency: score.revenue_consistency,
          registration_status: score.registration_status,
          tax_compliance: score.tax_compliance,
          team_payroll: score.team_payroll,
          assets_insurance: score.assets_insurance,
          credit_bureau: score.credit_bureau,
        },
        scoredAt: score.scored_at,
      });
    } catch (err) { next(err); }
  },
);

// GET /api/v1/bankability/:venture_id/history
app.get(
  '/api/v1/bankability/:venture_id/history',
  rateLimiter(),
  authenticate,
  async (req, res, next) => {
    try {
      const history = await db('bankability_scores')
        .where({ venture_id: req.params.venture_id })
        .orderBy('scored_at', 'asc')
        .select('total_score', 'scored_at');
      res.json({ history });
    } catch (err) { next(err); }
  },
);

// GET /api/v1/bankability/distribution (admin)
app.get(
  '/api/v1/bankability/distribution',
  rateLimiter(),
  authenticate,
  requireRole('super_admin', 'lender'),
  async (req, res, next) => {
    try {
      const dist = await db('bankability_scores')
        .select(db.raw(`
          COUNT(*) as total,
          AVG(total_score) as avg_score,
          COUNT(*) FILTER (WHERE total_score >= 80) as grade_a,
          COUNT(*) FILTER (WHERE total_score >= 60 AND total_score < 80) as grade_b,
          COUNT(*) FILTER (WHERE total_score >= 40 AND total_score < 60) as grade_c,
          COUNT(*) FILTER (WHERE total_score < 40) as grade_d
        `))
        .first();
      res.json({ distribution: dist });
    } catch (err) { next(err); }
  },
);

app.get('/health', (_, res) => res.json({
  service: 'bankability-service', status: 'ok', version: '1.0.0',
  components: Object.keys(COMPONENTS), invariant: 'totalScore always 0-100',
  timestamp: new Date().toISOString(),
}));

app.use(errorHandler);

const PORT = parseInt(env.PORT) + 4; // 3005
async function start() {
  env.NODE_ENV;
  const { initRedis } = await import('@ikonetu/shared/middleware');
  await initRedis();
  app.listen(PORT, () => console.log(`✅ bankability-service running on port ${PORT}`));
}
start().catch((err) => { console.error(err); process.exit(1); });

export default app;
