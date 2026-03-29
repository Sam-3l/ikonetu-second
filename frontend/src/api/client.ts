import axios, { type AxiosInstance } from 'axios';

// ════════════════════════════════════════════════════════════
// IKONETU API CLIENT
// Typed wrappers for all 22 backend services
// Light mode only — no dark mode anywhere in this codebase
// ════════════════════════════════════════════════════════════

const AUTH_URL    = import.meta.env.VITE_AUTH_SERVICE_URL    || 'http://localhost:3001';
const USER_URL    = import.meta.env.VITE_USER_SERVICE_URL    || 'http://localhost:3002';
const SCORE_URL   = import.meta.env.VITE_SCORING_SERVICE_URL || 'http://localhost:3003';
const BANK_URL    = import.meta.env.VITE_BANK_SERVICE_URL    || 'http://localhost:3005';
const VENTURE_URL = import.meta.env.VITE_VENTURE_SERVICE_URL || 'http://localhost:3006';
const SCOUT_URL   = import.meta.env.VITE_SCOUT_SERVICE_URL   || 'http://localhost:3007';
const BILLING_URL = import.meta.env.VITE_BILLING_SERVICE_URL || 'http://localhost:3008';
const NOTIF_URL   = import.meta.env.VITE_NOTIF_SERVICE_URL   || 'http://localhost:3010';
const ANALYTICS_URL = import.meta.env.VITE_ANALYTICS_URL     || 'http://localhost:3011';
const ADMIN_URL   = import.meta.env.VITE_ADMIN_SERVICE_URL   || 'http://localhost:3012';
const ROLES_URL   = import.meta.env.VITE_ROLES_SERVICE_URL   || 'http://localhost:3013';
const SEARCH_URL  = import.meta.env.VITE_SEARCH_SERVICE_URL  || 'http://localhost:3017';
const REPORT_URL  = import.meta.env.VITE_REPORT_SERVICE_URL  || 'http://localhost:3018';

// Token store
let _accessToken: string | null = null;
let _refreshToken: string | null = null;

export const tokenStore = {
  set(access: string, refresh: string) {
    _accessToken = access;
    _refreshToken = refresh;
    localStorage.setItem('iku_rt', refresh); // persist refresh token
  },
  getAccess: () => _accessToken,
  getRefresh: () => _refreshToken || localStorage.getItem('iku_rt'),
  clear() {
    _accessToken = null;
    _refreshToken = null;
    localStorage.removeItem('iku_rt');
  },
};

function makeClient(baseURL: string): AxiosInstance {
  const client = axios.create({ baseURL });

  client.interceptors.request.use((config) => {
    if (_accessToken) {
      config.headers.Authorization = `Bearer ${_accessToken}`;
    }
    return config;
  });

  client.interceptors.response.use(
    (res) => res,
    async (err) => {
      const original = err.config;
      if (err.response?.status === 401 && !original._retry) {
        original._retry = true;
        const refresh = tokenStore.getRefresh();
        if (refresh) {
          try {
            const { data } = await axios.post(`${AUTH_URL}/api/v1/auth/refresh`, { refreshToken: refresh });
            tokenStore.set(data.accessToken, refresh);
            original.headers.Authorization = `Bearer ${data.accessToken}`;
            return client(original);
          } catch {
            tokenStore.clear();
            window.location.href = '/login';
          }
        }
      }
      return Promise.reject(err);
    }
  );

  return client;
}

const auth     = makeClient(AUTH_URL);
const users    = makeClient(USER_URL);
const scoring  = makeClient(SCORE_URL);
const bank     = makeClient(BANK_URL);
const ventures = makeClient(VENTURE_URL);
const scout    = makeClient(SCOUT_URL);
const billing_client = makeClient(BILLING_URL);
const billing  = billing_client; // alias kept for backward compat
const notif    = makeClient(NOTIF_URL);
const analytics = makeClient(ANALYTICS_URL);
const admin    = makeClient(ADMIN_URL);
const roles    = makeClient(ROLES_URL);
const search   = makeClient(SEARCH_URL);
const reports  = makeClient(REPORT_URL);

// ── Types ─────────────────────────────────────────────────
export type Role = 'founder' | 'investor' | 'provider' | 'lender' | 'university' | 'super_admin';
export type Tier = 'EARLY' | 'RISING' | 'INVESTABLE' | 'ELITE';

