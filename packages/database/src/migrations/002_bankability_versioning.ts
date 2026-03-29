// ── PATCH: Replace the persist block in bankability-service ──
// Find the onConflict().merge() call and replace with insert-only (versioned)
//
// ORIGINAL (in bankability-service/src/index.ts, POST /calculate route):
//
//   await db('bankability_scores')
//     .insert({ ... })
//     .onConflict('venture_id')
//     .merge([...]);
//
// REPLACEMENT (below) — inserts a new row every time, keeps full history:

import { db } from '@ikonetu/database';

export async function persistBankabilityScore(
  ventureId: string,
  result: {
    totalScore: number;
    revenue_consistency: number;
    registration_status: number;
    tax_compliance: number;
    team_payroll: number;
    assets_insurance: number;
    credit_bureau: number;
  }
): Promise<void> {
  // Always insert a new row — never overwrite
  // The GET endpoint queries ORDER BY scored_at DESC LIMIT 1 to get the current score
  await db('bankability_scores').insert({
    venture_id: ventureId,
    total_score:           result.totalScore,
    revenue_consistency:   result.revenue_consistency,
    registration_status:   result.registration_status,
    tax_compliance:        result.tax_compliance,
    team_payroll:          result.team_payroll,
    assets_insurance:      result.assets_insurance,
    credit_bureau:         result.credit_bureau,
    scored_at: new Date(),
  });
}

// To apply this patch, in bankability-service/src/index.ts replace:
//
//   await db('bankability_scores').insert({...}).onConflict('venture_id').merge([...])
//
// with:
//
//   await persistBankabilityScore(req.params.venture_id, {
//     totalScore: result.totalScore,
//     revenue_consistency: result.components.find(c => c.component === 'revenue_consistency')?.score ?? 0,
//     registration_status: result.components.find(c => c.component === 'registration_status')?.score ?? 0,
//     tax_compliance:      result.components.find(c => c.component === 'tax_compliance')?.score ?? 0,
//     team_payroll:        result.components.find(c => c.component === 'team_payroll')?.score ?? 0,
//     assets_insurance:    result.components.find(c => c.component === 'assets_insurance')?.score ?? 0,
//     credit_bureau:       result.components.find(c => c.component === 'credit_bureau')?.score ?? 0,
//   });
//
// Also remove the unique constraint on venture_id in bankability_scores table
// (replace with a regular index). Add this migration:

export const bankabilityVersioningMigration = `
-- Migration: 002_bankability_versioning
-- Remove unique constraint on venture_id to allow full history

ALTER TABLE bankability_scores DROP CONSTRAINT IF EXISTS bankability_scores_venture_id_unique;
CREATE INDEX IF NOT EXISTS idx_bankability_venture_id_date ON bankability_scores(venture_id, scored_at DESC);
`;
