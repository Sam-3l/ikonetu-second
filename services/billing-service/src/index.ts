import { stripeConnectRoutes, paystackSubscriptionRoutes } from './billing-additions';
import express from 'express';
import Stripe from 'stripe';
import { z } from 'zod';
import crypto from 'crypto';
import { env } from '@ikonetu/config';
import { db } from '@ikonetu/database';
import {
  requestId, rateLimiter, authenticate, requireRole,
  validate, auditLog, errorHandler, AppError, NotFoundError,
} from '@ikonetu/shared/middleware';

const app = express();

// Stripe raw body needed for webhook signature verification
app.use('/api/v1/billing/webhooks', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(requestId);

// ── Stripe init ──────────────────────────────────────────────
const stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2024-04-10' });

// ════════════════════════════════════════════════════════════
// PLAN DEFINITIONS — all 12 revenue streams
// ════════════════════════════════════════════════════════════

const PLANS = {
  // R02 — Lender Portal SaaS
  lender_starter:    { role: 'lender',    streamId: 'R02', name: 'Lender Starter',    monthly: 299,  annual: 2868 },
  lender_growth:     { role: 'lender',    streamId: 'R02', name: 'Lender Growth',     monthly: 599,  annual: 5750 },
  lender_enterprise: { role: 'lender',    streamId: 'R02', name: 'Lender Enterprise', monthly: 999,  annual: 9590 },

  // R04 — Investor Deal Room SaaS
  investor_starter:  { role: 'investor',  streamId: 'R04', name: 'Investor Starter',  monthly: 299,  annual: 2868 },
  investor_pro:      { role: 'investor',  streamId: 'R04', name: 'Investor Pro',      monthly: 599,  annual: 5750 },
  investor_fund:     { role: 'investor',  streamId: 'R04', name: 'Investor Fund',     monthly: 999,  annual: 9590 },

  // R06 — Provider Marketplace Listing
  provider_basic:    { role: 'provider',  streamId: 'R06', name: 'Provider Basic',    monthly: 99,   annual: 950 },
  provider_featured: { role: 'provider',  streamId: 'R06', name: 'Provider Featured', monthly: 199,  annual: 1910 },
  provider_premium:  { role: 'provider',  streamId: 'R06', name: 'Provider Premium',  monthly: 399,  annual: 3830 },

  // R08 — API White-Label
  api_starter:       { role: 'lender',    streamId: 'R08', name: 'API Starter',       monthly: 499,  annual: 4790 },
  api_growth:        { role: 'lender',    streamId: 'R08', name: 'API Growth',        monthly: 999,  annual: 9590 },
  api_enterprise:    { role: 'lender',    streamId: 'R08', name: 'API Enterprise',    monthly: 2500, annual: 24000 },
} as const;

// Credit pack definitions (R05, R07, R10)
const CREDIT_PACKS = {
  // R05 — Investor Introductions
  introductions_5:   { creditType: 'introductions', count: 5,   price: 225,  streamId: 'R05' },
  introductions_15:  { creditType: 'introductions', count: 15,  price: 600,  streamId: 'R05' },
  introductions_30:  { creditType: 'introductions', count: 30,  price: 1080, streamId: 'R05' },

  // R07 — Provider Leads
  leads_10:          { creditType: 'leads',          count: 10,  price: 250,  streamId: 'R07' },
  leads_25:          { creditType: 'leads',          count: 25,  price: 550,  streamId: 'R07' },
  leads_50:          { creditType: 'leads',          count: 50,  price: 1000, streamId: 'R07' },

  // R10 — Provider Featured Placement
  placements_5:      { creditType: 'placements',     count: 5,   price: 150,  streamId: 'R10' },
  placements_15:     { creditType: 'placements',     count: 15,  price: 400,  streamId: 'R10' },
  placements_30:     { creditType: 'placements',     count: 30,  price: 600,  streamId: 'R10' },

  // R01 — Score API calls
  api_calls_100:     { creditType: 'api_calls',      count: 100,  price: 15,  streamId: 'R01' },
  api_calls_1000:    { creditType: 'api_calls',      count: 1000, price: 130, streamId: 'R01' },
  api_calls_10000:   { creditType: 'api_calls',      count: 10000,price: 999, streamId: 'R01' },
} as const;

// Metered pricing for R01, R03
const METERED_RATES = {
  R01_per_query:            0.15,  // $0.15 per Score API call (overage)
  R03_per_founder_month:    12.00, // $12/founder/month portfolio monitoring
};

// ── Schemas ──────────────────────────────────────────────────
const CreateSubscriptionSchema = z.object({
  planId:   z.string().min(1),
  billing:  z.enum(['monthly', 'annual']).default('monthly'),
  currency: z.string().length(3).default('GBP'),
});

const PurchaseCreditsSchema = z.object({
  packId: z.enum(Object.keys(CREDIT_PACKS) as [string, ...string[]]),
});

// ── Helpers ──────────────────────────────────────────────────

async function getOrCreateStripeCustomer(userId: string): Promise<string> {
  const user = await db('users').where({ id: userId }).first();
  if (!user) throw new NotFoundError('User');

  // Check if Stripe customer ID already stored
  const existing = await db('subscriptions')
    .where({ user_id: userId })
    .whereNotNull('stripe_subscription_id')
    .select('stripe_subscription_id')
    .first();

  if (existing) {
    // Get customer ID from Stripe subscription
    const sub = await stripe.subscriptions.retrieve(existing.stripe_subscription_id);
    return sub.customer as string;
  }

  // Create new customer
  const customer = await stripe.customers.create({
    email: user.email || undefined,
    name: user.name,
    metadata: { ikonetUUserId: userId, role: user.role },
  });

  return customer.id;
}

async function recordRevenueEvent(
  userId: string,
  streamId: string,
  amount: number,
  currency: string,
  eventType: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  await db('revenue_events').insert({
    stream_id: streamId,
    user_id: userId,
    amount,
    currency: currency.toUpperCase(),
    event_type: eventType,
    metadata: JSON.stringify(metadata),
  });
}

// ════════════════════════════════════════════════════════════
// ROUTES
// ════════════════════════════════════════════════════════════

// GET /api/v1/billing/plans
app.get(
  '/api/v1/billing/plans',
  rateLimiter(),
  authenticate,
  async (req, res, next) => {
    try {
      const role = req.query.role as string || req.user!.role;
      const plans = await db('plans')
        .where({ active: true })
        .modify(q => {
          if (role !== 'super_admin') q.where({ role });
        })
        .orderBy('price_monthly', 'asc');

      res.json({ plans, creditPacks: CREDIT_PACKS, meteredRates: METERED_RATES });
    } catch (err) { next(err); }
  },
);

// POST /api/v1/billing/subscriptions — Create subscription
app.post(
  '/api/v1/billing/subscriptions',
  rateLimiter({ max: 10 }),
  authenticate,
  validate({ body: CreateSubscriptionSchema }),
  auditLog('billing.subscription.create', 'subscription'),
  async (req, res, next) => {
    try {
      const { planId, billing, currency } = req.body as z.infer<typeof CreateSubscriptionSchema>;

      const plan = await db('plans').where({ id: planId, active: true }).first();
      if (!plan) throw new NotFoundError('Plan');

      // Check role eligibility
      if (plan.role !== req.user!.role && req.user!.role !== 'super_admin') {
        throw new AppError(`This plan is for ${plan.role} accounts.`, 403, 'wrong-role');
      }

      // Check no existing active subscription
      const existing = await db('subscriptions')
        .where({ user_id: req.user!.id, status: 'active' })
        .first();
      if (existing) {
        throw new AppError('You already have an active subscription. Use PUT to change plans.', 409, 'already-subscribed');
      }

      const customerId = await getOrCreateStripeCustomer(req.user!.id);
      const priceId = billing === 'annual' ? plan.stripe_price_id_annual : plan.stripe_price_id_monthly;
      const amount = billing === 'annual' ? plan.price_annual : plan.price_monthly;

      // Create Stripe subscription
      const stripeSub = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: priceId || undefined }],
        payment_behavior: 'default_incomplete',
        payment_settings: { save_default_payment_method: 'on_subscription' },
        expand: ['latest_invoice.payment_intent'],
        metadata: {
          ikonetUUserId: req.user!.id,
          planId,
          streamId: plan.revenue_stream_id,
          billing,
        },
      });

      const [subscription] = await db('subscriptions').insert({
        user_id: req.user!.id,
        plan_id: planId,
        stripe_subscription_id: stripeSub.id,
        status: stripeSub.status,
        current_period_start: new Date(stripeSub.current_period_start * 1000),
        current_period_end: new Date(stripeSub.current_period_end * 1000),
      }).returning('*');

      await recordRevenueEvent(req.user!.id, plan.revenue_stream_id, amount, currency, 'subscription.created', { planId, billing });

      const invoice = stripeSub.latest_invoice as Stripe.Invoice;
      const paymentIntent = invoice?.payment_intent as Stripe.PaymentIntent;

      res.status(201).json({
        subscription,
        stripeSubscriptionId: stripeSub.id,
        clientSecret: paymentIntent?.client_secret,
        status: stripeSub.status,
        plan: { name: plan.name, amount, billing, currency },
      });
    } catch (err) { next(err); }
  },
);

