// PR Sprint 7.19 follow-up (Round 1) — Next.js 15 instrumentation
// hook. Next discovers this file by name and runs `register()`
// once per runtime boot (Node.js for the API, Edge for the
// middleware). We forward to the right Sentry config file based
// on runtime, matching the @sentry/nextjs convention.
//
// onRequestError forwards unhandled server-side errors to
// Sentry — without this, App Router server components throw
// digest-only opaque exceptions that are nightmare to debug
// (the same kind that bit us on /admin overview earlier today).

import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
