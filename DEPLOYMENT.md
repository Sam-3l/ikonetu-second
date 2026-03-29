# IkonetU — Deployment Guide
**IkonetU Technology Limited · England & Wales**
Version 1.0 · March 2026

---

## What's in this package

```
ikonetu-deploy/
├── services/           18 microservices (Node.js + TypeScript)
├── frontend/           React 18 + Vite (11 pages, 5 role dashboards)
├── packages/
│   ├── config/         Zod env validation (boot-time guards)
│   ├── database/       Knex migrations + DB client
│   └── shared/         Middleware, encryption, circuit breaker, Sentry
├── contracts/          6 Solidity smart contracts (Ethereum + Polygon)
├── tests/              Integration · E2E (Playwright) · Load (k6)
├── .github/workflows/  10-step CI/CD pipeline (GitHub Actions)
├── Dockerfile          Multi-stage, non-root, SERVICE_NAME build arg
├── docker-compose.yml  All 18 services + postgres + redis
├── .env.example        143 environment variables (fill before deploy)
├── fix-package-jsons.js One-time setup script
├── playwright.config.ts E2E test config
└── DEPLOYMENT.md       This file
```

---

## Quick start (local dev)

```bash
# 1. Unpack
tar -xzf ikonetu-deploy.tar.gz && cd ikonetu-build

# 2. Install dependencies
node fix-package-jsons.js
npm install

# 3. Copy and fill env
cp .env.example .env
# Edit .env — fill all YOUR_* placeholders

# 4. Start infrastructure
docker-compose up -d postgres redis

# 5. Run migrations
npm run migrate

# 6. Start all services
docker-compose up

# 7. Start frontend dev server
cd frontend && npm install && npm run dev
# → http://localhost:5173

# 8. Build search indexes (one-time)
curl -X POST http://localhost:3017/api/v1/search/admin/build-indexes \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

---

## Service ports

| Service             | Port | Key function                          |
|---------------------|------|---------------------------------------|
| auth-service        | 3001 | OTP, JWT, sessions                    |
| user-service        | 3002 | User CRUD, GDPR export                |
| scoring-service     | 3003 | 0–1000 IkonetU score engine           |
| consent-service     | 3004 | GDPR/NDPR consent management          |
| bankability-service | 3005 | Lender bankability score (0–100)      |
| venture-service     | 3006 | Ventures, documents, social profiles  |
| scout-service       | 3007 | Google Maps, Companies House, Gemini  |
| billing-service     | 3008 | Stripe, Paystack, R01–R12 revenue     |
| notification-service| 3010 | FCM push, SendGrid, Socket.io         |
| analytics-service   | 3011 | BigQuery events, bias audit           |
| admin-service       | 3012 | Golden Eye (12 admin pages)           |
| roles-service       | 3013 | Investor/provider/lender profiles     |
| acxm-service        | 3014 | Autonomous signals (15-min cycle)     |
| compliance-service  | 3015 | 10 automated compliance cron jobs     |
| media-service       | 3016 | GCS signed URLs, avatar resize        |
| search-service      | 3017 | PostgreSQL tsvector full-text search  |
| report-service      | 3018 | PDF (pdfkit) + Excel (exceljs) — R09  |
| api-metering-service| 3019 | Redis quota enforcement — R01         |
| frontend (Vite dev) | 5173 | React 18 + Vite                       |

---

## Environment variables — required before launch

Fill these in `.env` before running any service:

### Database (Cloud SQL PostgreSQL 15)
```
DB_HOST=YOUR_CLOUD_SQL_PUBLIC_IP
DB_PASSWORD=YOUR_DB_PASSWORD
```

### Redis
```
REDIS_URL=redis://YOUR_REDIS_HOST:6379
```

### Auth
```
JWT_SECRET=generate-256-bit-random-string
JWT_PRIVATE_KEY=your-rsa-2048-private-key-pem
JWT_PUBLIC_KEY=your-rsa-2048-public-key-pem
```

### SendGrid (rotate key first — was exposed)
```
SENDGRID_API_KEY=SG.YOUR_NEW_KEY
SENDGRID_FROM_EMAIL=noreply@ikonetu.com
```

### Google Cloud
```
GCP_PROJECT_ID=ikonetu
GCP_SERVICE_ACCOUNT_KEY={"type":"service_account",...}  ← ROTATE FIRST
GCS_BUCKET_NAME=ikonetu-media-prod
```

### Google Maps (restrict key first)
```
GOOGLE_MAPS_API_KEY=YOUR_RESTRICTED_KEY
```

### Stripe
```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...  ← from: stripe listen --forward-to ...
STRIPE_CONNECT_CLIENT_ID=ca_...
```

### Paystack (rotate keys first — were exposed)
```
PAYSTACK_SECRET_KEY=sk_live_YOUR_NEW_KEY
PAYSTACK_PUBLIC_KEY=pk_live_YOUR_NEW_KEY
```

### Gemini AI
```
GEMINI_API_KEY=YOUR_GEMINI_KEY
```

### Sentry
```
SENTRY_DSN=https://YOUR_DSN@sentry.io/PROJECT_ID
```

### App
```
APP_URL=https://app.ikonetu.com
ADMIN_TOKEN=generate-secure-random-string
```

---

## Stripe setup (one-time)

```bash
# 1. Install Stripe CLI
brew install stripe/stripe-cli/stripe

