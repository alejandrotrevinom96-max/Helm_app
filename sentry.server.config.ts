// PR Sprint 7.19 Round 1 — Sentry Node.js-runtime init.
//
// Loaded by instrumentation.ts → register() when the Next.js
// API runtime is Node.js (default for App Router server
// components + /api routes). Matches the canonical
// @sentry/nextjs SDK guide.

import * as Sentry from '@sentry/nextjs';

// Prefer the private SENTRY_DSN if set (server-only secret),
// fall back to the public DSN so a single env var works too.
const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
    // PII trade-off: see instrumentation-client.ts. Same call.
    sendDefaultPii: true,
    // Capture local variable values at the point of exception.
    // The single best debugging upgrade Sentry offers — turns
    // "TypeError: Cannot read X of undefined" into "X.user was
    // undefined while X.userId='...' and X.endpoint='/foo'".
    includeLocalVariables: true,
    // Server-side logger.error / warn lines show up in Sentry
    // alongside exceptions.
    enableLogs: true,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
    release: process.env.VERCEL_GIT_COMMIT_SHA,
  });
}