// GET /api/v1/billing/subscriptions
app.get(
  '/api/v1/billing/subscriptions',
  rateLimiter(),
  authenticate,
  async (req, res, next) => {
    try {
      const subscription = await db('subscriptions')
        .where({ user_id: req.user!.id })
        .whereIn('status', ['active', 'trialing', 'past_due'])
        .join('plans', 'subscriptions.plan_id', 'plans.id')
        .select('subscriptions.*', 'plans.name as plan_name', 'plans.price_monthly', 'plans.price_annual', 'plans.features', 'plans.limits', 'plans.revenue_stream_id')
        .first();

      res.json({ subscription: subscription || null });
    } catch (err) { next(err); }
  },
);

// PUT /api/v1/billing/subscriptions — Upgrade/downgrade
app.put(
  '/api/v1/billing/subscriptions',
  rateLimiter({ max: 5 }),
  authenticate,
  validate({ body: z.object({ planId: z.string(), billing: z.enum(['monthly', 'annual']).default('monthly') }) }),
  auditLog('billing.subscription.update', 'subscription'),
  async (req, res, next) => {
    try {
      const { planId, billing } = req.body as { planId: string; billing: 'monthly' | 'annual' };

      const currentSub = await db('subscriptions')
        .where({ user_id: req.user!.id, status: 'active' })
        .first();
      if (!currentSub) throw new NotFoundError('Active subscription');

      const newPlan = await db('plans').where({ id: planId, active: true }).first();
      if (!newPlan) throw new NotFoundError('Plan');

      const priceId = billing === 'annual' ? newPlan.stripe_price_id_annual : newPlan.stripe_price_id_monthly;

      // Update via Stripe
      const stripeSub = await stripe.subscriptions.retrieve(currentSub.stripe_subscription_id);
      await stripe.subscriptions.update(stripeSub.id, {
        items: [{ id: stripeSub.items.data[0].id, price: priceId || undefined }],
        proration_behavior: 'create_prorations',
      });

      const [updated] = await db('subscriptions')
        .where({ id: currentSub.id })
        .update({ plan_id: planId, updated_at: new Date() })
        .returning('*');

      res.json({ subscription: updated, newPlan: newPlan.name });
    } catch (err) { next(err); }
  },
);

