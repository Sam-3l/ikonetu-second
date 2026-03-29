import type { Knex } from 'knex';

// ─────────────────────────────────────────────────────────────
// MIGRATION: 001_foundation
// All core tables for IkonetU Phase 1
// Every table has: id (UUID), created_at, updated_at, deleted_at
// Append-only tables (audit_log, score_history) have no updated_at or deleted_at
// ─────────────────────────────────────────────────────────────

export async function up(knex: Knex): Promise<void> {

  // ── USERS ──────────────────────────────────────────────────
  await knex.schema.createTable('users', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('email', 320).unique().nullable();
    t.boolean('email_verified').defaultTo(false);
    t.string('phone', 30).unique().nullable();
    t.boolean('phone_verified').defaultTo(false);
    t.string('name', 200).notNullable();
    t.enum('role', ['founder', 'investor', 'provider', 'lender', 'university', 'super_admin']).notNullable();
    t.string('country', 2).nullable();
    t.string('language', 10).defaultTo('en');
    t.string('avatar_url', 500).nullable();
    t.enum('status', ['pending', 'active', 'suspended', 'banned']).defaultTo('pending');
    t.timestamp('last_login').nullable();
    t.boolean('onboarding_completed').defaultTo(false);
    t.boolean('blacklisted').defaultTo(false);
    t.string('blacklist_reason', 500).nullable();
    t.timestamps(true, true);
    t.timestamp('deleted_at').nullable();
    t.index(['email'], 'idx_users_email');
    t.index(['phone'], 'idx_users_phone');
    t.index(['role'], 'idx_users_role');
    t.index(['status'], 'idx_users_status');
    t.index(['deleted_at'], 'idx_users_deleted_at');
  });

  await knex.schema.createTable('user_profiles', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.text('bio').nullable();
    t.string('website', 500).nullable();
    t.jsonb('social_links').defaultTo('{}');
    t.string('location', 200).nullable();
    t.string('timezone', 100).nullable();
    t.timestamps(true, true);
    t.timestamp('deleted_at').nullable();
    t.unique(['user_id']);
  });

  await knex.schema.createTable('user_preferences', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.jsonb('notification_prefs').defaultTo('{"email":true,"push":true,"whatsapp":false,"in_app":true}');
    t.string('language', 10).defaultTo('en');
    t.string('currency', 3).defaultTo('GBP');
    t.timestamps(true, true);
    t.unique(['user_id']);
  });

  await knex.schema.createTable('user_sessions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('token_hash', 256).notNullable();
    t.string('refresh_token_hash', 256).notNullable();
    t.jsonb('device_info').defaultTo('{}');
    t.string('ip', 45).nullable();
    t.string('user_agent', 500).nullable();
    t.timestamp('expires_at').notNullable();
    t.boolean('revoked').defaultTo(false);
    t.timestamp('revoked_at').nullable();
    t.timestamps(true, true);
    t.index(['user_id'], 'idx_sessions_user_id');
    t.index(['token_hash'], 'idx_sessions_token_hash');
    t.index(['expires_at'], 'idx_sessions_expires_at');
  });

  await knex.schema.createTable('user_consents', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('consent_type', 100).notNullable();
    t.boolean('granted').notNullable();
    t.timestamp('granted_at').nullable();
    t.timestamp('revoked_at').nullable();
    t.string('ip', 45).nullable();
    t.string('version', 20).notNullable();
    t.jsonb('metadata').defaultTo('{}');
    t.timestamps(true, true);
    t.index(['user_id'], 'idx_consents_user_id');
    t.index(['consent_type'], 'idx_consents_type');
  });

  // OTP table — separate from sessions, short-lived
  await knex.schema.createTable('otp_records', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('identifier', 320).notNullable(); // email or phone
    t.enum('channel', ['email', 'sms', 'whatsapp']).notNullable();
    t.string('code_hash', 256).notNullable();
    t.integer('attempts').defaultTo(0);
    t.boolean('verified').defaultTo(false);
    t.timestamp('expires_at').notNullable();
    t.string('ip', 45).nullable();
    t.timestamps(true, true);
    t.index(['identifier'], 'idx_otp_identifier');
    t.index(['expires_at'], 'idx_otp_expires_at');
  });

  // ── VENTURES ───────────────────────────────────────────────
  await knex.schema.createTable('ventures', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('name', 200).notNullable();
    t.text('description').nullable();
    t.string('sector', 100).nullable();
    t.enum('business_type', ['tech_native', 'digitally_enabled', 'physical_first', 'hybrid']).nullable();
    t.string('country', 2).nullable();
    t.string('city', 100).nullable();
    t.string('registration_number', 100).nullable();
    t.string('tin', 100).nullable();
    t.date('date_founded').nullable();
    t.integer('employee_count').nullable();
    t.string('annual_revenue_range', 50).nullable();
    t.enum('stage', ['idea', 'mvp', 'revenue', 'scaling']).defaultTo('idea');
    t.timestamps(true, true);
    t.timestamp('deleted_at').nullable();
    t.index(['user_id'], 'idx_ventures_user_id');
    t.index(['sector'], 'idx_ventures_sector');
    t.index(['country'], 'idx_ventures_country');
    t.index(['deleted_at'], 'idx_ventures_deleted_at');
  });

  await knex.schema.createTable('venture_documents', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('venture_id').notNullable().references('id').inTable('ventures').onDelete('CASCADE');
    t.string('document_type', 100).notNullable();
    t.string('file_url', 500).notNullable();
    t.boolean('verified').defaultTo(false);
    t.integer('verification_tier').nullable(); // 1-4
    t.timestamp('verified_at').nullable();
    t.string('verifier', 200).nullable();
    t.jsonb('ai_analysis').defaultTo('{}');
    t.decimal('ai_confidence', 5, 2).nullable(); // 0.00-100.00
    t.timestamps(true, true);
    t.timestamp('deleted_at').nullable();
    t.index(['venture_id'], 'idx_vent_docs_venture_id');
    t.index(['document_type'], 'idx_vent_docs_type');
    t.index(['verified'], 'idx_vent_docs_verified');
  });

  await knex.schema.createTable('venture_social_profiles', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('venture_id').notNullable().references('id').inTable('ventures').onDelete('CASCADE');
    t.string('platform', 50).notNullable();
    t.string('handle', 200).nullable();
    t.string('url', 500).nullable();
    t.integer('followers').defaultTo(0);
    t.decimal('engagement_rate', 6, 4).defaultTo(0);
    t.timestamp('last_scraped').nullable();
    t.jsonb('raw_data').defaultTo('{}');
    t.timestamps(true, true);
    t.unique(['venture_id', 'platform']);
  });

  await knex.schema.createTable('venture_financial_data', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('venture_id').notNullable().references('id').inTable('ventures').onDelete('CASCADE');
    t.string('source', 100).notNullable(); // mono, okra, bank_statement, self_declared
    t.string('period', 20).nullable(); // e.g. 2024-Q3
    t.decimal('revenue', 20, 2).nullable();
    t.decimal('expenses', 20, 2).nullable();
    t.decimal('profit', 20, 2).nullable();
    t.string('currency', 3).defaultTo('GBP');
    t.boolean('verified').defaultTo(false);
    t.integer('verification_tier').nullable();
    t.timestamps(true, true);
    t.index(['venture_id'], 'idx_vent_fin_venture_id');
  });

  await knex.schema.createTable('pitch_videos', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('venture_id').notNullable().references('id').inTable('ventures').onDelete('CASCADE');
    t.string('file_url', 500).notNullable();
    t.integer('duration_seconds').nullable();
    t.string('thumbnail_url', 500).nullable();
    t.text('transcript').nullable();
    t.enum('status', ['processing', 'ready', 'failed']).defaultTo('processing');
    t.decimal('score_impact', 5, 2).defaultTo(0);
    t.timestamps(true, true);
    t.unique(['venture_id']);
  });

  // ── SCORING ────────────────────────────────────────────────
  await knex.schema.createTable('scores', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('venture_id').notNullable().references('id').inTable('ventures').onDelete('CASCADE');
    t.integer('total_score').notNullable(); // 0-1000 — HARD CONSTRAINT
    t.enum('tier', ['EARLY', 'RISING', 'INVESTABLE', 'ELITE']).notNullable();
    t.decimal('confidence_pct', 5, 2).notNullable(); // 0-100
    t.timestamp('scored_at').notNullable().defaultTo(knex.fn.now());
    t.integer('version').defaultTo(1);
    t.boolean('is_current').defaultTo(true);
    t.timestamps(true, true);
    t.index(['venture_id'], 'idx_scores_venture_id');
    t.index(['tier'], 'idx_scores_tier');
    t.index(['is_current'], 'idx_scores_is_current');
    // DB-level constraint: score must be 0-1000
    t.check('total_score >= 0 AND total_score <= 1000', [], 'chk_score_range');
    t.check('confidence_pct >= 0 AND confidence_pct <= 100', [], 'chk_confidence_range');
  });

  await knex.schema.createTable('score_breakdowns', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('score_id').notNullable().references('id').inTable('scores').onDelete('CASCADE');
    t.enum('category', ['identity', 'financial', 'media', 'product', 'team', 'legal', 'market', 'operations']).notNullable();
    t.decimal('raw_score', 7, 2).notNullable();
    t.decimal('weighted_score', 7, 2).notNullable();
    t.decimal('max_possible', 7, 2).notNullable();
    t.integer('signals_found').defaultTo(0);
    t.integer('signals_verified').defaultTo(0);
    t.timestamps(true, true);
    t.unique(['score_id', 'category']);
  });

  // APPEND-ONLY — no updates, no deletes ever
  await knex.schema.createTable('score_history', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('venture_id').notNullable().references('id').inTable('ventures');
    t.integer('total_score').notNullable();
    t.enum('tier', ['EARLY', 'RISING', 'INVESTABLE', 'ELITE']).notNullable();
    t.decimal('confidence_pct', 5, 2).notNullable();
    t.date('snapshot_date').notNullable();
    t.jsonb('breakdown').defaultTo('{}');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    // NO updated_at — NO deleted_at — IMMUTABLE
    t.index(['venture_id'], 'idx_score_hist_venture_id');
    t.index(['snapshot_date'], 'idx_score_hist_date');
    t.check('total_score >= 0 AND total_score <= 1000', [], 'chk_hist_score_range');
  });

  await knex.schema.createTable('score_signals', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('score_id').notNullable().references('id').inTable('scores').onDelete('CASCADE');
    t.string('signal_name', 200).notNullable();
    t.text('signal_value').nullable();
    t.string('source', 200).nullable();
    t.integer('verification_tier').notNullable(); // 1-4
    t.decimal('weight', 5, 4).notNullable();
    t.decimal('points_awarded', 7, 2).notNullable();
    t.timestamps(true, true);
    t.index(['score_id'], 'idx_signals_score_id');
  });

  await knex.schema.createTable('scoring_rules', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.enum('category', ['identity', 'financial', 'media', 'product', 'team', 'legal', 'market', 'operations']).notNullable();
    t.string('signal_type', 200).notNullable();
    t.jsonb('rule_logic').notNullable();
    t.decimal('weight', 5, 4).notNullable();
    t.decimal('max_points', 7, 2).notNullable();
    t.integer('verification_tier_required').defaultTo(4);
    t.boolean('active').defaultTo(true);
    t.integer('version').defaultTo(1);
    t.timestamps(true, true);
    t.index(['category'], 'idx_rules_category');
    t.index(['active'], 'idx_rules_active');
  });

  await knex.schema.createTable('tier_config', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('tier_name', 20).notNullable().unique();
    t.integer('min_score').notNullable();
    t.integer('max_score').notNullable();
    t.string('label', 50).notNullable();
    t.string('color', 20).notNullable();
    t.jsonb('benefits').defaultTo('[]');
    t.timestamps(true, true);
  });

  // ── BANKABILITY ────────────────────────────────────────────
  await knex.schema.createTable('bankability_scores', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('venture_id').notNullable().references('id').inTable('ventures').onDelete('CASCADE');
    t.decimal('total_score', 5, 2).notNullable(); // 0-100
    t.decimal('revenue_consistency', 5, 2).defaultTo(0);
    t.decimal('registration_status', 5, 2).defaultTo(0);
    t.decimal('tax_compliance', 5, 2).defaultTo(0);
    t.decimal('team_payroll', 5, 2).defaultTo(0);
    t.decimal('assets_insurance', 5, 2).defaultTo(0);
    t.decimal('credit_bureau', 5, 2).defaultTo(0);
    t.timestamp('scored_at').notNullable().defaultTo(knex.fn.now());
    t.timestamps(true, true);
    t.index(['venture_id'], 'idx_bank_venture_id');
    t.check('total_score >= 0 AND total_score <= 100', [], 'chk_bank_score_range');
  });

  // ── INVESTOR ───────────────────────────────────────────────
  await knex.schema.createTable('investor_profiles', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('firm_name', 200).nullable();
    t.decimal('fund_size', 20, 2).nullable();
    t.decimal('investment_range_min', 20, 2).nullable();
    t.decimal('investment_range_max', 20, 2).nullable();
    t.boolean('verified').defaultTo(false);
    t.string('currency', 3).defaultTo('GBP');
    t.timestamps(true, true);
    t.timestamp('deleted_at').nullable();
    t.unique(['user_id']);
  });

  await knex.schema.createTable('investor_theses', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('investor_id').notNullable().references('id').inTable('investor_profiles').onDelete('CASCADE');
    t.jsonb('sectors').defaultTo('[]');
    t.jsonb('geographies').defaultTo('[]');
    t.integer('score_range_min').defaultTo(0);
    t.integer('score_range_max').defaultTo(1000);
    t.jsonb('stage_preferences').defaultTo('[]');
    t.timestamps(true, true);
    t.unique(['investor_id']);
  });

  await knex.schema.createTable('investor_matches', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('investor_id').notNullable().references('id').inTable('investor_profiles').onDelete('CASCADE');
    t.uuid('venture_id').notNullable().references('id').inTable('ventures').onDelete('CASCADE');
    t.decimal('match_score', 5, 2).notNullable();
    t.jsonb('match_reasons').defaultTo('[]');
    t.enum('status', ['pending', 'viewed', 'interested', 'introduced', 'rejected']).defaultTo('pending');
    t.timestamp('introduced_at').nullable();
    t.timestamps(true, true);
    t.unique(['investor_id', 'venture_id']);
    t.index(['investor_id'], 'idx_matches_investor_id');
    t.index(['venture_id'], 'idx_matches_venture_id');
  });

  await knex.schema.createTable('deal_rooms', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('investor_id').notNullable().references('id').inTable('investor_profiles').onDelete('CASCADE');
    t.string('name', 200).notNullable();
    t.jsonb('filters').defaultTo('{}');
    t.timestamps(true, true);
    t.timestamp('deleted_at').nullable();
    t.index(['investor_id'], 'idx_deal_rooms_investor_id');
  });

  await knex.schema.createTable('deal_room_founders', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('deal_room_id').notNullable().references('id').inTable('deal_rooms').onDelete('CASCADE');
    t.uuid('venture_id').notNullable().references('id').inTable('ventures').onDelete('CASCADE');
    t.timestamp('added_at').notNullable().defaultTo(knex.fn.now());
    t.enum('status', ['active', 'removed', 'rejected', 'converted']).defaultTo('active');
    t.text('notes').nullable();
    t.timestamps(true, true);
    t.unique(['deal_room_id', 'venture_id']);
  });

  // ── SERVICE PROVIDER ───────────────────────────────────────
  await knex.schema.createTable('provider_profiles', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('firm_name', 200).nullable();
    t.jsonb('services').defaultTo('[]');
    t.jsonb('coverage_areas').defaultTo('[]');
    t.boolean('verified').defaultTo(false);
    t.boolean('trusted_badge').defaultTo(false);
    t.string('pi_certificate_url', 500).nullable();
    t.date('pi_certificate_expiry').nullable();
    t.timestamps(true, true);
    t.timestamp('deleted_at').nullable();
    t.unique(['user_id']);
  });

  await knex.schema.createTable('provider_listings', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('provider_id').notNullable().references('id').inTable('provider_profiles').onDelete('CASCADE');
    t.string('title', 200).notNullable();
    t.text('description').nullable();
    t.jsonb('pricing').defaultTo('{}');
    t.string('category', 100).notNullable();
    t.enum('visibility_tier', ['basic', 'featured', 'premium']).defaultTo('basic');
    t.boolean('active').defaultTo(true);
    t.timestamps(true, true);
    t.timestamp('deleted_at').nullable();
    t.index(['provider_id'], 'idx_listings_provider_id');
    t.index(['category'], 'idx_listings_category');
    t.index(['active'], 'idx_listings_active');
  });

  await knex.schema.createTable('provider_leads', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('provider_id').notNullable().references('id').inTable('provider_profiles').onDelete('CASCADE');
    t.uuid('venture_id').notNullable().references('id').inTable('ventures').onDelete('CASCADE');
    t.integer('score_gap').nullable();
    t.string('service_needed', 200).nullable();
    t.enum('status', ['new', 'viewed', 'accepted', 'rejected', 'converted']).defaultTo('new');
    t.timestamp('connected_at').nullable();
    t.timestamp('converted_at').nullable();
    t.timestamps(true, true);
    t.index(['provider_id'], 'idx_leads_provider_id');
    t.index(['venture_id'], 'idx_leads_venture_id');
  });

  // ── LENDER ─────────────────────────────────────────────────
  await knex.schema.createTable('lender_profiles', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('institution_name', 200).notNullable();
    t.string('licence_type', 100).nullable();
    t.boolean('verified').defaultTo(false);
    t.timestamps(true, true);
    t.timestamp('deleted_at').nullable();
    t.unique(['user_id']);
  });

  await knex.schema.createTable('lender_criteria', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('lender_id').notNullable().references('id').inTable('lender_profiles').onDelete('CASCADE');
    t.integer('min_score').defaultTo(0);
    t.decimal('min_bankability', 5, 2).defaultTo(0);
    t.integer('required_history_months').defaultTo(6);
    t.jsonb('sectors').defaultTo('[]');
    t.jsonb('geographies').defaultTo('[]');
    t.timestamps(true, true);
    t.unique(['lender_id']);
  });

  await knex.schema.createTable('lender_portfolios', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('lender_id').notNullable().references('id').inTable('lender_profiles').onDelete('CASCADE');
    t.uuid('venture_id').notNullable().references('id').inTable('ventures').onDelete('CASCADE');
    t.enum('status', ['monitoring', 'active_loan', 'completed', 'defaulted']).defaultTo('monitoring');
    t.boolean('monitoring_active').defaultTo(true);
    t.timestamp('last_alert').nullable();
    t.decimal('disbursed_amount', 20, 2).nullable();
    t.string('disbursed_currency', 3).defaultTo('GBP');
    t.timestamp('disbursed_at').nullable();
    t.timestamps(true, true);
    t.timestamp('deleted_at').nullable();
    t.unique(['lender_id', 'venture_id']);
    t.index(['lender_id'], 'idx_portfolio_lender_id');
  });

  await knex.schema.createTable('lender_alerts', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('portfolio_id').notNullable().references('id').inTable('lender_portfolios').onDelete('CASCADE');
    t.string('alert_type', 100).notNullable();
    t.text('previous_value').nullable();
    t.text('current_value').nullable();
    t.enum('severity', ['info', 'warning', 'critical']).defaultTo('info');
    t.boolean('acknowledged').defaultTo(false);
    t.timestamps(true, true);
    t.index(['portfolio_id'], 'idx_alerts_portfolio_id');
  });

  // ── UNIVERSITY ─────────────────────────────────────────────
  await knex.schema.createTable('university_profiles', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('institution_name', 200).notNullable();
    t.string('country', 2).nullable();
    t.string('city', 100).nullable();
    t.string('email_domain', 200).nullable();
    t.boolean('verified').defaultTo(false);
    t.timestamps(true, true);
    t.timestamp('deleted_at').nullable();
    t.unique(['user_id']);
  });

  await knex.schema.createTable('university_programmes', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('university_id').notNullable().references('id').inTable('university_profiles').onDelete('CASCADE');
    t.string('programme_name', 200).notNullable();
    t.string('department', 200).nullable();
    t.decimal('avg_score', 7, 2).defaultTo(0);
    t.integer('founder_count').defaultTo(0);
    t.timestamps(true, true);
    t.index(['university_id'], 'idx_programmes_uni_id');
  });

  await knex.schema.createTable('university_founders', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('university_id').notNullable().references('id').inTable('university_profiles').onDelete('CASCADE');
    t.uuid('venture_id').notNullable().references('id').inTable('ventures').onDelete('CASCADE');
    t.enum('matched_by', ['email_domain', 'self_declared', 'proximity']).defaultTo('self_declared');
    t.timestamps(true, true);
    t.unique(['university_id', 'venture_id']);
  });

  // ── BILLING ────────────────────────────────────────────────
  await knex.schema.createTable('plans', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('name', 100).notNullable();
    t.string('revenue_stream_id', 10).notNullable(); // R01-R12
    t.enum('role', ['founder', 'investor', 'provider', 'lender', 'university']).notNullable();
    t.decimal('price_monthly', 10, 2).notNullable();
    t.decimal('price_annual', 10, 2).notNullable();
    t.string('currency', 3).defaultTo('GBP');
    t.jsonb('features').defaultTo('[]');
    t.jsonb('limits').defaultTo('{}');
    t.string('stripe_price_id_monthly', 200).nullable();
    t.string('stripe_price_id_annual', 200).nullable();
    t.boolean('active').defaultTo(true);
    t.timestamps(true, true);
    t.index(['role'], 'idx_plans_role');
    t.index(['active'], 'idx_plans_active');
  });

  await knex.schema.createTable('subscriptions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.uuid('plan_id').notNullable().references('id').inTable('plans');
    t.string('stripe_subscription_id', 200).unique().nullable();
    t.string('paystack_subscription_id', 200).unique().nullable();
    t.enum('status', ['trialing', 'active', 'past_due', 'cancelled', 'unpaid']).defaultTo('trialing');
    t.timestamp('current_period_start').nullable();
    t.timestamp('current_period_end').nullable();
    t.timestamp('cancel_at').nullable();
    t.timestamp('cancelled_at').nullable();
    t.timestamps(true, true);
    t.index(['user_id'], 'idx_subs_user_id');
    t.index(['status'], 'idx_subs_status');
  });

  await knex.schema.createTable('api_usage', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('endpoint', 200).notNullable();
    t.integer('calls_today').defaultTo(0);
    t.integer('calls_month').defaultTo(0);
    t.integer('quota_monthly').defaultTo(1000);
    t.decimal('overage_rate', 8, 4).defaultTo(0.15);
    t.date('reset_date').notNullable().defaultTo(knex.fn.now());
    t.timestamps(true, true);
    t.unique(['user_id', 'endpoint']);
    t.index(['user_id'], 'idx_api_usage_user_id');
  });

  await knex.schema.createTable('credit_balances', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('credit_type', 50).notNullable(); // api_calls, introductions, leads, placements
    t.integer('balance').defaultTo(0);
    t.timestamp('last_topped_up').nullable();
    t.timestamps(true, true);
    t.unique(['user_id', 'credit_type']);
  });

  await knex.schema.createTable('credit_transactions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('credit_type', 50).notNullable();
    t.integer('amount').notNullable();
    t.enum('direction', ['credit', 'debit']).notNullable();
    t.string('description', 500).nullable();
    t.uuid('reference_id').nullable();
    t.timestamps(true, true);
    t.index(['user_id'], 'idx_credit_tx_user_id');
  });

  await knex.schema.createTable('invoices', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('stripe_invoice_id', 200).unique().nullable();
    t.decimal('amount', 10, 2).notNullable();
    t.string('currency', 3).defaultTo('GBP');
    t.enum('status', ['draft', 'open', 'paid', 'void', 'uncollectible']).defaultTo('open');
    t.timestamp('paid_at').nullable();
    t.string('pdf_url', 500).nullable();
    t.timestamps(true, true);
    t.index(['user_id'], 'idx_invoices_user_id');
    t.index(['status'], 'idx_invoices_status');
  });

  await knex.schema.createTable('revenue_events', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('stream_id', 10).notNullable(); // R01-R12
    t.uuid('user_id').notNullable().references('id').inTable('users');
    t.decimal('amount', 10, 2).notNullable();
    t.string('currency', 3).defaultTo('GBP');
    t.string('event_type', 100).notNullable();
    t.jsonb('metadata').defaultTo('{}');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['stream_id'], 'idx_rev_events_stream_id');
    t.index(['user_id'], 'idx_rev_events_user_id');
    t.index(['created_at'], 'idx_rev_events_created_at');
  });

  // R12 Marketplace — Commission infrastructure
  await knex.schema.createTable('marketplace_bookings', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('founder_id').notNullable().references('id').inTable('users');
    t.uuid('provider_id').notNullable().references('id').inTable('provider_profiles');
    t.uuid('listing_id').notNullable().references('id').inTable('provider_listings');
    t.decimal('listing_price', 10, 2).notNullable();
    t.decimal('commission_amount', 10, 2).notNullable();
    t.decimal('commission_pct', 5, 2).notNullable().defaultTo(9.5); // ALWAYS 9.5
    t.decimal('total_charged', 10, 2).notNullable();
    t.string('currency', 3).notNullable();
    t.string('stripe_payment_intent_id', 200).nullable();
    t.string('paystack_reference', 200).nullable();
    t.enum('status', ['pending', 'held', 'released', 'refunded', 'disputed']).defaultTo('pending');
    t.timestamp('service_delivery_date').nullable();
    t.timestamp('release_at').nullable(); // 14 days after delivery
    t.text('dispute_reason').nullable();
    t.timestamps(true, true);
    t.index(['founder_id'], 'idx_bookings_founder_id');
    t.index(['provider_id'], 'idx_bookings_provider_id');
    t.index(['status'], 'idx_bookings_status');
    // Enforce 9.5% commission at DB level
    t.check("commission_pct = 9.5", [], 'chk_commission_pct');
  });

  // R11 — ON HOLD infrastructure (never activated without legal clearance)
  await knex.schema.createTable('escrow_accounts', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('lender_id').notNullable().references('id').inTable('lender_profiles');
    t.uuid('venture_id').notNullable().references('id').inTable('ventures');
    t.decimal('amount', 20, 2).notNullable();
    t.string('currency', 3).notNullable();
    t.enum('status', ['pending', 'held', 'released', 'refunded']).defaultTo('pending');
    t.boolean('activated').defaultTo(false); // ALWAYS false until legal clearance
    t.string('activation_jurisdiction', 50).nullable();
    t.text('legal_clearance_reference').nullable();
    t.timestamps(true, true);
    // R11 is never activated — enforced here too
    t.check("activated = false", [], 'chk_r11_not_activated');
  });

  // ── ACXM ───────────────────────────────────────────────────
  await knex.schema.createTable('acxm_signals', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').nullable().references('id').inTable('users');
    t.uuid('venture_id').nullable().references('id').inTable('ventures');
    t.string('signal_type', 200).notNullable();
    t.jsonb('signal_data').defaultTo('{}');
    t.enum('severity', ['info', 'warning', 'critical']).defaultTo('info');
    t.enum('signal_class', ['opportunity', 'threat']).notNullable();
    t.enum('status', ['new', 'actioned', 'dismissed', 'escalated']).defaultTo('new');
    t.timestamp('detected_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('actioned_at').nullable();
    t.timestamps(true, true);
    t.index(['user_id'], 'idx_acxm_signals_user_id');
    t.index(['signal_class'], 'idx_acxm_signals_class');
    t.index(['status'], 'idx_acxm_signals_status');
  });

  await knex.schema.createTable('acxm_interventions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('signal_id').notNullable().references('id').inTable('acxm_signals').onDelete('CASCADE');
    t.string('intervention_type', 200).notNullable();
    t.enum('channel', ['push', 'email', 'sms', 'whatsapp', 'in_app', 'admin_alert']).notNullable();
    t.jsonb('content').defaultTo('{}');
    t.boolean('suppressed').defaultTo(false);
    t.boolean('admin_confirmation_required').defaultTo(false);
    t.boolean('admin_confirmed').defaultTo(false);
    t.uuid('confirmed_by').nullable().references('id').inTable('users');
    t.timestamp('dispatched_at').nullable();
    t.timestamp('opened_at').nullable();
    t.timestamp('clicked_at').nullable();
    t.timestamp('converted_at').nullable();
    t.timestamps(true, true);
    t.index(['signal_id'], 'idx_interventions_signal_id');
  });

  await knex.schema.createTable('acxm_suppression', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.integer('intervention_count_24h').defaultTo(0);
    t.integer('intervention_count_7d').defaultTo(0);
    t.timestamp('last_intervention_at').nullable();
    t.timestamp('suppressed_until').nullable();
    t.timestamps(true, true);
    t.unique(['user_id']);
  });

  await knex.schema.createTable('acxm_rules', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('rule_name', 200).notNullable().unique();
    t.enum('rule_type', ['opportunity', 'threat']).notNullable();
    t.jsonb('trigger_logic').notNullable();
    t.string('intervention_template', 200).notNullable();
    t.boolean('active').defaultTo(true);
    t.decimal('weight', 5, 4).defaultTo(1.0);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('acxm_escalations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('signal_id').notNullable().references('id').inTable('acxm_signals').onDelete('CASCADE');
    t.string('reason', 500).notNullable();
    t.uuid('admin_id').nullable().references('id').inTable('users');
    t.enum('status', ['pending', 'reviewed', 'resolved']).defaultTo('pending');
    t.timestamp('escalated_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('resolved_at').nullable();
    t.text('resolution_notes').nullable();
    t.timestamps(true, true);
    t.index(['status'], 'idx_escalations_status');
  });

  // ── NOTIFICATIONS ──────────────────────────────────────────
  await knex.schema.createTable('notifications', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('type', 100).notNullable();
    t.string('title', 200).notNullable();
    t.text('body').notNullable();
    t.jsonb('data').defaultTo('{}');
    t.boolean('read').defaultTo(false);
    t.timestamp('read_at').nullable();
    t.timestamps(true, true);
    t.index(['user_id'], 'idx_notifications_user_id');
    t.index(['read'], 'idx_notifications_read');
  });

  await knex.schema.createTable('notification_templates', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('type', 100).notNullable().unique();
    t.enum('channel', ['push', 'email', 'sms', 'in_app', 'whatsapp']).notNullable();
    t.string('subject_template', 500).nullable();
    t.text('body_template').notNullable();
    t.boolean('active').defaultTo(true);
    t.timestamps(true, true);
  });

  // ── ADMIN / GOLDEN EYE ─────────────────────────────────────
  await knex.schema.createTable('admin_actions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('admin_user_id').notNullable().references('id').inTable('users');
    t.string('action_type', 100).notNullable();
    t.string('target_type', 100).notNullable();
    t.uuid('target_id').nullable();
    t.jsonb('details').defaultTo('{}');
    t.string('ip', 45).nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['admin_user_id'], 'idx_admin_actions_admin_id');
    t.index(['action_type'], 'idx_admin_actions_type');
    t.index(['created_at'], 'idx_admin_actions_created_at');
  });

  await knex.schema.createTable('platform_config', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('key', 200).notNullable().unique();
    t.jsonb('value').notNullable();
    t.uuid('updated_by').nullable().references('id').inTable('users');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('feature_flags', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('key', 200).notNullable().unique();
    t.boolean('enabled').defaultTo(false);
    t.integer('rollout_pct').defaultTo(0);
    t.jsonb('roles').defaultTo('[]');
    t.uuid('updated_by').nullable().references('id').inTable('users');
    t.timestamps(true, true);
  });

  // ── AUDIT & COMPLIANCE — APPEND ONLY ──────────────────────
  // NO updated_at, NO deleted_at, NO UPDATE/DELETE grants for app user
  await knex.schema.createTable('audit_log', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').nullable(); // nullable — system actions have no user
    t.string('action', 200).notNullable();
    t.string('resource_type', 100).notNullable();
    t.uuid('resource_id').nullable();
    t.jsonb('old_value').defaultTo('{}');
    t.jsonb('new_value').defaultTo('{}');
    t.string('ip', 45).nullable();
    t.string('user_agent', 500).nullable();
    t.string('request_id', 100).nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    // PARTITION BY MONTH in production — for now, index by date
    t.index(['user_id'], 'idx_audit_user_id');
    t.index(['action'], 'idx_audit_action');
    t.index(['resource_type'], 'idx_audit_resource_type');
    t.index(['created_at'], 'idx_audit_created_at');
  });

  await knex.schema.createTable('data_access_log', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('accessor_id').notNullable().references('id').inTable('users');
    t.uuid('accessed_user_id').notNullable().references('id').inTable('users');
    t.string('data_type', 100).notNullable();
    t.string('purpose', 200).nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['accessor_id'], 'idx_data_access_accessor');
    t.index(['accessed_user_id'], 'idx_data_access_accessed');
  });

  await knex.schema.createTable('gdpr_requests', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users');
    t.enum('request_type', ['access', 'deletion', 'portability', 'rectification', 'restriction']).notNullable();
    t.enum('status', ['pending', 'processing', 'completed', 'partially_completed', 'rejected']).defaultTo('pending');
    t.timestamp('due_by').notNullable(); // SLA: 30 days
    t.text('notes').nullable();
    t.jsonb('legal_holds').defaultTo('[]'); // data that cannot be deleted
    t.timestamp('completed_at').nullable();
    t.timestamps(true, true);
    t.index(['status'], 'idx_gdpr_status');
    t.index(['due_by'], 'idx_gdpr_due_by');
    t.index(['user_id'], 'idx_gdpr_user_id');
  });

  // ── ANALYTICS EVENTS ───────────────────────────────────────
  await knex.schema.createTable('analytics_events', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').nullable();
    t.string('event_type', 200).notNullable();
    t.jsonb('event_data').defaultTo('{}');
    t.string('session_id', 100).nullable();
    t.string('device', 50).nullable();
    t.string('country', 2).nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['event_type'], 'idx_events_type');
    t.index(['user_id'], 'idx_events_user_id');
    t.index(['created_at'], 'idx_events_created_at');
  });

  // ── SEED: Tier configuration ────────────────────────────────
  await knex('tier_config').insert([
    { tier_name: 'EARLY',       min_score: 0,   max_score: 300,  label: 'Early Stage',  color: '#94A3B8', benefits: JSON.stringify([]) },
    { tier_name: 'RISING',      min_score: 301,  max_score: 600,  label: 'Rising',       color: '#F59E0B', benefits: JSON.stringify([]) },
    { tier_name: 'INVESTABLE',  min_score: 601,  max_score: 850,  label: 'Investable',   color: '#10B981', benefits: JSON.stringify([]) },
    { tier_name: 'ELITE',       min_score: 851,  max_score: 1000, label: 'Elite',        color: '#C9900C', benefits: JSON.stringify([]) },
  ]);

  // ── SEED: Platform config defaults ─────────────────────────
  await knex('platform_config').insert([
    { key: 'r12_commission_pct',     value: JSON.stringify(9.5) },
    { key: 'r11_active',             value: JSON.stringify(false) },
    { key: 'dark_mode_enabled',      value: JSON.stringify(false) },
    { key: 'otp_expiry_seconds',     value: JSON.stringify(300) },
    { key: 'otp_max_attempts',       value: JSON.stringify(5) },
    { key: 'otp_lockout_seconds',    value: JSON.stringify(1800) },
    { key: 'acxm_max_24h',           value: JSON.stringify(3) },
    { key: 'acxm_max_7d',            value: JSON.stringify(7) },
    { key: 'score_lock_ttl_seconds', value: JSON.stringify(30) },
  ]);

  // ── SEED: Feature flags ─────────────────────────────────────
  await knex('feature_flags').insert([
    { key: 'dark_mode',            enabled: false, rollout_pct: 0,   roles: JSON.stringify([]) },
    { key: 'r12_marketplace',      enabled: false, rollout_pct: 0,   roles: JSON.stringify(['founder', 'provider']) },
    { key: 'r11_escrow',           enabled: false, rollout_pct: 0,   roles: JSON.stringify([]) },
    { key: 'whatsapp_otp',         enabled: false, rollout_pct: 0,   roles: JSON.stringify([]) },
    { key: 'gemini_classification', enabled: true, rollout_pct: 100, roles: JSON.stringify(['founder']) },
  ]);
}

