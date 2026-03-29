import CircuitBreaker from 'opossum';
import axios from 'axios';

// ════════════════════════════════════════════════════════════
// CIRCUIT BREAKER
// Prevents cascade failures when a downstream service crashes.
//
// States:
//   CLOSED  — requests pass through normally
//   OPEN    — requests immediately fail (no network call)
//   HALF-OPEN — one test request allowed through
//
// Thresholds (conservative defaults, tune per service):
//   errorThresholdPercentage: 50%  → opens after 50% failures
//   resetTimeout: 30s              → stays open for 30s then tries half-open
//   timeout: 10s                   → request counts as failure after 10s
//   volumeThreshold: 5             → minimum 5 requests before tripping
//
// Add to any service that calls another IkonetU service.
// Usage:
//   import { callService } from '@ikonetu/shared/circuit-breaker';
//   const score = await callService('scoring-service', () =>
//     axios.get(`${SCORING_URL}/api/v1/ventures/${id}/score`)
//   );
// ════════════════════════════════════════════════════════════

const BREAKERS = new Map<string, CircuitBreaker<[() => Promise<unknown>], unknown>>();

const DEFAULT_OPTIONS: CircuitBreaker.Options = {
  timeout:                  10_000,  // 10s per request
  errorThresholdPercentage: 50,      // open after 50% failures
  resetTimeout:             30_000,  // stay open 30s
  volumeThreshold:          5,       // need ≥5 requests before tripping
  rollingCountTimeout:      10_000,  // 10s rolling window
};

function getBreaker(serviceName: string): CircuitBreaker<[() => Promise<unknown>], unknown> {
  if (BREAKERS.has(serviceName)) return BREAKERS.get(serviceName)!;

  const breaker = new CircuitBreaker(
    async (fn: () => Promise<unknown>) => fn(),
    { ...DEFAULT_OPTIONS, name: serviceName }
  );

  breaker.on('open',     () => console.warn(`[CircuitBreaker] ${serviceName}: OPEN — failing fast`));
  breaker.on('halfOpen', () => console.log( `[CircuitBreaker] ${serviceName}: HALF-OPEN — testing`));
  breaker.on('close',    () => console.log( `[CircuitBreaker] ${serviceName}: CLOSED — recovered`));
  breaker.on('fallback', () => console.warn(`[CircuitBreaker] ${serviceName}: fallback triggered`));

  BREAKERS.set(serviceName, breaker);
  return breaker;
}

// ── Main call function ────────────────────────────────────────
export async function callService<T>(
  serviceName: string,
  fn: () => Promise<T>,
  fallback?: () => T | Promise<T>,
): Promise<T> {
  const breaker = getBreaker(serviceName);

  if (fallback) {
    breaker.fallback(fallback);
  }

  return breaker.fire(fn as () => Promise<unknown>) as Promise<T>;
}

// ── Pre-configured callers for each IkonetU service ──────────
import { env } from '@ikonetu/config';

export const scoringCall = <T>(fn: () => Promise<T>) =>
  callService('scoring-service', fn, () => ({ hasScore: false, error: 'scoring-service unavailable' }) as T);

export const scoutCall = <T>(fn: () => Promise<T>) =>
  callService('scout-service', fn, () => ({ status: 'unavailable', message: 'Scout service is temporarily unavailable' }) as T);

export const notifCall = <T>(fn: () => Promise<T>) =>
  callService('notification-service', fn, () => null as T); // silently fail — notifications are non-critical

export const analyticsCall = <T>(fn: () => Promise<T>) =>
  callService('analytics-service', fn, () => null as T); // silently fail — analytics are non-critical

export const billingCall = <T>(fn: () => Promise<T>) =>
  callService('billing-service', fn); // no fallback — billing failures must surface

// ── Health check aggregator ───────────────────────────────────
export async function getCircuitStatus(): Promise<Record<string, { state: string; stats: unknown }>> {
  const status: Record<string, { state: string; stats: unknown }> = {};

  for (const [name, breaker] of BREAKERS.entries()) {
    status[name] = {
      state: breaker.opened ? 'OPEN' : breaker.halfOpen ? 'HALF_OPEN' : 'CLOSED',
      stats: breaker.stats,
    };
  }

  return status;
}

// ── Inter-service HTTP client with circuit breaker ────────────
// Replace raw axios.get/post calls between services with this.

export async function serviceGet<T>(serviceName: string, url: string, options?: object): Promise<T> {
  return callService(serviceName, () => axios.get<T>(url, options).then(r => r.data));
}

export async function servicePost<T>(serviceName: string, url: string, data?: unknown, options?: object): Promise<T> {
  return callService(serviceName, () => axios.post<T>(url, data, options).then(r => r.data));
}
