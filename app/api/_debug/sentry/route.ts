// PR Sprint 7.19 Round 1 — Sentry smoke-test endpoint.
//
// Lets the founder verify Sentry is wired end-to-end after
// setting NEXT_PUBLIC_SENTRY_DSN + SENTRY_AUTH_TOKEN.
//
// Behavior:
//   GET  /api/_debug/sentry         → 200 with current status
//   GET  /api/_debug/sentry?throw=1 → throws a known error
//                                     (lands in Sentry within ~30s)
//   GET  /api/_debug/sentry?log=1   → emits a structured warn
//                                     (lands in Sentry via the logger)
//
// Auth: admin only. We don't want a public "throw an error"
// endpoint, even though throwing is harmless — it would pollute
// Sentry's free-tier quota if scrapers found it.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAdmin } from '@/lib/config';
import { logger } from '@/lib/observability/logger';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isAdmin(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const url = new URL(request.url);
  const shouldThrow = url.searchParams.get('throw') === '1';
  const shouldLog = url.searchParams.get('log') === '1';

  if (shouldThrow) {
    // Will be captured by Sentry's onRequestError hook (set in
    // instrumentation.ts). Founder sees an event in the Sentry
    // dashboard within ~30s.
    throw new Error(
      `[sentry-debug] Intentional throw at ${new Date().toISOString()}`,
    );
  }

  if (shouldLog) {
    logger.warn('debug/sentry', 'Intentional warn from /api/_debug/sentry', {
      userId: user.id,
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json({
      ok: true,
      action: 'logged-warning',
      hint: 'Check Sentry dashboard for a warning event.',
    });
  }

  return NextResponse.json({
    ok: true,
    sentry: {
      dsnConfigured:
        !!process.env.NEXT_PUBLIC_SENTRY_DSN || !!process.env.SENTRY_DSN,
      authTokenConfigured: !!process.env.SENTRY_AUTH_TOKEN,
      environment:
        process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
      release: process.env.VERCEL_GIT_COMMIT_SHA ?? '(unset)',
    },
    usage: {
      throw: '/api/_debug/sentry?throw=1',
      log: '/api/_debug/sentry?log=1',
    },
  });
}