export async function down(knex: Knex): Promise<void> {
  // Drop in reverse dependency order
  const tables = [
    'analytics_events', 'gdpr_requests', 'data_access_log', 'audit_log',
    'feature_flags', 'platform_config', 'admin_actions',
    'notification_templates', 'notifications',
    'acxm_escalations', 'acxm_rules', 'acxm_suppression', 'acxm_interventions', 'acxm_signals',
    'escrow_accounts', 'marketplace_bookings',
    'revenue_events', 'invoices', 'credit_transactions', 'credit_balances',
    'api_usage', 'subscriptions', 'plans',
    'lender_alerts', 'lender_portfolios', 'lender_criteria', 'lender_profiles',
    'university_founders', 'university_programmes', 'university_profiles',
    'provider_leads', 'provider_listings', 'provider_profiles',
    'deal_room_founders', 'deal_rooms', 'investor_matches',
    'investor_theses', 'investor_profiles',
    'bankability_scores',
    'score_signals', 'score_history', 'score_breakdowns', 'scores',
    'scoring_rules', 'tier_config',
    'pitch_videos', 'venture_financial_data', 'venture_social_profiles',
    'venture_documents', 'ventures',
    'otp_records', 'user_consents', 'user_sessions',
    'user_preferences', 'user_profiles', 'users',
  ];
  for (const table of tables) {
    await knex.schema.dropTableIfExists(table);
  }
}