// DELETE /api/v1/billing/subscriptions — Cancel
app.delete(
  '/api/v1/billing/subscriptions',
  rateLimiter({ max: 5 }),
  authenticate,
  auditLog('billing.subscription.cancel', 'subscription'),
  async (req, res, next) => {
    try {
      const sub = await db('subscriptions')
        .where({ user_id: req.user!.id, status: 'active' })
        .first();
      if (!sub) throw new NotFoundError('Active subscription');

      // Cancel at period end — not immediate
      await stripe.subscriptions.update(sub.stripe_subscription_id, {
        cancel_at_period_end: true,
      });

      const [updated] = await db('subscriptions')
        .where({ id: sub.id })
        .update({ cancel_at: new Date(sub.current_period_end), updated_at: new Date() })
        .returning('*');

      res.json({
        subscription: updated,
        message: 'Subscription will cancel at the end of the current billing period.',
        activeUntil: sub.current_period_end,
      });
    } catch (err) { next(err); }
  },
);

// POST /api/v1/billing/credits/purchase
app.post(
  '/api/v1/billing/credits/purchase',
  rateLimiter({ max: 10 }),
  authenticate,
  validate({ body: PurchaseCreditsSchema }),
  auditLog('billing.credits.purchase', 'credit_balance'),
  async (req, res, next) => {
    try {
      const pack = CREDIT_PACKS[req.body.packId as keyof typeof CREDIT_PACKS];
      if (!pack) throw new NotFoundError('Credit pack');

      const customerId = await getOrCreateStripeCustomer(req.user!.id);

      // Create one-time payment intent
      const paymentIntent = await stripe.paymentIntents.create({
        amount: pack.price * 100, // Stripe uses pence/cents
        currency: 'gbp',
        customer: customerId,
        metadata: {
          ikonetUUserId: req.user!.id,
          packId: req.body.packId,
          creditType: pack.creditType,
          creditCount: pack.count,
          streamId: pack.streamId,
        },
        automatic_payment_methods: { enabled: true },
      });

      res.status(201).json({
        clientSecret: paymentIntent.client_secret,
        pack: { ...pack, packId: req.body.packId },
        amount: pack.price,
        currency: 'GBP',
      });
    } catch (err) { next(err); }
  },
);

