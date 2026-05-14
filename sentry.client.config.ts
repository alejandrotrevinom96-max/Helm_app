// PR Sprint 7.19 follow-up (Round 1) — Sentry client-side init.
//
// Loaded automatically by @sentry/nextjs when the browser bundle
// boots. DSN is read from NEXT_PUBLIC_SENTRY_DSN — if missing or
// empty, Sentry SDK initializes in a "no-op" mode where calls
// like Sentry.captureException() succeed silently and nothing
// ships to a server. So the file is safe to land before the
// founder creates a Sentry project.
//
// To activate:
//   1. Create a free project at sentry.io
//   2. Add to .env.local and Vercel project env:
//        NEXT_PUBLIC_SENTRY_DSN=https://<key>@<org>.ingest.sentry.io/<project>
//   3. Redeploy. Errors start landing in Sentry immediately.

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // Performance — small sample so the free tier lasts. Bump
    // when you actually want to investigate slow pages.
    tracesSampleRate: 0.05,
    // Session replays — off by default. Costly in bundle size
    // and free-tier quota; flip on per-investigation.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    // Helm is a marketing tool with founder-level data; we don't
    // want PII bleeding into Sentry events. Off by default; flip
    // on if you ever need cookie/header context for a specific
    // bug hunt.
    sendDefaultPii: false,
    // Tag every event with the deploy environment so we can
    // filter dev/preview/prod inside Sentry.
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? 'development',
    // Useful when triaging crashes after a fresh deploy.
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
  });
}
