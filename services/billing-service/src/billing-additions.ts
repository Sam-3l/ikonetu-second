// ════════════════════════════════════════════════════════════
// BILLING ADDITIONS
// Append these routes to billing-service/src/index.ts
// before the app.get('/health') line.
//
// Adds:
//  1. Stripe Connect onboarding (R12 provider payouts)
//  2. Paystack subscription plans + subscriptions
//     (African users paying in NGN/KES/GHS)
// ════════════════════════════════════════════════════════════

import Stripe from 'stripe';
import axios from 'axios';
import { db } from '@ikonetu/database';
import { env } from '@ikonetu/config';
import { authenticate, requireRole, requireProvider, AppError, NotFoundError } from '@ikonetu/shared/middleware';

const stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2024-04-10' });

// ════════════════════════════════════════════════════════════
// STRIPE CONNECT — Provider Onboarding
// Providers must complete Connect onboarding before they can
// receive R12 marketplace payouts.
// ════════════════════════════════════════════════════════════

// Step 1: Provider clicks "Connect payout account"
// → we create a Connect account and redirect to Stripe
export async function stripeConnectRoutes(app: ReturnType<typeof import('express').default>) {

  // POST /api/v1/billing/connect/onboard
  // Creates a Stripe Connect Express account and returns the onboarding URL
  app.post(
    '/api/v1/billing/connect/onboard',
    authenticate,
    requireProvider,
    async (req: any, res: any, next: any) => {
      try {
        const user = await db('users').where({ id: req.user.id }).first();
        if (!user) throw new NotFoundError('User');

        const providerProfile = await db('provider_profiles').where({ user_id: req.user.id }).first();
        if (!providerProfile) throw new AppError('Complete your provider profile first', 400, 'no-profile');

        // Check if Connect account already exists
        if (providerProfile.stripe_connect_account_id) {
          // Create a new account link in case they need to finish onboarding
          const accountLink = await stripe.accountLinks.create({
            account: providerProfile.stripe_connect_account_id,
            refresh_url: `${process.env.APP_URL || 'http://localhost:5173'}/dashboard?connect=refresh`,
            return_url:  `${process.env.APP_URL || 'http://localhost:5173'}/dashboard?connect=success`,
            type: 'account_onboarding',
          });
          return res.json({ url: accountLink.url, existingAccount: true });
        }

        // Create new Express account
        const account = await stripe.accounts.create({
          type: 'express',
          email: user.email,
          country: user.country === 'GB' ? 'GB' : 'NG', // default to NG for African providers
          capabilities: {
            transfers: { requested: true },
          },
          business_type: 'individual',
          metadata: {
            ikonetUUserId:    req.user.id,
            ikonetUProviderId: providerProfile.id,
          },
        });

        // Store Connect account ID
        await db('provider_profiles')
          .where({ id: providerProfile.id })
          .update({ stripe_connect_account_id: account.id });

        // Create onboarding link
        const accountLink = await stripe.accountLinks.create({
          account: account.id,
          refresh_url: `${process.env.APP_URL || 'http://localhost:5173'}/dashboard?connect=refresh`,
          return_url:  `${process.env.APP_URL || 'http://localhost:5173'}/dashboard?connect=success`,
          type: 'account_onboarding',
        });

        await db('audit_log').insert({
          user_id: req.user.id,
          action: 'provider.connect.onboard.started',
          resource_type: 'provider_profile',
          resource_id: providerProfile.id,
          new_value: JSON.stringify({ connectAccountId: account.id }),
          ip: req.ip,
          request_id: req.requestId,
        });

        res.json({ url: accountLink.url, connectAccountId: account.id });
      } catch (err) { next(err); }
    }
  );

  // GET /api/v1/billing/connect/status
  // Check if provider has completed Connect onboarding
  app.get(
    '/api/v1/billing/connect/status',
    authenticate,
    requireProvider,
    async (req: any, res: any, next: any) => {
      try {
        const profile = await db('provider_profiles').where({ user_id: req.user.id }).first();
        if (!profile?.stripe_connect_account_id) {
          return res.json({ connected: false, message: 'Not connected. POST /connect/onboard to start.' });
        }

        const account = await stripe.accounts.retrieve(profile.stripe_connect_account_id);
        const ready = account.charges_enabled && account.payouts_enabled;

        if (ready && !profile.verified) {
          await db('provider_profiles').where({ id: profile.id }).update({ verified: true });
        }

        res.json({
          connected: true,
          chargesEnabled: account.charges_enabled,
          payoutsEnabled: account.payouts_enabled,
          detailsSubmitted: account.details_submitted,
          ready,
          requirements: account.requirements?.currently_due || [],
        });
      } catch (err) { next(err); }
    }
  );

  // DELETE /api/v1/billing/connect/disconnect
  app.delete(
    '/api/v1/billing/connect/disconnect',
    authenticate,
    requireProvider,
    async (req: any, res: any, next: any) => {
      try {
        const profile = await db('provider_profiles').where({ user_id: req.user.id }).first();
        if (!profile?.stripe_connect_account_id) {
          return res.json({ success: true, message: 'Already disconnected' });
        }

        // Deauthorise the account
        await stripe.oauth.deauthorize({
          client_id: env.STRIPE_CONNECT_CLIENT_ID!,
          stripe_user_id: profile.stripe_connect_account_id,
        }).catch(() => {}); // May fail if account already deauthorised

        await db('provider_profiles').where({ id: profile.id })
          .update({ stripe_connect_account_id: null, verified: false });

        res.json({ success: true });
      } catch (err) { next(err); }
    }
  );
}