// GET /api/v1/billing/credits
app.get(
  '/api/v1/billing/credits',
  rateLimiter(),
  authenticate,
  async (req, res, next) => {
    try {
      const balances = await db('credit_balances').where({ user_id: req.user!.id });
      res.json({ balances });
    } catch (err) { next(err); }
  },
);

// GET /api/v1/billing/credits/history
app.get(
  '/api/v1/billing/credits/history',
  rateLimiter(),
  authenticate,
  async (req, res, next) => {
    try {
      const history = await db('credit_transactions')
        .where({ user_id: req.user!.id })
        .orderBy('created_at', 'desc')
        .limit(100);
      res.json({ history });
    } catch (err) { next(err); }
  },
);

// GET /api/v1/billing/invoices
app.get(
  '/api/v1/billing/invoices',
  rateLimiter(),
  authenticate,
  async (req, res, next) => {
    try {
      const invoices = await db('invoices')
        .where({ user_id: req.user!.id })
        .orderBy('created_at', 'desc')
        .limit(50);
      res.json({ invoices });
    } catch (err) { next(err); }
  },
);

// GET /api/v1/billing/usage
app.get(
  '/api/v1/billing/usage',
  rateLimiter(),
  authenticate,
  async (req, res, next) => {
    try {
      const usage = await db('api_usage').where({ user_id: req.user!.id });
      res.json({ usage });
    } catch (err) { next(err); }
  },
);

// ════════════════════════════════════════════════════════════
// R12 MARKETPLACE — 9.5% commission booking
// INVARIANT: commission_pct is ALWAYS 9.5
// ════════════════════════════════════════════════════════════

const CreateBookingSchema = z.object({
  providerId: z.string().uuid(),
  listingId:  z.string().uuid(),
  currency:   z.string().length(3).default('GBP'),
});

