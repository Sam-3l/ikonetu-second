# IkonetU Platform — Setup & Completion Guide

Last updated: session 5 of build

---

## BUILD STATUS

| Phase | Status | Notes |
|---|---|---|
| Phase 1 — Foundation | ✅ Complete | auth, user, consent, venture |
| Phase 2 — Scoring | ✅ Complete | scoring, bankability, scout |
| Phase 3 — Revenue | ✅ Complete | billing, notification, analytics |
| Phase 4 — Dashboards | ✅ Complete | admin, roles, acxm |
| Phase 5 — Security & Ops | ✅ Complete | encryption, compliance, CI/CD, frontend |
| Media service | ✅ Built (stub) | Signed URLs active. Transcoding needs Cloud Transcoder setup. |
| API metering | ✅ Built | Redis quota + tier enforcement |
| Stripe Connect | 📄 Code ready | Provider onboarding in connect-and-paystack.ts — needs activation |
| Paystack subscriptions | 📄 Code ready | Recurring plans in connect-and-paystack.ts — needs Paystack plan codes |
| Search service | ❌ Not built | PostgreSQL full-text is a viable MVP alternative (see below) |
| Report service (R09) | ❌ Not built | PDF/Excel export — see below |

---

## ISSUES YOU MUST ACT ON

These cannot be resolved in code. Each one is blocking something specific.

---

### 🔴 URGENT — Security (do these first, before running any service)

#### 1. Rotate all exposed API keys

Every key that appeared in this chat conversation must be regenerated.
Old values are dead — new values go in `.env` only, never in chat.

```
SendGrid:
  → app.sendgrid.com → Settings → API Keys
  → Delete key starting with SG.NQ6qLL9a...
  → Create new key with "Mail Send" permission only
  → Paste in .env as SENDGRID_API_KEY=SG.your_new_key

Stripe live key (if you used it):
  → dashboard.stripe.com/apikeys
  → Roll the sk_live_ key
  → During development ALWAYS use sk_test_ not sk_live_
  → sk_test_ keys are fine to expose (no real money)

GCP service account:
  → console.cloud.google.com → IAM & Admin → Service Accounts
  → Find firebase-adminsdk-fbsvc@ikonetu.iam.gserviceaccount.com
  → Keys tab → delete the exposed key
  → Add Key → Create new key → JSON → download
  → Save as ikonetu-service-account.json in project root
  → This file is in .gitignore — never commit it

Google Maps:
  → console.cloud.google.com → APIs & Services → Credentials
  → Find AIzaSyCkrxPOO5e...
  → Edit → Application restrictions: HTTP referrers
  → Add: https://ikonetu.com/* and http://localhost:5173/*
  → API restrictions: Maps JavaScript, Places, Geocoding, Directions, Distance Matrix only
  → This restricts the key so even if leaked it can only call Maps from your domains

Paystack:
  → dashboard.paystack.com → Settings → Developer
  → Regenerate secret key
  → Update .env: PAYSTACK_SECRET_KEY=sk_live_... (or sk_test_ for dev)
```

---

### 🔴 URGENT — Stripe webhook secret

The billing service will reject all Stripe webhooks until this is set.

```bash
# Install Stripe CLI: https://stripe.com/docs/stripe-cli
brew install stripe/stripe-cli/stripe

# Login
stripe login

# In a separate terminal while running billing-service locally:
stripe listen --forward-to localhost:3008/api/v1/billing/webhooks/stripe
# → This prints: Your webhook signing secret is whsec_xxxxx
# → Copy that into .env as STRIPE_WEBHOOK_SECRET=whsec_xxxxx
```

For production, set the webhook in Stripe dashboard:
```
dashboard.stripe.com → Developers → Webhooks → Add endpoint
URL: https://your-domain.com/api/v1/billing/webhooks/stripe
Events: payment_intent.succeeded, invoice.paid, invoice.payment_failed,
        customer.subscription.updated, customer.subscription.deleted,
        account.updated
```

---

### 🟡 REQUIRED BEFORE LAUNCH — Stripe products

Plans exist in your DB but need corresponding Stripe Price IDs.

```bash
# Create products and prices in Stripe dashboard (or via CLI):
stripe products create --name="Lender Starter"
stripe prices create --product=prod_xxx --currency=gbp --unit-amount=29900 --recurring[interval]=month

# Then update the plans table with the price IDs:
UPDATE plans SET stripe_price_id_monthly = 'price_xxx', stripe_price_id_annual = 'price_yyy'
WHERE name = 'Lender Starter';
```

