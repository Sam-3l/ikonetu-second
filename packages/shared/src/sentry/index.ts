// ════════════════════════════════════════════════════════════
// SENTRY INITIALISATION
// Add to the top of every service's index.ts (backend)
// and to frontend/src/main.tsx (frontend)
//
// Backend usage (add to each service before app.use lines):
//   import { initSentry, sentryErrorHandler } from '@ikonetu/shared/sentry';
//   initSentry('auth-service');
//   // ... all your middleware and routes ...
//   app.use(sentryErrorHandler()); // LAST middleware
//
// Frontend usage (add to frontend/src/main.tsx, before createRoot):
//   import { initSentryFrontend } from './sentry';
//   initSentryFrontend();
// ════════════════════════════════════════════════════════════

import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import type { Express, Request, Response, NextFunction } from 'express';

const SENTRY_DSN = process.env.SENTRY_DSN; // add to .env

// ── Backend init ─────────────────────────────────────────────
export function initSentry(serviceName: string): void {
  if (!SENTRY_DSN) {
    console.log(`[Sentry] DSN not configured for ${serviceName} — skipping`);
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    environment:    process.env.NODE_ENV || 'development',
    release:        process.env.GIT_SHA  || 'unknown',
    serverName:     serviceName,
    integrations:   [nodeProfilingIntegration()],
    tracesSampleRate:   process.env.NODE_ENV === 'production' ? 0.1  : 1.0,
    profilesSampleRate: process.env.NODE_ENV === 'production' ? 0.05 : 0.5,

    beforeSend(event, hint) {
      // Scrub sensitive fields before sending to Sentry
      if (event.request?.headers) {
        delete event.request.headers['authorization'];
        delete event.request.headers['cookie'];
        delete event.request.headers['x-api-key'];
      }
      // Never send OTP values or JWT tokens
      if (event.extra) {
        const scrubbed = JSON.stringify(event.extra)
          .replace(/"(otp|code|token|password|key|secret)"\s*:\s*"[^"]+"/gi, '"$1":"[SCRUBBED]"');
        event.extra = JSON.parse(scrubbed);
      }
      return event;
    },
  });

  console.log(`[Sentry] Initialised for ${serviceName} (${process.env.NODE_ENV})`);
}

// ── Express error handler ─────────────────────────────────────
export function sentryErrorHandler() {
  return Sentry.expressErrorHandler();
}

// ── Manual capture ────────────────────────────────────────────
export function captureException(err: Error, context?: Record<string, unknown>): void {
  if (!SENTRY_DSN) return;
  Sentry.withScope(scope => {
    if (context) scope.setExtras(context);
    Sentry.captureException(err);
  });
}

export function captureMessage(message: string, level: Sentry.SeverityLevel = 'info'): void {
  if (!SENTRY_DSN) return;
  Sentry.captureMessage(message, level);
}

// ── Set user context (call after JWT verify) ─────────────────
export function setSentryUser(userId: string, role: string): void {
  if (!SENTRY_DSN) return;
  Sentry.setUser({ id: userId, role });
}

export function clearSentryUser(): void {
  if (!SENTRY_DSN) return;
  Sentry.setUser(null);
}
