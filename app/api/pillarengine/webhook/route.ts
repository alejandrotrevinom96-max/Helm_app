// PR Sprint pillarengine — webhook ingest from PillarEngine.
//
// POST /api/pillarengine/webhook
//
// Receives page lifecycle events from pillarengine.vercel.app:
//   - 'page.test'     → connectivity check (returns 200, no work)
//   - 'page.approved' → upsert into blog_posts_external + revalidate
//                       the affected blog routes
//
// Every payload is HMAC-SHA256 signed with PILLARENGINE_WEBHOOK_SECRET
// over the raw body. We verify with a constant-time compare to
// neutralize timing oracles. An unsigned/mis-signed request returns
// 401 + no DB work.
//
// Idempotency: blog_posts_external.pillarengine_id is UNIQUE. A
// retried event for the same page upserts the existing row — no
// duplicates, no stale shadow data. The upsert refreshes the body +
// metadata + approved_at on every retry so PillarEngine edits land
// here immediately.
//
// Revalidation: after a successful upsert we call revalidatePath on
// the blog index AND on the specific /blog/[slug] route so the
// founder sees the new post without redeploying. Both calls are
// best-effort — if either path doesn't exist in the route tree (e.g.
// the page rendered with an old static manifest), the call no-ops
// rather than throwing.

import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import * as Sentry from '@sentry/nextjs';
import {
  upsertApprovedPage,
  type PillarengineApprovedPage,
} from '@/lib/pillarengine/ingest';

export const maxDuration = 30;
// Force-dynamic because we read the raw request body for HMAC
// verification (and Next.js otherwise tries to JSON-parse it,
// breaking the signature check).
export const dynamic = 'force-dynamic';

interface ApprovedPageEvent extends PillarengineApprovedPage {
  event: 'page.approved';
}

interface TestPayload {
  event: 'page.test';
  [key: string]: unknown;
}

type PillarenginePayload = ApprovedPageEvent | TestPayload;

export async function POST(request: Request) {
  const secret = process.env.PILLARENGINE_WEBHOOK_SECRET;
  if (!secret) {
    Sentry.captureMessage('pillarengine_webhook_secret_missing', {
      level: 'error',
      tags: { area: 'pillarengine', kind: 'env-misconfigured' },
    });
    return NextResponse.json(
      { error: 'Webhook secret not configured on server' },
      { status: 503 },
    );
  }

  // Read the raw body BEFORE any JSON parse — the HMAC is over
  // exact bytes including whitespace/key order, so a re-stringified
  // JSON would not match.
  let body = '';
  try {
    body = await request.text();
  } catch (err) {
    Sentry.captureException(err, {
      tags: { area: 'pillarengine', kind: 'body-read-failed' },
    });
    return NextResponse.json({ error: 'Body unreadable' }, { status: 400 });
  }

  const signature = request.headers.get('x-pillarengine-signature') ?? '';
  const expected =
    'sha256=' +
    createHmac('sha256', secret).update(body).digest('hex');

  // Pad signature buffer to match expected length so timingSafeEqual
  // doesn't throw on length mismatch (which would itself be a side
  // channel). We still compare lengths first and short-circuit on
  // mismatch — that's a length-leak, but length is fixed at
  // sha256= + 64 hex chars so it doesn't leak useful info.
  let sigBuf: Buffer;
  const expBuf = Buffer.from(expected);
  try {
    sigBuf = Buffer.from(signature.padEnd(expBuf.length).slice(0, expBuf.length));
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }
  if (
    sigBuf.length !== expBuf.length ||
    !timingSafeEqual(sigBuf, expBuf)
  ) {
    Sentry.captureMessage('pillarengine_webhook_bad_signature', {
      level: 'warning',
      tags: { area: 'pillarengine', kind: 'bad-signature' },
      extra: {
        sigHeaderLen: signature.length,
        bodyLen: body.length,
      },
    });
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: PillarenginePayload;
  try {
    payload = JSON.parse(body) as PillarenginePayload;
  } catch (err) {
    Sentry.captureException(err, {
      tags: { area: 'pillarengine', kind: 'invalid-json' },
      extra: { bodySnippet: body.slice(0, 800) },
    });
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!payload || typeof payload !== 'object' || !('event' in payload)) {
    return NextResponse.json({ error: 'Missing event field' }, { status: 400 });
  }

  if (payload.event === 'page.test') {
    Sentry.captureMessage('pillarengine_webhook_test_received', {
      level: 'info',
      tags: { area: 'pillarengine', kind: 'webhook-test' },
    });
    return NextResponse.json({
      ok: true,
      message: 'Webhook test received',
    });
  }

  if (payload.event === 'page.approved') {
    const result = await upsertApprovedPage(payload);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }
    Sentry.captureMessage('pillarengine_webhook_ingested', {
      level: 'info',
      tags: {
        area: 'pillarengine',
        kind: 'webhook-ingested',
        action: result.action,
      },
      extra: { slug: result.slug, pageId: payload.page_id },
    });
    return NextResponse.json({
      ok: true,
      slug: result.slug,
      action: result.action,
    });
  }

  // Unknown event — return 200 so PillarEngine doesn't retry, but
  // log so we know to handle the new event type if it becomes real.
  Sentry.captureMessage('pillarengine_webhook_unknown_event', {
    level: 'warning',
    tags: { area: 'pillarengine', kind: 'unknown-event' },
    extra: {
      event:
        typeof (payload as { event?: unknown }).event === 'string'
          ? ((payload as { event: string }).event)
          : 'unknown',
    },
  });
  return NextResponse.json({ ok: true, ignored: true });
}