---

### 🟡 REQUIRED BEFORE LAUNCH — Stripe Connect for providers

Code is ready in `services/billing-service/src/connect-and-paystack.ts`.
To activate:

1. Enable Stripe Connect in dashboard: dashboard.stripe.com → Connect → Settings
2. Set `FRONTEND_URL=https://your-domain.com` in `.env`
3. Uncomment the route blocks in `connect-and-paystack.ts`
4. Import and mount those routes in `billing-service/src/index.ts`:

```typescript
// At the top of billing-service/src/index.ts:
import './connect-and-paystack';
// (The file auto-registers routes on the same app instance)
// Actually — better to copy the route handlers directly into index.ts
// since they share the same app instance
```

Until Connect is active, R12 payouts to providers are blocked.
The booking endpoint checks for `stripe_connect_account_id` and will fail gracefully.

---

### 🟡 REQUIRED BEFORE LAUNCH — Paystack recurring subscriptions

Paystack code is also in `connect-and-paystack.ts`.
Before enabling:

1. Create plans in Paystack dashboard: dashboard.paystack.com → Plans
2. Add `paystack_plan_code` column to `plans` table:
   ```sql
   ALTER TABLE plans ADD COLUMN paystack_plan_code VARCHAR(50);
   UPDATE plans SET paystack_plan_code = 'PLN_xxx' WHERE name = 'Lender Starter';
   ```
3. Uncomment the Paystack subscription routes in `connect-and-paystack.ts`

African users in Nigeria, Kenya, Ghana paying in local currency need this.

---

### 🔴 LEGAL — These block user acquisition in each jurisdiction

| Item | Blocks | How to resolve |
|---|---|---|
| UK Ltd registration | Publishing T&Cs with a real registered address | Companies House online: £12, 24 hours |
| DPO appointment | GDPR Article 37 obligation (you score thousands of people = "large scale systematic monitoring") | Appoint internally or use a DPO-as-a-service provider |
| NDPC registration (Nigeria) | Any Nigerian user data | ndpc.gov.ng — register as data controller |
| Kenya Data Commissioner | Any Kenyan user data | odpc.go.ke — notify as data controller |
| Ghana DPA registration | Any Ghanaian user data | dataprotection.gov.gh |
| PI insurance for providers | Activating R12 marketplace (platform liability) | Broker: Hiscox, Markel, or Lloyd's syndicate |
| Cyber liability insurance | Storing PII at scale | Same brokers as above |
| R11 legal opinion | Activating loan disbursement fee | One opinion per jurisdiction (NG, KE, GH, ZA, UK) |

---

### 🟡 REQUIRED — SendGrid sender verification

```
app.sendgrid.com → Settings → Sender Authentication
→ Verify noreply@ikonetu.com as a sender (or use domain authentication)
→ Domain authentication is better: add DNS records for ikonetu.com
→ This prevents emails landing in spam
```

---

## ISSUES I CAN RESOLVE (code fixes — already applied in this session)

These were flagged in the rating and are now fixed:

| Issue | Fix applied |
|---|---|
| `packages/config/package.json` missing | ✅ Created |
| `packages/shared/package.json` missing | ✅ Created |
| media-service missing | ✅ Built (signed URLs + video stub) |
| api-metering-service missing | ✅ Built (Redis + tier enforcement) |
| Stripe Connect onboarding missing | ✅ Code written, commented — activate when ready |
| Paystack recurring subscriptions missing | ✅ Code written, commented — activate when ready |

Already present in build (were not actually missing):
| Item | Status |
|---|---|
| `vite.config.ts` | ✅ Was already in build |
| Error boundaries (`ErrorBoundary.tsx`) | ✅ Was already in build |
| Score Redis cache (`score-cache.ts`) | ✅ Was already in build |
| WebSocket reconnection (`useSocket.ts`) | ✅ Was already in build |
| `rejectDocument` in admin API | ✅ Was already in build |
| Bankability versioning (INSERT not MERGE) | ✅ Was already in build |
| Venture documents use signed URLs | ✅ Was already in build |
| Per-service `tsconfig.json` files | ✅ All 14 present |
| node-cron, firebase-admin, socket.io in package.json | ✅ All declared |

---

## REMAINING CODE GAPS (not built — lower priority)

