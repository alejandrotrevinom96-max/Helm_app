import { db } from '@/lib/db';
import {
  waitlistPages,
  waitlistResponses,
  waitlistSignups,
} from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import {
  checkRateLimit,
  commitRateLimit,
  getClientIp,
} from '@/lib/landing/rate-limit';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// PR #39 Sprint 6.5: per-IP rate limit on the waitlist response
// endpoint. Pre-PR-39 the only protection was per-page IP-hash
// dedup, so an attacker rotating IPs across many pages could
// flood waitlist_responses unbounded. 30/hour per IP keeps
// genuine users (someone hitting a few pages they were emailed)
// comfortably above the cap while stopping scripted floods. We
// share the existing previewRateLimits table with a "wl:" prefix
// — different namespace, same Postgres infra.
const WAITLIST_RATE_LIMIT_PREFIX = 'wl:';
const WAITLIST_MAX_PER_HOUR = 30;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  // Rate limit BEFORE we touch the DB. Same shape as the public
  // preview endpoint — check is read-only; we commit only after
  // the work succeeds (so a 404-page-not-found doesn't burn a
  // legit user's cap).
  const ip = getClientIp(request);
  const limit = await checkRateLimit(ip, {
    keyPrefix: WAITLIST_RATE_LIMIT_PREFIX,
    maxPerWindow: WAITLIST_MAX_PER_HOUR,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: limit.reason ?? 'Rate limit exceeded',
        resetAt: limit.resetAt?.toISOString(),
      },
      { status: 429 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const { email, responses, template } = body as {
    email?: string;
    responses?: Record<string, unknown>;
    template?: string;
  };

  const [page] = await db
    .select()
    .from(waitlistPages)
    .where(eq(waitlistPages.slug, slug))
    .limit(1);
  if (!page || !page.isActive) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // The survey-5q template allows submitting without an email; everything
  // else requires it. Validate format if present.
  const emailRequired = template !== 'survey-5q';
  if (emailRequired && !email) {
    return NextResponse.json({ error: 'Email required' }, { status: 400 });
  }
  if (email && !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
  }

  // Hash IP+slug so the same person submitting twice on the same page is
  // detectable without storing raw IPs. (Note: the rate-limit IP hash
  // above uses the global ip+salt prefix; this dedup hash uses ip+slug
  // so the same IP gets one row per page. Different purposes, different
  // hashes.)
  const ipHash = createHash('sha256').update(ip + slug).digest('hex');

  // Dedup: if this IP already responded on this page, return the same
  // success shape as a fresh submit. Showing a different "you already
  // submitted" message would leak which pages an IP has interacted with.
  const [existing] = await db
    .select({ id: waitlistResponses.id })
    .from(waitlistResponses)
    .where(
      and(
        eq(waitlistResponses.waitlistPageId, page.id),
        eq(waitlistResponses.ipHash, ipHash)
      )
    )
    .limit(1);
  if (existing) {
    // Dedup hit. Still consume a rate-limit slot (a flood of dedup
    // hits from rotating slugs would otherwise be free).
    await commitRateLimit(ip, {
      keyPrefix: WAITLIST_RATE_LIMIT_PREFIX,
      maxPerWindow: WAITLIST_MAX_PER_HOUR,
    });
    return NextResponse.json({ ok: true });
  }

  // Commit a rate-limit slot — we're about to write to the DB.
  await commitRateLimit(ip, {
    keyPrefix: WAITLIST_RATE_LIMIT_PREFIX,
    maxPerWindow: WAITLIST_MAX_PER_HOUR,
  });

  await db.insert(waitlistResponses).values({
    waitlistPageId: page.id,
    email: email ?? null,
    responses: responses ?? {},
    ipHash,
    userAgent: request.headers.get('user-agent') ?? '',
    templateConfigSnapshot: page.templateConfig ?? null,
    templateVersion: page.templateVersion,
  });

  // Backward-compat: keep populating the legacy waitlistSignups table when
  // an email is present. waitlistSignups has no unique constraint on email
  // so we just insert; duplicates are tolerable for the Validate signup count.
  if (email) {
    try {
      await db.insert(waitlistSignups).values({
        waitlistPageId: page.id,
        email,
      });
    } catch (e) {
      // Non-fatal — the response itself is recorded.
      console.error('[RESPOND] legacy signup insert failed', e);
    }
  }

  return NextResponse.json({ ok: true });
}
