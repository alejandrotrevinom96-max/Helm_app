// PR Sprint 7.19 follow-up (Round 1) — Sentry server-side init
// for the Node.js runtime (API routes + server components).
//
// Same DSN-optional pattern as the client config: missing
// SENTRY_DSN means no-op mode, safe to ship.

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.05,
    sendDefaultPii: false,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
    release: process.env.VERCEL_GIT_COMMIT_SHA,
  });
}