export interface User {
  id: string; email: string; name: string; role: Role;
  status: string; avatarUrl?: string; onboardingCompleted: boolean;
}

export interface Score {
  totalScore: number; tier: Tier; tierLabel: string;
  confidencePct: number; scoredAt: string;
  categories: { category: string; score: number; maxPossible: number; pct: number }[];
  nextTier?: { tier: string; pointsNeeded: number };
}

// ── Auth API ─────────────────────────────────────────────
export const authApi = {
  requestOtp: (email: string, role: Role, name?: string) =>
    auth.post('/api/v1/auth/otp/request', { email, role, name }).then(r => r.data),

  verifyOtp: (email: string, code: string, role: Role) =>
    auth.post('/api/v1/auth/otp/verify', { email, code, role }).then(r => {
      const { accessToken, refreshToken, user } = r.data;
      tokenStore.set(accessToken, refreshToken);
      return { accessToken, refreshToken, user };
    }),

  me: () => auth.get('/api/v1/auth/me').then(r => r.data),
  logout: () => auth.post('/api/v1/auth/logout').then(r => { tokenStore.clear(); return r.data; }),
  sessions: () => auth.get('/api/v1/auth/sessions').then(r => r.data),
};

// ── User API ─────────────────────────────────────────────
export const userApi = {
  get: (id: string) => users.get(`/api/v1/users/${id}`).then(r => r.data),
  update: (id: string, data: Partial<User>) => users.put(`/api/v1/users/${id}`, data).then(r => r.data),
  uploadAvatar: (id: string, file: File) => {
    const form = new FormData(); form.append('avatar', file);
    return users.post(`/api/v1/users/${id}/avatar`, form, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data);
  },
  notifications: (id: string, unreadOnly = false) =>
    users.get(`/api/v1/users/${id}/notifications`, { params: { unread: unreadOnly } }).then(r => r.data),
  markRead: (id: string, nid: string) => users.put(`/api/v1/users/${id}/notifications/${nid}`).then(r => r.data),
  markAllRead: (id: string) => users.put(`/api/v1/users/${id}/notifications/read-all`).then(r => r.data),
  consents: (id: string) => users.get(`/api/v1/users/${id}/consents`).then(r => r.data),
  grantConsent: (id: string, type: string) =>
    users.post(`/api/v1/users/${id}/consents`, { consent_type: type, version: '1.0' }).then(r => r.data),
  revokeConsent: (id: string, type: string) =>
    users.delete(`/api/v1/users/${id}/consents/${type}`).then(r => r.data),
  exportData: (id: string) => users.get(`/api/v1/users/${id}/export`).then(r => r.data),
};

// ── Venture API ──────────────────────────────────────────
export const ventureApi = {
  create: (data: Record<string, unknown>) => ventures.post('/api/v1/ventures', data).then(r => r.data),
  get: (id: string) => ventures.get(`/api/v1/ventures/${id}`).then(r => r.data),
  update: (id: string, data: Record<string, unknown>) => ventures.put(`/api/v1/ventures/${id}`, data).then(r => r.data),
  uploadDocument: (id: string, file: File, documentType: string) => {
    const form = new FormData(); form.append('document', file); form.append('document_type', documentType);
    return ventures.post(`/api/v1/ventures/${id}/documents`, form, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data);
  },
  documents: (id: string) => ventures.get(`/api/v1/ventures/${id}/documents`).then(r => r.data),
  connectSocial: (id: string, data: Record<string, unknown>) =>
    ventures.post(`/api/v1/ventures/${id}/social-connect`, data).then(r => r.data),
  timeline: (id: string) => ventures.get(`/api/v1/ventures/${id}/timeline`).then(r => r.data),
};

// ── Scoring API ──────────────────────────────────────────
export const scoringApi = {
  calculate: (ventureId: string) =>
    scoring.post(`/api/v1/scoring/calculate/${ventureId}`).then(r => r.data),
  getScore: (ventureId: string) =>
    scoring.get(`/api/v1/ventures/${ventureId}/score`).then(r => r.data as { hasScore: boolean; score: Score }),
  history: (ventureId: string) =>
    scoring.get(`/api/v1/ventures/${ventureId}/score/history`).then(r => r.data),
  nextActions: (ventureId: string) =>
    scoring.get(`/api/v1/ventures/${ventureId}/next-actions`).then(r => r.data),
  tiers: () => scoring.get('/api/v1/scoring/tiers').then(r => r.data),
  categories: () => scoring.get('/api/v1/scoring/categories').then(r => r.data),
};