app.post(
  '/api/v1/marketplace/bookings',
  rateLimiter({ max: 20 }),
  authenticate,
  requireRole('founder'),
  validate({ body: CreateBookingSchema }),
  auditLog('marketplace.booking.create', 'marketplace_booking'),
  async (req, res, next) => {
    try {
      const { providerId, listingId, currency } = req.body as z.infer<typeof CreateBookingSchema>;

      // Verify listing exists and is active
      const listing = await db('provider_listings')
        .where({ id: listingId, provider_id: providerId, active: true })
        .whereNull('deleted_at')
        .first();
      if (!listing) throw new NotFoundError('Listing');

      const provider = await db('provider_profiles')
        .where({ id: providerId })
        .join('users', 'provider_profiles.user_id', 'users.id')
        .select('provider_profiles.*', 'users.id as stripe_user_id')
        .first();
      if (!provider) throw new NotFoundError('Provider');

      // Check PI insurance is not expired
      if (provider.pi_certificate_expiry && new Date(provider.pi_certificate_expiry) < new Date()) {
        throw new AppError('This provider\'s professional indemnity insurance has expired. Booking is unavailable.', 400, 'pi-expired');
      }

      const listingPrice = parseFloat(listing.pricing?.base || '0');
      if (listingPrice <= 0) throw new AppError('Invalid listing price', 400, 'invalid-price');

      // INVARIANT: commission is ALWAYS exactly 9.5%
      const commissionPct = 9.5;
      const commissionAmount = Math.round(listingPrice * (commissionPct / 100));
      const totalCharged = listingPrice + commissionAmount;

      // Validate invariant before any payment
      if (commissionPct !== 9.5) throw new AppError('Commission configuration error', 500, 'commission-error');

      const customerId = await getOrCreateStripeCustomer(req.user!.id);

      // Stripe Connect — split payment
      // Provider receives listingPrice, IkonetU receives commissionAmount
      const paymentIntent = await stripe.paymentIntents.create({
        amount: totalCharged * 100,
        currency: currency.toLowerCase(),
        customer: customerId,
        application_fee_amount: commissionAmount * 100,
        transfer_data: {
          destination: provider.stripe_connect_account_id || undefined,
        },
        metadata: {
          bookingType: 'r12_marketplace',
          founderId: req.user!.id,
          providerId,
          listingId,
          listingPrice,
          commissionAmount,
          commissionPct: '9.5',
          streamId: 'R12',
        },
        automatic_payment_methods: { enabled: true },
      });

      // Create booking record — funds held for 14 days post-delivery
      const releaseAt = new Date();
      releaseAt.setDate(releaseAt.getDate() + 14);

      const [booking] = await db('marketplace_bookings').insert({
        founder_id: req.user!.id,
        provider_id: providerId,
        listing_id: listingId,
        listing_price: listingPrice,
        commission_amount: commissionAmount,
        commission_pct: commissionPct, // DB constraint enforces = 9.5
        total_charged: totalCharged,
        currency: currency.toUpperCase(),
        stripe_payment_intent_id: paymentIntent.id,
        status: 'pending',
        release_at: releaseAt,
      }).returning('*');

      await recordRevenueEvent(req.user!.id, 'R12', commissionAmount, currency, 'marketplace.booking.created', {
        bookingId: booking.id, listingId, providerId, commissionPct,
      });

      res.status(201).json({
        booking,
        clientSecret: paymentIntent.client_secret,
        breakdown: {
          listingPrice,
          platformFee: commissionAmount,
          platformFeePct: `${commissionPct}%`,
          totalCharged,
          currency: currency.toUpperCase(),
          providerReceives: listingPrice,
          releaseAfter: '14 days from service delivery',
        },
      });
    } catch (err) { next(err); }
  },
);

// GET /api/v1/marketplace/bookings
app.get(
  '/api/v1/marketplace/bookings',
  rateLimiter(),
  authenticate,
  async (req, res, next) => {
    try {
      const query = db('marketplace_bookings');
      if (req.user!.role === 'founder') query.where({ founder_id: req.user!.id });
      if (req.user!.role === 'provider') {
        const profile = await db('provider_profiles').where({ user_id: req.user!.id }).first();
        if (profile) query.where({ provider_id: profile.id });
      }

      const bookings = await query.orderBy('created_at', 'desc').limit(50);
      res.json({ bookings });
    } catch (err) { next(err); }
  },
);

// POST /api/v1/marketplace/bookings/:id/dispute
app.post(
  '/api/v1/marketplace/bookings/:id/dispute',
  rateLimiter({ max: 5 }),
  authenticate,
  requireRole('founder'),
  async (req, res, next) => {
    try {
      const { reason } = req.body as { reason: string };
      const booking = await db('marketplace_bookings')
        .where({ id: req.params.id, founder_id: req.user!.id })
        .first();

      if (!booking) throw new NotFoundError('Booking');
      if (!['held', 'pending'].includes(booking.status)) {
        throw new AppError('This booking cannot be disputed in its current state.', 400, 'invalid-state');
      }

      // 14-day dispute window
      if (booking.service_delivery_date) {
        const deliveryDate = new Date(booking.service_delivery_date);
        const daysSinceDelivery = Math.floor((Date.now() - deliveryDate.getTime()) / (1000 * 60 * 60 * 24));
        if (daysSinceDelivery > 14) {
          throw new AppError('Dispute window closed. Disputes must be raised within 14 days of service delivery.', 400, 'dispute-window-closed');
        }
      }

      await db('marketplace_bookings')
        .where({ id: req.params.id })
        .update({ status: 'disputed', dispute_reason: reason });

      await db('notifications').insert({
        user_id: req.user!.id,
        type: 'booking.disputed',
        title: 'Your dispute has been received',
        body: 'IkonetU will review your dispute within 10 business days. Funds are held until resolution.',
        data: JSON.stringify({ bookingId: req.params.id }),
      });

      res.json({ success: true, message: 'Dispute raised. Funds held pending review. IkonetU will contact you within 10 business days.' });
    } catch (err) { next(err); }
  },
);

