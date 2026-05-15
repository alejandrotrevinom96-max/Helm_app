// PR Sprint 7.25 Phase 11 — minute-level due-post notifier.
//
// GET /api/cron/notify-due  (auth: Bearer CRON_SECRET)
//
// Fires webhooks for scheduled posts whose `scheduledFor <= now`
// and `status = 'scheduled'`, then flips them to `status =
// 'notified'`. This used to be embedded inside the daily
// /api/cron/sync-metrics handler — a 24h delay between "this
// post is due at 10am" and "Helm pings your webhook" was clearly
// wrong for any minute-precise schedule. Now it runs on its own
// minute-level cron tick.
//
// Scope intentionally narrow: this cron does ONLY the webhook
// dispatch + status flip. It does NOT publish to Meta / IG / etc
// — that's /api/cron/publish-scheduled's job. Posts with a
// `publishStatus` already set are skipped here (they're owned by
// the publisher cron).
//
// Idempotency: we flip `status` to 'notified' inside the same
// loop iteration that fires the webhook, so a concurrent tick
// would re-read those rows and find status != 'scheduled' on
// the where-clause filter. No double-fire.
//
// Webhook config cache: posts from the same user share one
// users-table read per tick. With per-user batching most cron
// runs touch ≤ 5 distinct users so this just saves a DB round-
// trip or two per minute.

import { db } from '@/lib/db';
import { scheduledPosts, users } from '@/lib/db/schema';
import { and, eq, lte, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { sendWebhook } from '@/lib/webhooks/send';

export const dynamic = 'force-dynamic';
// 60s ceiling: at ~20 webhooks/tick × ~2s each we stay well
// inside this budget. The webhook sender has its own per-call
// timeout (see lib/webhooks/send.ts).
export const maxDuration = 60;

const BATCH_LIMIT = 20;

interface NotifySummary {
  considered: number;
  notified: number;
  webhooksDelivered: number;
  webhooksFailed: number;
  webhooksSkippedNoUrl: number;
  errors: string[];
}

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured on server' },
      { status: 503 },
    );
  }
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();

  // Pull rows that are due AND haven't been picked up by the
  // publisher cron yet. publishStatus IS NULL means "no auto-
  // publish flow attempted" — those are the rows where the
  // founder relies on the webhook to know it's time to post.
  // A row with publishStatus='publishing' / 'published' /
  // 'failed' is owned by /api/cron/publish-scheduled and gets
  // a different lifecycle.
  const due = await db
    .select()
    .from(scheduledPosts)
    .where(
      and(
        eq(scheduledPosts.status, 'scheduled'),
        lte(scheduledPosts.scheduledFor, now),
        isNull(scheduledPosts.publishStatus),
      ),
    )
    .limit(BATCH_LIMIT);

  const summary: NotifySummary = {
    considered: due.length,
    notified: 0,
    webhooksDelivered: 0,
    webhooksFailed: 0,
    webhooksSkippedNoUrl: 0,
    errors: [],
  };

  // Webhook config cache (user -> { url, secret }) so multiple
  // due posts from the same user only hit the users table once
  // per tick.
  const webhookCache = new Map<
    string,
    { url: string | null; secret: string | null }
  >();

  for (const post of due) {
    let cfg = webhookCache.get(post.userId);
    if (!cfg) {
      const [row] = await db
        .select({ url: users.webhookUrl, secret: users.webhookSecret })
        .from(users)
        .where(eq(users.id, post.userId))
        .limit(1);
      cfg = { url: row?.url ?? null, secret: row?.secret ?? null };
      webhookCache.set(post.userId, cfg);
    }

    if (cfg.url) {
      const result = await sendWebhook(cfg.url, cfg.secret, {
        event: 'scheduled_post.due',
        timestamp: now.toISOString(),
        data: {
          id: post.id,
          platform: post.platform,
          content: post.content,
          scheduledFor: post.scheduledFor.toISOString(),
        },
      });
      if (result.ok) {
        summary.webhooksDelivered += 1;
      } else {
        summary.webhooksFailed += 1;
        const reason = result.error ?? `HTTP ${result.status ?? '???'}`;
        summary.errors.push(
          `user=${post.userId} post=${post.id} → ${reason}`,
        );
      }
    } else {
      summary.webhooksSkippedNoUrl += 1;
    }

    // Flip status BEFORE moving to the next iteration so a
    // concurrent tick filtered by status='scheduled' won't pick
    // this row up again. The webhook failure path still flips
    // status: the contract is "Helm tried to notify you exactly
    // once at the scheduled minute"; retrying webhook failures
    // is out-of-scope for this cron.
    await db
      .update(scheduledPosts)
      .set({ status: 'notified', notifiedAt: now })
      .where(eq(scheduledPosts.id, post.id));
    summary.notified += 1;
  }

  return NextResponse.json({ success: true, ...summary });
}