// ── Scout API ────────────────────────────────────────────
export const scoutApi = {
  scan: (ventureId: string) => scout.post(`/api/v1/scout/scan/${ventureId}`).then(r => r.data),
  status: (ventureId: string) => scout.get(`/api/v1/scout/scan/${ventureId}/status`).then(r => r.data),
  scanMaps: (ventureId: string) => scout.post(`/api/v1/scout/scan/${ventureId}/google-maps`).then(r => r.data),
  sources: () => scout.get('/api/v1/scout/sources').then(r => r.data),
};

// ── Billing API ──────────────────────────────────────────
export const billingApi = {
  plans: (role?: string) => billing.get('/api/v1/billing/plans', { params: { role } }).then(r => r.data),
  subscribe: (planId: string, billingCycle: 'monthly' | 'annual') =>
    billing.post('/api/v1/billing/subscriptions', { planId, billing: billingCycle }).then(r => r.data),
  subscription: () => billing.get('/api/v1/billing/subscriptions').then(r => r.data),
  cancel: () => billing.delete('/api/v1/billing/subscriptions').then(r => r.data),
  credits: () => billing.get('/api/v1/billing/credits').then(r => r.data),
  purchaseCredits: (packId: string) =>
    billing.post('/api/v1/billing/credits/purchase', { packId }).then(r => r.data),
  invoices: () => billing.get('/api/v1/billing/invoices').then(r => r.data),
  usage: () => billing.get('/api/v1/billing/usage').then(r => r.data),
  createBooking: (providerId: string, listingId: string) =>
    billing.post('/api/v1/marketplace/bookings', { providerId, listingId }).then(r => r.data),
  bookings: () => billing.get('/api/v1/marketplace/bookings').then(r => r.data),
};

// ── Bankability API ──────────────────────────────────────
export const bankabilityApi = {
  calculate: (ventureId: string) => bank.post(`/api/v1/bankability/calculate/${ventureId}`).then(r => r.data),
  get: (ventureId: string) => bank.get(`/api/v1/bankability/${ventureId}`).then(r => r.data),
  history: (ventureId: string) => bank.get(`/api/v1/bankability/${ventureId}/history`).then(r => r.data),
};

// ── Notifications API ────────────────────────────────────
export const notifApi = {
  list: (page = 1) => notif.get('/api/v1/notifications', { params: { page } }).then(r => r.data),
  markRead: (id: string) => notif.put(`/api/v1/notifications/${id}/read`).then(r => r.data),
  registerDevice: (token: string, platform: 'web' | 'ios' | 'android') =>
    notif.post('/api/v1/notifications/register-device', { token, platform }).then(r => r.data),
};

// ── Analytics API (used by Golden Eye + role dashboards) ─
export const analyticsApi = {
  track: (eventType: string, data?: Record<string, unknown>) =>
    analytics.post('/api/v1/analytics/track', { eventType, eventData: data }).catch(() => {}),
  realtimeUsers: () => analytics.get('/api/v1/analytics/realtime/active-users').then(r => r.data),
  realtimeRevenue: () => analytics.get('/api/v1/analytics/realtime/revenue').then(r => r.data),
  realtimeSignups: () => analytics.get('/api/v1/analytics/realtime/signups').then(r => r.data),
  usersOverview: () => analytics.get('/api/v1/analytics/users/overview').then(r => r.data),
  usersGrowth: (from?: string, to?: string) =>
    analytics.get('/api/v1/analytics/users/growth', { params: { from, to } }).then(r => r.data),
  retention: () => analytics.get('/api/v1/analytics/users/retention').then(r => r.data),
  scoreDistribution: () => analytics.get('/api/v1/analytics/scoring/distribution').then(r => r.data),
  biasAudit: () => analytics.get('/api/v1/analytics/scoring/bias-audit').then(r => r.data),
  revenueOverview: () => analytics.get('/api/v1/analytics/revenue/overview').then(r => r.data),
  revenueForecast: (months = 6) =>
    analytics.get('/api/v1/analytics/revenue/forecast', { params: { months } }).then(r => r.data),
  onboardingFunnel: (role?: string) =>
    analytics.get('/api/v1/analytics/funnels/onboarding', { params: { role } }).then(r => r.data),
};