// ════════════════════════════════════════════════════════════
// PAYSTACK SUBSCRIPTIONS
// For African users paying in NGN, KES, GHS
// Paystack subscription API: https://api.paystack.co/plan
// ════════════════════════════════════════════════════════════

const PAYSTACK_BASE = 'https://api.paystack.co';

async function paystackPost(path: string, data: Record<string, unknown>) {
  const { data: res } = await axios.post(`${PAYSTACK_BASE}${path}`, data, {
    headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
  });
  return res;
}

async function paystackGet(path: string) {
  const { data: res } = await axios.get(`${PAYSTACK_BASE}${path}`, {
    headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` },
  });
  return res;
}

// Map our plan names to Paystack interval names
const PAYSTACK_INTERVALS = { monthly: 'monthly', annual: 'annually' } as const;

export async function paystackSubscriptionRoutes(app: ReturnType<typeof import('express').default>) {

  // POST /api/v1/billing/paystack/initialize
  // Starts a Paystack subscription for African users
  app.post(
    '/api/v1/billing/paystack/initialize',
    authenticate,
    async (req: any, res: any, next: any) => {
      try {
        const { planId, billing = 'monthly', currency = 'NGN' } = req.body as {
          planId: string; billing: 'monthly' | 'annual'; currency: string;
        };

        const SUPPORTED_CURRENCIES = ['NGN', 'KES', 'GHS', 'ZAR'];
        if (!SUPPORTED_CURRENCIES.includes(currency)) {
          throw new AppError(`Paystack supports: ${SUPPORTED_CURRENCIES.join(', ')}. Use Stripe for GBP/USD.`, 400, 'unsupported-currency');
        }

        const plan = await db('plans').where({ id: planId, active: true }).first();
        if (!plan) throw new NotFoundError('Plan');

        const user = await db('users').where({ id: req.user.id }).first();
        if (!user) throw new NotFoundError('User');

        // Amount in smallest currency unit (kobo for NGN)
        const amountInMajor = billing === 'annual' ? plan.price_annual : plan.price_monthly;
        // Simple GBP to local currency conversion (in production: use live FX rates)
        const FX_RATES: Record<string, number> = { NGN: 1650, KES: 170, GHS: 16, ZAR: 24 };
        const fxRate = FX_RATES[currency] || 1;
        const amountInLocal = Math.round(amountInMajor * fxRate); // convert GBP to local
        const amountInKobo  = amountInLocal * 100; // Paystack uses smallest unit

        // Create/get Paystack plan
        const planCode = `ikonetu_${planId}_${billing}_${currency}`.toLowerCase();
        let paystackPlan;

        // Check if plan already exists on Paystack
        try {
          const existing = await paystackGet(`/plan/${planCode}`);
          paystackPlan = existing.data;
        } catch {
          // Create the plan
          const created = await paystackPost('/plan', {
            name:     `${plan.name} (${billing}) — ${currency}`,
            interval: PAYSTACK_INTERVALS[billing],
            amount:   amountInKobo,
            currency,
          });
          paystackPlan = created.data;
        }

        // Initialise transaction with plan
        const transaction = await paystackPost('/transaction/initialize', {
          email:    user.email,
          amount:   amountInKobo,
          plan:     paystackPlan.plan_code,
          currency,
          metadata: JSON.stringify({
            ikonetUUserId: req.user.id,
            planId,
            billing,
            streamId: plan.revenue_stream_id,
            paymentMethod: 'paystack',
          }),
          callback_url: `${process.env.APP_URL || 'http://localhost:5173'}/billing?paystack=success`,
        });

        // Create pending subscription record
        await db('subscriptions').insert({
          user_id: req.user.id,
          plan_id: planId,
          paystack_subscription_id: transaction.data.reference, // updated after webhook
          status: 'trialing',
        });

        res.json({
          authorizationUrl: transaction.data.authorization_url,
          reference:        transaction.data.reference,
          amount:           amountInLocal,
          currency,
          plan: { name: plan.name, billing },
        });
      } catch (err) { next(err); }
    }
  );

  // POST /api/v1/billing/paystack/cancel
  app.post(
    '/api/v1/billing/paystack/cancel',
    authenticate,
    async (req: any, res: any, next: any) => {
      try {
        const sub = await db('subscriptions')
          .where({ user_id: req.user.id })
          .whereNotNull('paystack_subscription_id')
          .whereIn('status', ['active', 'trialing'])
          .first();

        if (!sub) throw new NotFoundError('Active Paystack subscription');

        // Disable via Paystack API
        await paystackPost('/subscription/disable', {
          code:  sub.paystack_subscription_id,
          token: sub.paystack_email_token,
        }).catch(() => {}); // Don't fail if already cancelled

        await db('subscriptions')
          .where({ id: sub.id })
          .update({ status: 'cancelled', cancelled_at: new Date() });

        res.json({ success: true, message: 'Paystack subscription cancelled.' });
      } catch (err) { next(err); }
    }
  );

  // GET /api/v1/billing/paystack/verify/:reference
  // Called after user returns from Paystack payment page
  app.get(
    '/api/v1/billing/paystack/verify/:reference',
    authenticate,
    async (req: any, res: any, next: any) => {
      try {
        const { reference } = req.params;
        const verification = await paystackGet(`/transaction/verify/${reference}`);
        const txn = verification.data;

        if (txn.status === 'success') {
          const meta = typeof txn.metadata === 'string' ? JSON.parse(txn.metadata) : txn.metadata;
          const userId = meta.ikonetUUserId;
          const planId = meta.planId;
          const streamId = meta.streamId;

          // Activate subscription
          await db('subscriptions')
            .where({ user_id: userId, paystack_subscription_id: reference })
            .update({
              status: 'active',
              paystack_subscription_id: txn.subscription_code || reference,
              paystack_email_token: txn.subscription?.email_token,
              current_period_start: new Date(),
              current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            });

          // Log revenue event
          await db('revenue_events').insert({
            stream_id: streamId || 'R02',
            user_id: userId,
            amount: txn.amount / 100,
            currency: txn.currency,
            event_type: 'paystack.subscription.payment',
            metadata: JSON.stringify({ reference, planId }),
          });

          res.json({ verified: true, status: 'active' });
        } else {
          res.json({ verified: false, status: txn.status });
        }
      } catch (err) { next(err); }
    }
  );
}

// ════════════════════════════════════════════════════════════
// HOW TO WIRE THESE INTO billing-service/src/index.ts:
//
// 1. At the top, import this file:
//    import { stripeConnectRoutes, paystackSubscriptionRoutes } from './billing-additions';
//
// 2. After all existing routes, before app.get('/health'):
//    await stripeConnectRoutes(app);
//    await paystackSubscriptionRoutes(app);
//
// 3. Also add to the provider_profiles table in DB:
//    stripe_connect_account_id VARCHAR(200)
//    stripe_connect_account_id is referenced in billing-service
//    but was missing from the DB schema — add via migration 003.
// ════════════════════════════════════════════════════════════
