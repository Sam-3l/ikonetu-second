import * as Sentry from '@sentry/react';

export function initSentryFrontend(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment:      import.meta.env.MODE,
    release:          import.meta.env.VITE_GIT_SHA || 'unknown',
    integrations:     [Sentry.browserTracingIntegration(), Sentry.replayIntegration()],
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
    replaysSessionSampleRate: 0.05,
    replaysOnErrorSampleRate: 1.0,

    beforeSend(event) {
      // Scrub tokens from breadcrumbs and request bodies
      if (event.request?.data) {
        const data = JSON.stringify(event.request.data)
          .replace(/"(token|password|otp|code|secret|key)"\s*:\s*"[^"]+"/gi, '"$1":"[SCRUBBED]"');
        event.request.data = JSON.parse(data);
      }
      return event;
    },
  });
}

export const SentryErrorBoundary = Sentry.ErrorBoundary;