### Search service
Not built. For MVP, PostgreSQL full-text search is sufficient:
```sql
-- Add to ventures table:
ALTER TABLE ventures ADD COLUMN search_vector tsvector;
CREATE INDEX idx_ventures_search ON ventures USING GIN(search_vector);
UPDATE ventures SET search_vector =
  to_tsvector('english', name || ' ' || COALESCE(description,'') || ' ' || COALESCE(sector,''));
```
Use `ts_query` in the roles-service investor match endpoint. Elasticsearch can be added post-launch.

### Report service (R09)
Not built. When ready:
- PDF: use `pdfkit` or `puppeteer` with HTML templates
- Excel: use `exceljs`
- Reports are generated on demand and stored in GCS with a signed URL
- R09 charges £1,200–£4,800 per report — implement billing check before generation

### SendGrid dynamic templates
Currently email bodies are inline HTML strings.
For production, create templates in SendGrid dashboard and reference by template ID:
```typescript
await sgMail.send({
  to: email,
  from: { email: env.SENDGRID_FROM_EMAIL, name: 'IkonetU' },
  templateId: 'd-your_template_id',
  dynamicTemplateData: { name, code, expiresIn: 5 },
});
```
This lets marketing update email copy without a code deploy.

---

## HOW TO START EVERYTHING

```bash
# 1. Extract the complete build
tar -xzf ikonetu-complete.tar.gz && cd ikonetu-build

# 2. Copy .env.example and fill in your new (rotated) keys
cp .env.example .env
# Fill in: SENDGRID_API_KEY, DB_HOST, DB_PASSWORD, STRIPE_SECRET_KEY (sk_test_),
#           STRIPE_WEBHOOK_SECRET, GCS_BUCKET, GOOGLE_APPLICATION_CREDENTIALS

# 3. Run migrations
npm run migrate

# 4. Start with Docker (simplest)
docker-compose up

# 5. OR start services individually
npm run dev -w services/auth-service          # 3001
npm run dev -w services/user-service          # 3002
npm run dev -w services/scoring-service       # 3003
npm run dev -w services/consent-service       # 3004
npm run dev -w services/bankability-service   # 3005
npm run dev -w services/venture-service       # 3006
npm run dev -w services/scout-service         # 3007
npm run dev -w services/billing-service       # 3008
npm run dev -w services/notification-service  # 3010
npm run dev -w services/analytics-service     # 3011
npm run dev -w services/admin-service         # 3012
npm run dev -w services/roles-service         # 3013
npm run dev -w services/acxm-service          # 3014
npm run dev -w services/compliance-service    # 3015
npm run dev -w services/media-service         # 3016
npm run dev -w services/api-metering-service  # 3017

# 6. Start frontend
cd frontend && npm install && npm run dev     # 5173

# 7. Run tests
npm test
```

---

## LAUNCH CHECKLIST

Before going live with real users:

**Security**
- [ ] All API keys rotated (SendGrid, Stripe, GCP, Paystack)
- [ ] Stripe webhook secret configured
- [ ] Google Maps API key restricted to your domains
- [ ] GCP service account key regenerated

**Stripe**
- [ ] Products and prices created in Stripe dashboard
- [ ] Price IDs added to plans table
- [ ] Stripe Connect enabled for provider payouts
- [ ] Test a full booking flow with test card 4242 4242 4242 4242

**Legal**
- [ ] UK Ltd incorporated
- [ ] Registered address in T&Cs
- [ ] DPO appointed
- [ ] NDPC registration (before Nigerian users)
- [ ] SendGrid domain authentication (prevents spam)
- [ ] PI insurance for marketplace
- [ ] Cyber liability insurance

**Infrastructure**
- [ ] Cloud SQL production instance created (europe-west2)
- [ ] Redis (Cloud Memorystore) provisioned
- [ ] GCS bucket `ikonetu-media-prod` created
- [ ] BigQuery dataset `ikonetu_analytics` created
- [ ] All secrets added to GCP Secret Manager
- [ ] CI/CD GitHub Actions secrets configured:
      GCP_SA_KEY, JWT_SECRET, JWT_REFRESH_SECRET, ENCRYPTION_KEY,
      SENDGRID_API_KEY, STRIPE_SECRET_KEY_PROD, STRIPE_WEBHOOK_SECRET,
      GOOGLE_MAPS_API_KEY, PAYSTACK_SECRET_KEY, CODECOV_TOKEN