// ── Investor API ─────────────────────────────────────────
export const investorApi = {
  updateProfile: (data: Record<string, unknown>) => roles.post('/api/v1/investors/profile', data).then(r => r.data),
  updateThesis: (data: Record<string, unknown>) => roles.post('/api/v1/investors/thesis', data).then(r => r.data),
  matches: () => roles.get('/api/v1/investors/matches').then(r => r.data),
  introduce: (matchId: string) => roles.post(`/api/v1/investors/matches/${matchId}/introduce`).then(r => r.data),
  dealRooms: () => roles.get('/api/v1/investors/deal-rooms').then(r => r.data),
  createDealRoom: (name: string) => roles.post('/api/v1/investors/deal-rooms', { name }).then(r => r.data),
  addToRoom: (roomId: string, ventureId: string) =>
    roles.post(`/api/v1/investors/deal-rooms/${roomId}/founders`, { ventureId }).then(r => r.data),
};

// ── Provider API ─────────────────────────────────────────
export const providerApi = {
  updateProfile: (data: Record<string, unknown>) => roles.post('/api/v1/providers/profile', data).then(r => r.data),
  matches: () => roles.get('/api/v1/providers/matches').then(r => r.data),
  connect: (matchId: string) => roles.post(`/api/v1/providers/matches/${matchId}/connect`).then(r => r.data),
};

// ── Lender API ───────────────────────────────────────────
export const lenderApi = {
  updateProfile: (data: Record<string, unknown>) => roles.post('/api/v1/lenders/profile', data).then(r => r.data),
  borrowerPool: () => roles.get('/api/v1/lenders/pool').then(r => r.data),
  alerts: () => roles.get('/api/v1/lenders/alerts').then(r => r.data),
  acknowledgeAlert: (id: string) => roles.put(`/api/v1/lenders/alerts/${id}`).then(r => r.data),
  addToPortfolio: (ventureId: string) =>
    roles.post('/api/v1/lenders/portfolio', { ventureId }).then(r => r.data),
};

// ── University API ───────────────────────────────────────
export const universityApi = {
  updateProfile: (data: Record<string, unknown>) => roles.post('/api/v1/universities/profile', data).then(r => r.data),
  founders: () => roles.get('/api/v1/universities/founders').then(r => r.data),
  rankings: () => roles.get('/api/v1/universities/rankings').then(r => r.data),
};