// ════════════════════════════════════════════════════════════
// R01 — Score API (metered, per-call billing)
// ════════════════════════════════════════════════════════════

app.post(
  '/api/v1/score-api/query',
  rateLimiter({ max: 100 }),
  authenticate,
  requireRole('lender', 'investor', 'super_admin'),
  async (req, res, next) => {
    try {
      const { ventureId, fields } = req.body as { ventureId: string; fields?: string[] };

      // Deduct API credit or charge metered
      const balance = await db('credit_balances')
        .where({ user_id: req.user!.id, credit_type: 'api_calls' })
        .first();

      if (!balance || balance.balance <= 0) {
        throw new AppError('Insufficient API credits. Purchase an API credit pack to continue.', 402, 'insufficient-credits');
      }

      // Get the score
      const score = await db('scores').where({ venture_id: ventureId, is_current: true }).first();
      if (!score) throw new NotFoundError('Score — venture not found or not yet scored');

      // Deduct one credit
      await db('credit_balances')
        .where({ user_id: req.user!.id, credit_type: 'api_calls' })
        .decrement('balance', 1);

      await db('credit_transactions').insert({
        user_id: req.user!.id,
        credit_type: 'api_calls',
        amount: 1,
        direction: 'debit',
        description: `Score API query — venture ${ventureId}`,
        reference_id: ventureId,
      });

      // Track usage
      await db('api_usage')
        .insert({ user_id: req.user!.id, endpoint: 'score_query', calls_today: 1, calls_month: 1, quota_monthly: 1000 })
        .onConflict(['user_id', 'endpoint'])
        .merge({ calls_today: db.raw('api_usage.calls_today + 1'), calls_month: db.raw('api_usage.calls_month + 1') });

      await recordRevenueEvent(req.user!.id, 'R01', METERED_RATES.R01_per_query, 'USD', 'api.score.queried', { ventureId });

      // Build response — only requested fields
      const response: Record<string, unknown> = {
        ventureId,
        queriedAt: new Date().toISOString(),
        creditsRemaining: balance.balance - 1,
      };

      if (!fields || fields.includes('score')) response.totalScore = score.total_score;
      if (!fields || fields.includes('tier')) response.tier = score.tier;
      if (!fields || fields.includes('confidence')) response.confidencePct = score.confidence_pct;
      if (!fields || fields.includes('scoredAt')) response.scoredAt = score.scored_at;

      res.json(response);
    } catch (err) { next(err); }
  },
);

// ════════════════════════════════════════════════════════════
// R03 — Portfolio Monitoring (per-founder-per-month)
// ════════════════════════════════════════════════════════════

app.post(
  '/api/v1/lenders/portfolio',
  rateLimiter(),
  authenticate,
  requireRole('lender', 'super_admin'),
  async (req, res, next) => {
    try {
      const { ventureId, disbursedAmount, disbursedCurrency } = req.body as {
        ventureId: string;
        disbursedAmount?: number;
        disbursedCurrency?: string;
      };

      const lenderProfile = await db('lender_profiles').where({ user_id: req.user!.id }).first();
      if (!lenderProfile) throw new AppError('Lender profile required', 400, 'no-profile');

      // Check founder consent
      const venture = await db('ventures').where({ id: ventureId }).first();
      if (!venture) throw new NotFoundError('Venture');

      const consent = await db('user_consents')
        .where({ user_id: venture.user_id, consent_type: 'lender_pool', granted: true })
        .first();
      if (!consent) throw new AppError('Founder has not consented to lender monitoring.', 403, 'no-consent');

      const [entry] = await db('lender_portfolios').insert({
        lender_id: lenderProfile.id,
        venture_id: ventureId,
        status: disbursedAmount ? 'active_loan' : 'monitoring',
        monitoring_active: true,
        disbursed_amount: disbursedAmount || null,
        disbursed_currency: disbursedCurrency || 'GBP',
        disbursed_at: disbursedAmount ? new Date() : null,
      }).returning('*');

      // Record R03 revenue event — $12/founder/month
      await recordRevenueEvent(req.user!.id, 'R03', METERED_RATES.R03_per_founder_month, 'USD', 'portfolio.monitoring.started', { ventureId });

      res.status(201).json({ portfolio: entry });
    } catch (err) { next(err); }
  },
);

