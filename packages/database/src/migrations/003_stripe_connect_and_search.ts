import type { Knex } from 'knex';

// ────────────────────────────────────────────────────────────
// MIGRATION: 003_stripe_connect_and_search
//
// 1. Adds stripe_connect_account_id to provider_profiles
// 2. Adds paystack_email_token to subscriptions
// 3. Removes unique constraint on bankability_scores.venture_id
//    (allows full history — see fix from session 5)
// 4. Creates GIN full-text search indexes on key tables
// ────────────────────────────────────────────────────────────

export async function up(knex: Knex): Promise<void> {

  // ── 1. Stripe Connect column on provider_profiles ─────────
  const hasConnectCol = await knex.schema.hasColumn('provider_profiles', 'stripe_connect_account_id');
  if (!hasConnectCol) {
    await knex.schema.alterTable('provider_profiles', (t) => {
      t.string('stripe_connect_account_id', 200).nullable();
      t.boolean('stripe_connect_onboarded').defaultTo(false);
    });
  }

  // ── 2. Paystack email token on subscriptions ───────────────
  const hasPaystackToken = await knex.schema.hasColumn('subscriptions', 'paystack_email_token');
  if (!hasPaystackToken) {
    await knex.schema.alterTable('subscriptions', (t) => {
      t.string('paystack_email_token', 200).nullable();
    });
  }

  // ── 3. Remove unique constraint on bankability_scores ─────
  // Allow full history (insert-only, not upsert)
  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'bankability_scores_venture_id_unique'
      ) THEN
        ALTER TABLE bankability_scores DROP CONSTRAINT bankability_scores_venture_id_unique;
      END IF;
    END$$;
  `);

  // Add index for fast current score lookup (latest per venture)
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bankability_venture_date
    ON bankability_scores(venture_id, scored_at DESC)
  `);

  // ── 4. Full-text search GIN indexes ───────────────────────
  // These are CONCURRENTLY so they don't lock the table during creation.
  // They'll be available immediately after migration.

  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ventures_fts
    ON ventures
    USING GIN(
      to_tsvector('english',
        COALESCE(name,'') || ' ' ||
        COALESCE(description,'') || ' ' ||
        COALESCE(sector,'') || ' ' ||
        COALESCE(country,'') || ' ' ||
        COALESCE(city,'')
      )
    )
    WHERE deleted_at IS NULL
  `);

  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_provider_listings_fts
    ON provider_listings
    USING GIN(
      to_tsvector('english',
        COALESCE(title,'') || ' ' ||
        COALESCE(description,'') || ' ' ||
        COALESCE(category,'')
      )
    )
    WHERE deleted_at IS NULL AND active = true
  `);

  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_fts
    ON users
    USING GIN(
      to_tsvector('english',
        COALESCE(name,'') || ' ' ||
        COALESCE(email,'')
      )
    )
    WHERE deleted_at IS NULL
  `);

  // ── 5. Add missing indexes for common filter columns ───────
  await knex.raw(`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ventures_country_stage ON ventures(country, stage) WHERE deleted_at IS NULL`);
  await knex.raw(`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scores_tier_current    ON scores(tier, is_current) WHERE is_current = true`);
  await knex.raw(`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_consents_type_granted  ON user_consents(consent_type, granted)`);
}

export async function down(knex: Knex): Promise<void> {
  // Drop the added columns
  const hasConnectCol = await knex.schema.hasColumn('provider_profiles', 'stripe_connect_account_id');
  if (hasConnectCol) {
    await knex.schema.alterTable('provider_profiles', (t) => {
      t.dropColumn('stripe_connect_account_id');
      t.dropColumn('stripe_connect_onboarded');
    });
  }

  const hasToken = await knex.schema.hasColumn('subscriptions', 'paystack_email_token');
  if (hasToken) {
    await knex.schema.alterTable('subscriptions', (t) => t.dropColumn('paystack_email_token'));
  }

  // Drop indexes
  const indexes = [
    'idx_ventures_fts', 'idx_provider_listings_fts', 'idx_users_fts',
    'idx_bankability_venture_date', 'idx_ventures_country_stage',
    'idx_scores_tier_current', 'idx_consents_type_granted',
  ];
  for (const idx of indexes) {
    await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS ${idx}`);
  }
}
