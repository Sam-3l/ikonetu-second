import http from 'k6/http';
import { sleep, check, group } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// ════════════════════════════════════════════════════════════
// IKONETU LOAD TESTS — k6
// Run with: k6 run tests/load/platform.load.js
// Target: 500 concurrent users, p95 < 500ms
//
// Stages:
//   Ramp up:    0 → 100 VUs over 2 min
//   Sustain:    100 VUs for 5 min
//   Peak:       100 → 500 VUs over 2 min
//   Sustain peak: 500 VUs for 3 min
//   Ramp down:  500 → 0 over 2 min
// ════════════════════════════════════════════════════════════

const BASE = __ENV.BASE_URL || 'http://localhost:3001';
const SCORING_BASE = __ENV.SCORING_URL || 'http://localhost:3003';
const SEARCH_BASE  = __ENV.SEARCH_URL  || 'http://localhost:3017';

// Custom metrics
const authErrors     = new Counter('auth_errors');
const scoreErrors    = new Counter('score_errors');
const searchErrors   = new Counter('search_errors');
const otpRequestRate = new Rate('otp_request_success');
const scoreFetchTime = new Trend('score_fetch_duration');
const searchTime     = new Trend('search_duration');

export const options = {
  stages: [
    { duration: '2m', target: 100  }, // Ramp up
    { duration: '5m', target: 100  }, // Sustain
    { duration: '2m', target: 500  }, // Peak
    { duration: '3m', target: 500  }, // Sustain peak
    { duration: '2m', target: 0    }, // Ramp down
  ],
  thresholds: {
    // 95th percentile must be under 500ms for all critical endpoints
    'http_req_duration{endpoint:health}':        ['p(95)<200'],
    'http_req_duration{endpoint:otp_request}':   ['p(95)<500'],
    'http_req_duration{endpoint:score_fetch}':   ['p(95)<500'],
    'http_req_duration{endpoint:search}':        ['p(95)<400'],
    'http_req_duration{endpoint:tiers}':         ['p(95)<200'],
    // Error rates
    'http_req_failed':     ['rate<0.01'],   // <1% overall failure
    'otp_request_success': ['rate>0.99'],   // >99% OTP request success
    score_fetch_duration:  ['p(95)<500'],
    search_duration:       ['p(95)<400'],
  },
};

export default function () {
  group('Health checks', () => {
    const res = http.get(`${BASE}/health`, { tags: { endpoint: 'health' } });
    check(res, { 'auth health ok': r => r.status === 200 });

    const scoreHealth = http.get(`${SCORING_BASE}/health`, { tags: { endpoint: 'health' } });
    check(scoreHealth, { 'scoring health ok': r => r.status === 200 });
  });

  group('Auth — OTP request', () => {
    const email = `load-test-${__VU}-${Date.now()}@ikonetu-test.com`;
    const res = http.post(
      `${BASE}/api/v1/auth/otp/request`,
      JSON.stringify({ email, role: 'founder', name: 'Load Test User' }),
      { headers: { 'Content-Type': 'application/json' }, tags: { endpoint: 'otp_request' } }
    );

    const ok = check(res, {
      'OTP request 200':    r => r.status === 200,
      'OTP request has ok': r => JSON.parse(r.body as string).success === true,
    });

    otpRequestRate.add(ok);
    if (!ok) authErrors.add(1);
  });

  sleep(1);

  group('Scoring — tier config (cached)', () => {
    const start = Date.now();
    const res = http.get(
      `${SCORING_BASE}/api/v1/scoring/tiers`,
      { tags: { endpoint: 'tiers' } }
    );
    scoreFetchTime.add(Date.now() - start);

    check(res, {
      'Tiers 200':           r => r.status === 200,
      'Has 4 tiers':         r => JSON.parse(r.body as string).tiers?.length === 4,
    });
  });

  group('Scoring — categories', () => {
    const res = http.get(
      `${SCORING_BASE}/api/v1/scoring/categories`,
      { tags: { endpoint: 'tiers' } }
    );
    check(res, {
      'Categories 200':        r => r.status === 200,
      'Total is 1000':         r => JSON.parse(r.body as string).totalMaxPoints === 1000,
    });
  });

  group('Search — suggestions (autocomplete)', () => {
    const queries = ['fintech', 'agri', 'health', 'pay', 'nigeria'];
    const q = queries[Math.floor(Math.random() * queries.length)];
    const start = Date.now();
    const res = http.get(
      `${SEARCH_BASE}/api/v1/search/suggestions?q=${q}`,
      { tags: { endpoint: 'search' } }
    );
    searchTime.add(Date.now() - start);

    const ok = check(res, {
      'Suggestions 200': r => r.status === 200,
      'Has suggestions key': r => 'suggestions' in JSON.parse(r.body as string),
    });
    if (!ok) searchErrors.add(1);
  });

  group('Consent types (public endpoint)', () => {
    const res = http.get(
      'http://localhost:3004/api/v1/consents/types',
      { tags: { endpoint: 'tiers' } }
    );
    check(res, {
      'Consent types 200':    r => r.status === 200,
      'Has required types':   r => JSON.parse(r.body as string).types?.length >= 5,
    });
  });

  sleep(Math.random() * 2 + 1); // 1–3s think time
}

// ── Soak test config (separate run) ─────────────────────────
// k6 run --env SOAK=true tests/load/platform.load.js
export const soakOptions = __ENV.SOAK ? {
  stages: [
    { duration: '5m',  target: 100 }, // Ramp up
    { duration: '4h',  target: 100 }, // Soak for 4 hours
    { duration: '5m',  target: 0   }, // Ramp down
  ],
  thresholds: {
    'http_req_failed': ['rate<0.01'],
    'http_req_duration': ['p(95)<1000'], // relaxed for soak
  },
} : undefined;