// ════════════════════════════════════════════════════════════
// STRIPE WEBHOOK
// ════════════════════════════════════════════════════════════

app.post(
  '/api/v1/billing/webhooks/stripe',
  async (req, res, next) => {
    const sig = req.headers['stripe-signature'] as string;
    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error('Stripe webhook signature failed:', (err as Error).message);
      return res.status(400).json({ error: 'Invalid signature' });
    }

    try {
      switch (event.type) {
        case 'payment_intent.succeeded': {
          const pi = event.data.object as Stripe.PaymentIntent;
          const { bookingType, founderId, providerId, listingId, commissionAmount, streamId } = pi.metadata;

          if (bookingType === 'r12_marketplace') {
            await db('marketplace_bookings')
              .where({ stripe_payment_intent_id: pi.id })
              .update({ status: 'held' });
          }

          // Credit purchases
          if (pi.metadata.creditType) {
            const { ikonetUUserId, creditType, creditCount, packId } = pi.metadata;
            const amount = parseInt(creditCount);

            await db('credit_balances')
              .insert({ user_id: ikonetUUserId, credit_type: creditType, balance: amount, last_topped_up: new Date() })
              .onConflict(['user_id', 'credit_type'])
              .merge({ balance: db.raw(`credit_balances.balance + ${amount}`), last_topped_up: new Date() });

            await db('credit_transactions').insert({
              user_id: ikonetUUserId,
              credit_type: creditType,
              amount,
              direction: 'credit',
              description: `Credit pack purchase: ${packId}`,
            });

            if (pi.metadata.streamId) {
              await recordRevenueEvent(ikonetUUserId, pi.metadata.streamId, pi.amount / 100, pi.currency.toUpperCase(), 'credits.purchased', { packId, creditCount: amount });
            }
          }
          break;
        }

        case 'invoice.paid': {
          const invoice = event.data.object as Stripe.Invoice;
          const sub = invoice.subscription ? await stripe.subscriptions.retrieve(invoice.subscription as string) : null;

          if (sub) {
            await db('subscriptions')
              .where({ stripe_subscription_id: sub.id })
              .update({
                status: sub.status,
                current_period_start: new Date(sub.current_period_start * 1000),
                current_period_end: new Date(sub.current_period_end * 1000),
              });

            await db('invoices').insert({
              user_id: sub.metadata.ikonetUUserId,
              stripe_invoice_id: invoice.id,
              amount: invoice.amount_paid / 100,
              currency: invoice.currency.toUpperCase(),
              status: 'paid',
              paid_at: new Date(),
              pdf_url: invoice.invoice_pdf,
            }).onConflict('stripe_invoice_id').merge();

            await recordRevenueEvent(
              sub.metadata.ikonetUUserId, sub.metadata.streamId, invoice.amount_paid / 100,
              invoice.currency.toUpperCase(), 'subscription.invoice.paid', { invoiceId: invoice.id }
            );
          }
          break;
        }

        case 'customer.subscription.deleted': {
          const sub = event.data.object as Stripe.Subscription;
          await db('subscriptions')
            .where({ stripe_subscription_id: sub.id })
            .update({ status: 'cancelled', cancelled_at: new Date() });
          break;
        }

        case 'customer.subscription.updated': {
          const sub = event.data.object as Stripe.Subscription;
          await db('subscriptions')
            .where({ stripe_subscription_id: sub.id })
            .update({
              status: sub.status,
              current_period_start: new Date(sub.current_period_start * 1000),
              current_period_end: new Date(sub.current_period_end * 1000),
              cancel_at: sub.cancel_at ? new Date(sub.cancel_at * 1000) : null,
            });
          break;
        }

        case 'invoice.payment_failed': {
          const invoice = event.data.object as Stripe.Invoice;
          const sub = invoice.subscription ? await stripe.subscriptions.retrieve(invoice.subscription as string) : null;
          if (sub) {
            await db('subscriptions')
              .where({ stripe_subscription_id: sub.id })
              .update({ status: 'past_due' });

            const userId = sub.metadata.ikonetUUserId;
            await db('notifications').insert({
              user_id: userId,
              type: 'billing.payment_failed',
              title: 'Payment failed',
              body: 'Your subscription payment failed. Please update your payment method to avoid service interruption.',
              data: JSON.stringify({ invoiceId: invoice.id }),
            });
          }
          break;
        }
      }

      res.json({ received: true, type: event.type });
    } catch (err) {
      console.error('Webhook handler error:', err);
      res.status(500).json({ error: 'Webhook handler failed' });
    }
  },
);