# 2. Login
stripe login

# 3. Forward webhooks (dev)
stripe listen --forward-to localhost:3008/api/v1/billing/webhooks/stripe
# Copy the whsec_... secret into .env as STRIPE_WEBHOOK_SECRET

# 4. Create products in Stripe Dashboard
# Then seed into the plans table:
npm run seed:plans
```

---

## Production deployment (GCP Cloud Run)

```bash
# 1. Authenticate
gcloud auth login
gcloud config set project ikonetu

# 2. Build and push all 18 images
for SERVICE in auth user scoring consent bankability venture scout billing \
  notification analytics admin roles acxm compliance media search report api-metering; do
  docker build --build-arg SERVICE_NAME=${SERVICE}-service -t \
    europe-west2-docker.pkg.dev/ikonetu/${SERVICE}-service:latest .
  docker push europe-west2-docker.pkg.dev/ikonetu/${SERVICE}-service:latest
done

# 3. Deploy each service
gcloud run deploy auth-service \
  --image europe-west2-docker.pkg.dev/ikonetu/auth-service:latest \
  --region europe-west2 \
  --set-env-vars PORT=3001 \
  --set-secrets DB_PASSWORD=db-password:latest

# 4. Deploy frontend
cd frontend
npm run build
# Deploy dist/ to Vercel or Cloud Storage static site
```

---

## CI/CD — GitHub Actions (10 steps)

Pipeline runs on every push to `main` or `staging`:

1. Lint + TypeScript check (max warnings = 0)
2. Dark mode guard (grep → fail if found)
3. R11 activation guard (grep → fail if `R11_ACTIVE=true`)
4. score_history UPDATE guard (grep → fail if UPDATE on score_history)
5. Unit tests (80% coverage threshold)
6. Integration tests (real PostgreSQL + Redis)
7. Security scan (Semgrep + Gitleaks)
8. Build all 18 Docker images
9. Deploy to staging (staging branch)
10. Deploy to production (main branch + health check)

---

## Platform invariants (never change these)

| Invariant              | Enforcement                                        |
|------------------------|----------------------------------------------------|
| Score: 0–1000          | DB CHECK + Zod literal + unit test                 |
| R12 = 9.5% always      | DB constraint + env guard + CI lint + bytecode     |
| R11_ACTIVE = false     | Zod literal validation at boot                     |
| Dark mode = never      | CSS only + CI grep guard                           |
| score_history append-only | No UPDATE/DELETE in DB or code                  |
| ACXM permanent actions | Require admin_confirmed=true                       |
| Audit log immutable    | DB-level append-only, 7yr retention               |

---

## Pre-launch checklist

### Security — URGENT (do before anything else)
- [ ] Rotate SendGrid API key (app.sendgrid.com)
- [ ] Rotate GCP service account JSON (Cloud Console → IAM → Service Accounts)
- [ ] Restrict Google Maps API key to your domain/IP
- [ ] Rotate Paystack keys (Paystack dashboard)

### Legal
- [ ] Appoint Data Protection Officer
- [ ] Register with Nigeria NDPC
- [ ] Register with Kenya Data Commissioner
- [ ] Register with Ghana Data Protection Authority
- [ ] Obtain PI + Cyber + Marketplace Platform Liability insurance
- [ ] Get R11 legal opinion per jurisdiction before activating

### Infrastructure
- [ ] Set up Stripe Connect (copy STRIPE_CONNECT_CLIENT_ID to .env)
- [ ] Configure Stripe webhooks (run stripe listen → copy whsec_ to .env)
- [ ] Create Stripe products/prices → seed into plans table
- [ ] Set up Cloud SQL private IP + SSL
- [ ] Configure Cloudflare WAF rules
- [ ] Set up PagerDuty on-call rotation

### Blockchain
- [ ] Deploy smart contracts to Polygon mainnet (currently on testnet)
- [ ] Deploy DID contracts to Ethereum mainnet
- [ ] Set up Chainlink oracle subscriptions for FX feeds
- [ ] Configure IPFS pinning service (Pinata or Web3.Storage)

---

## Demo login credentials (dev only)

All use OTP code: **123456**

| Role           | Email                       |
|----------------|-----------------------------|
| Founder        | founder@ikonetu.com         |
| Investor       | investor@ikonetu.com        |
| Service Provider| provider@ikonetu.com       |
| Lender         | lender@ikonetu.com          |
| University     | uni@ikonetu.com             |
| Super Admin    | admin@ikonetu.com           |

---

## Support

customer.service@ikonetu.com
IkonetU Technology Limited · England & Wales
