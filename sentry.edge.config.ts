// PR Sprint 7.19 Round 1 — Sentry edge-runtime init.
//
// Loaded by instrumentation.ts → register() when the Next.js
// runtime is "edge" (middleware.ts + any route exporting
// `export const runtime = 'edge'`). Matches the canonical
// @sentry/nextjs SDK guide.

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
    // Logs from middleware go through Sentry too. No
    // sendDefaultPii here — middleware doesn't have a stable
    // user identity yet; we set it via withScope at call sites.
    enableLogs: true,
    environment: process.env.VERCEL_ENV ?? 'development',
    release: process.env.VERCEL_GIT_COMMIT_SHA,
  });
}