// ── Paystack webhook ──────────────────────────────────────────
app.post(
  '/api/v1/billing/webhooks/paystack',
  async (req, res, next) => {
    const hash = crypto
      .createHmac('sha512', env.PAYSTACK_WEBHOOK_SECRET)
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
      return res.status(400).json({ error: 'Invalid Paystack signature' });
    }

    const { event, data } = req.body as { event: string; data: Record<string, unknown> };

    try {
      if (event === 'charge.success') {
        const userId = String(data.metadata?.ikonetUUserId || '');
        const streamId = String(data.metadata?.streamId || 'R12');
        const amount = parseInt(String(data.amount || 0)) / 100; // Paystack uses kobo/pesewas

        if (userId) {
          await recordRevenueEvent(userId, streamId, amount, String(data.currency || 'NGN'), 'paystack.charge.success', { data });
        }
      }

      res.json({ status: true });
    } catch (err) { next(err); }
  },
);

// ── Admin revenue overview ────────────────────────────────────
app.get(
  '/api/v1/admin/revenue/overview',
  rateLimiter(),
  authenticate,
  requireRole('super_admin'),
  async (req, res, next) => {
    try {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

      const [mrr, lastMonthMrr, totalAllTime, byStream] = await Promise.all([
        db('revenue_events').where('created_at', '>=', startOfMonth).sum('amount as total').first(),
        db('revenue_events').where('created_at', '>=', startOfLastMonth).where('created_at', '<=', endOfLastMonth).sum('amount as total').first(),
        db('revenue_events').sum('amount as total').first(),
        db('revenue_events')
          .select('stream_id')
          .sum('amount as total')
          .groupBy('stream_id')
          .orderBy('total', 'desc'),
      ]);

      const mrrValue = parseFloat(String(mrr?.total || 0));
      const lastMrrValue = parseFloat(String(lastMonthMrr?.total || 0));
      const growth = lastMrrValue > 0 ? ((mrrValue - lastMrrValue) / lastMrrValue) * 100 : 0;

      res.json({
        mrr: mrrValue,
        mrrGrowthPct: Math.round(growth * 10) / 10,
        arr: mrrValue * 12,
        totalAllTime: parseFloat(String(totalAllTime?.total || 0)),
        byStream,
      });
    } catch (err) { next(err); }
  },
);

// Stripe Connect + Paystack subscriptions
stripeConnectRoutes(app);
paystackSubscriptionRoutes(app);

app.get('/health', (_, res) => res.json({
  service: 'billing-service', status: 'ok', version: '1.0.0',
  streams: 'R01-R12',
  r12CommissionInvariant: '9.5%',
  r11Status: 'on-hold',
  timestamp: new Date().toISOString(),
}));

app.use(errorHandler);

const PORT = parseInt(env.PORT) + 7; // 3008
async function start() {
  env.NODE_ENV;
  const { initRedis } = await import('@ikonetu/shared/middleware');
  await initRedis();
  app.listen(PORT, () => {
    console.log(`✅ billing-service running on port ${PORT}`);
    console.log(`   Revenue streams: R01–R12 (R11 on hold)`);
    console.log(`   R12 commission: 9.5% (DB-enforced invariant)`);
  });
}
start().catch((err) => { console.error(err); process.exit(1); });

export default app;
