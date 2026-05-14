// PR Sprint 7.19 Round 1 — Sentry browser-runtime init.
//
// Next.js 15 picks this file up automatically (it's the
// canonical name in the @sentry/nextjs SDK guide, replacing the
// older sentry.client.config.ts pattern). Loaded once per page
// boot inside the browser.
//
// DSN-optional: if NEXT_PUBLIC_SENTRY_DSN is unset, Sentry.init
// logs one warning and no-ops. Safe to land before the founder
// pastes the DSN.

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // Tracing — 100% in dev for visibility, 10% in prod to keep
    // free-tier quota healthy. Bump production rate when
    // investigating a specific latency issue.
    tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
    // Session Replay — 10% of all sessions get recorded, plus
    // 100% of sessions that hit an error. Replays are gold for
    // debugging UI bugs; first 500/mo are free tier.
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    // Structured logging integration. Browser-side logger.error
    // / warn calls show up alongside exceptions in Sentry.
    enableLogs: true,
    // PII trade-off: Helm is a founder-facing tool. Knowing
    // WHICH user hit a bug is critical for triage, and the data
    // surface (IP, cookies, auth headers) is acceptable for an
    // operator-only product. Brand-bible contents and post
    // bodies are NOT included by this flag — Sentry only sends
    // what we pass via withScope, plus standard request context.
    sendDefaultPii: true,
    integrations: [Sentry.replayIntegration()],
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? 'development',
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
  });
}

// App Router uses soft navigation. This export tells Next.js
// to call Sentry on every router transition so traces span
// across client-side navigation, not just full page loads.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