// ── Admin API ────────────────────────────────────────────
export const adminApi = {
  dashboard: () => admin.get('/api/v1/admin/dashboard').then(r => r.data),
  users: (params?: Record<string, unknown>) => admin.get('/api/v1/admin/users', { params }).then(r => r.data),
  user: (id: string) => admin.get(`/api/v1/admin/users/${id}`).then(r => r.data),
  updateUser: (id: string, data: Record<string, unknown>) =>
    admin.put(`/api/v1/admin/users/${id}`, data).then(r => r.data),
  suspendUser: (id: string, reason: string) =>
    admin.post(`/api/v1/admin/users/${id}/suspend`, { reason }).then(r => r.data),
  ventures: (params?: Record<string, unknown>) => admin.get('/api/v1/admin/ventures', { params }).then(r => r.data),
  verificationQueue: () => admin.get('/api/v1/admin/ventures/verification-queue').then(r => r.data),
  approveDocument: (ventureId: string, docId: string, tier: number) =>
    admin.post(`/api/v1/admin/ventures/${ventureId}/documents/${docId}/approve`, { verificationTier: tier }).then(r => r.data),
  rejectDocument: (ventureId: string, docId: string, reason: string) =>
    admin.post(`/api/v1/admin/ventures/${ventureId}/documents/${docId}/reject`, { reason }).then(r => r.data),
  scoringRules: () => admin.get('/api/v1/admin/scoring/rules').then(r => r.data),
  updateRule: (id: string, data: Record<string, unknown>) =>
    admin.put(`/api/v1/admin/scoring/rules/${id}`, data).then(r => r.data),
  simulateRule: (data: Record<string, unknown>) =>
    admin.post('/api/v1/admin/scoring/simulate', data).then(r => r.data),
  config: () => admin.get('/api/v1/admin/config').then(r => r.data),
  updateConfig: (key: string, value: unknown) =>
    admin.put(`/api/v1/admin/config/${key}`, { value }).then(r => r.data),
  featureFlags: () => admin.get('/api/v1/admin/feature-flags').then(r => r.data),
  toggleFlag: (key: string, enabled: boolean) =>
    admin.put(`/api/v1/admin/feature-flags/${key}`, { enabled }).then(r => r.data),
  gdprRequests: () => admin.get('/api/v1/admin/compliance/gdpr-requests').then(r => r.data),
  auditLog: (params?: Record<string, unknown>) =>
    admin.get('/api/v1/admin/compliance/audit-log', { params }).then(r => r.data),
  revenueStreams: () => admin.get('/api/v1/admin/revenue/streams').then(r => r.data),
  acxmSignals: (params?: Record<string, unknown>) =>
    admin.get('/api/v1/admin/acxm/signals', { params }).then(r => r.data),
  acxmEscalations: () => admin.get('/api/v1/admin/acxm/escalations').then(r => r.data),
  resolveEscalation: (id: string, notes: string, execute: boolean) =>
    admin.put(`/api/v1/admin/acxm/escalations/${id}`, { resolution_notes: notes, execute_action: execute }).then(r => r.data),
  broadcast: (data: Record<string, unknown>) =>
    admin.post('/api/v1/admin/notifications/broadcast', data).then(r => r.data),
  recalculateScore: (userId: string) =>
    admin.post(`/api/v1/admin/users/${userId}/recalculate-score`).then(r => r.data),
};


// ── Search API ───────────────────────────────────────────
export const searchApi = {
  ventures:    (params: Record<string, string>) => search.get('/api/v1/search/ventures',  { params }).then(r => r.data),
  providers:   (params: Record<string, string>) => search.get('/api/v1/search/providers', { params }).then(r => r.data),
  founders:    (params: Record<string, string>) => search.get('/api/v1/search/founders',  { params }).then(r => r.data),
  global:      (q: string) => search.get('/api/v1/search/global',      { params: { q } }).then(r => r.data),
  suggestions: (q: string, type?: string) => search.get('/api/v1/search/suggestions', { params: { q, type } }).then(r => r.data),
  buildIndexes: () => search.post('/api/v1/search/admin/build-indexes').then(r => r.data),
};

// ── Report API ───────────────────────────────────────────
export const reportApi = {
  available:       () => reports.get('/api/v1/reports/available').then(r => r.data),
  founderScore:    (ventureId: string) => reports.post(`/api/v1/reports/founder-score/${ventureId}`, {}, { responseType: 'blob' }).then(r => r.data),
  lenderPortfolio: () => reports.post('/api/v1/reports/lender-portfolio', {}, { responseType: 'blob' }).then(r => r.data),
};

// ── Connect API (Stripe Connect for providers) ───────────
export const connectApi = {
  onboard:    () => billing.post('/api/v1/billing/connect/onboard').then(r => r.data),
  status:     () => billing.get('/api/v1/billing/connect/status').then(r => r.data),
  disconnect: () => billing.delete('/api/v1/billing/connect/disconnect').then(r => r.data),
};

// ── Paystack API (African subscriptions) ─────────────────
export const paystackApi = {
  initialize: (planId: string, billing: 'monthly' | 'annual', currency: string) =>
    billing_client.post('/api/v1/billing/paystack/initialize', { planId, billing, currency }).then(r => r.data),
  verify: (reference: string) =>
    billing_client.get(`/api/v1/billing/paystack/verify/${reference}`).then(r => r.data),
  cancel: () => billing_client.post('/api/v1/billing/paystack/cancel').then(r => r.data),
};

export default {
  auth: authApi, user: userApi, venture: ventureApi, scoring: scoringApi,
  scout: scoutApi, billing: billingApi, bankability: bankabilityApi,
  notifications: notifApi, analytics: analyticsApi,
  investor: investorApi, provider: providerApi, lender: lenderApi,
  university: universityApi, admin: adminApi,
  search: searchApi, report: reportApi, connect: connectApi, paystack: paystackApi,
};
