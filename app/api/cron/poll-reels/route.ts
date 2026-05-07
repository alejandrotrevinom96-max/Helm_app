// PR #32 — Sprint 5.3: Instagram Reels.
//
// GET /api/cron/poll-reels  (auth: Bearer CRON_SECRET)
//
// Polls IG Reel containers that are mid-processing on Meta's side.
// Picks up rows where:
//   - is_reel = true
//   - reel_processing_status = 'meta_processing'
//   - reel_polling_next_at <= now
//   - reel_polling_attempts < MAX_POLLING_ATTEMPTS
//
// For each row, calls publishReelAfterProcessing(). Results map
// 1:1 to lifecycle moves:
//   - success → publishStatus='published', status='posted',
//     reelProcessingStatus='ready', stamp metaPostId + permalink
//   - stillProcessing → bump attempts, schedule next poll
//     (exponential backoff capped at 5 min)
//   - hard error → publishStatus='failed',
//     reelProcessingStatus='error'
//   - max attempts hit → same as hard error, with explanatory msg
//
// Hobby plan limits crons to "once daily" — set the schedule in
// vercel.json accordingly. For real-time publishing the operator
// uses an external pinger (cron-job.org / GitHub Actions) — see
// MIGRATION_NOTES.md.
import { db } from '@/lib/db';
import { scheduledPosts } from '@/lib/db/schema';
import { eq, and, lte, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { publishReelAfterProcessing } from '@/lib/meta/publisher';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const BATCH_LIMIT = 10;
const MAX_POLLING_ATTEMPTS = 10;
// Exponential backoff: 60s, 90s, 135s, 200s, 300s (capped). After 10
// attempts that's ~30 min total — beyond that Meta has either failed
// or the container has expired (24h hard cap).
const BACKOFF_BASE_S = 60;
const BACKOFF_FACTOR = 1.5;
const BACKOFF_CAP_S = 300;

function nextBackoff(attempt: number): Date {
  const delay = Math.min(
    BACKOFF_BASE_S * Math.pow(BACKOFF_FACTOR, attempt),
    BACKOFF_CAP_S
  );
  return new Date(Date.now() + delay * 1000);
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured on server' },
      { status: 401 }
    );
  }
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();

  const candidates = await db
    .select()
    .from(scheduledPosts)
    .where(
      and(
        eq(scheduledPosts.isReel, true),
        eq(scheduledPosts.reelProcessingStatus, 'meta_processing'),
        lte(scheduledPosts.reelPollingNextAt, now),
        sql`${scheduledPosts.reelPollingAttempts} < ${MAX_POLLING_ATTEMPTS}`
      )
    )
    .limit(BATCH_LIMIT);

  const results = {
    polled: 0,
    published: 0,
    stillProcessing: 0,
    failed: 0,
    errors: [] as string[],
  };

  // Sequential — Reel publishing is per-account rate-limited and the
  // batch is tiny (≤10). Avoiding parallelism here removes a class
  // of race conditions where two ticks could publish the same row.
  for (const post of candidates) {
    results.polled += 1;
    try {
      const result = await publishReelAfterProcessing(post.id);

      if (result.success) {
        await db
          .update(scheduledPosts)
          .set({
            reelProcessingStatus: 'ready',
            publishStatus: 'published',
            status: 'posted',
            publishedAt: new Date(),
            postedAt: new Date(),
            metaPostId: result.metaPostId ?? null,
            metaPermalink: result.permalink ?? null,
            publishFailureReason: null,
            publishNextRetryAt: null,
          })
          .where(eq(scheduledPosts.id, post.id));
        results.published += 1;
        continue;
      }

      if (result.stillProcessing) {
        const newAttempts = (post.reelPollingAttempts ?? 0) + 1;
        if (newAttempts >= MAX_POLLING_ATTEMPTS) {
          await db
            .update(scheduledPosts)
            .set({
              reelProcessingStatus: 'error',
              reelProcessingError:
                'Meta processing took too long (max polling attempts reached).',
              reelPollingAttempts: newAttempts,
              publishStatus: 'failed',
              publishFailureReason:
                'Reel processing timed out after multiple polling attempts.',
            })
            .where(eq(scheduledPosts.id, post.id));
          results.failed += 1;
        } else {
          await db
            .update(scheduledPosts)
            .set({
              reelPollingAttempts: newAttempts,
              reelPollingNextAt: nextBackoff(newAttempts),
            })
            .where(eq(scheduledPosts.id, post.id));
          results.stillProcessing += 1;
        }
        continue;
      }

      // Hard failure (ERROR / EXPIRED / unsupported status / token).
      const reason = result.error ?? 'Unknown reel publish error';
      await db
        .update(scheduledPosts)
        .set({
          reelProcessingStatus: 'error',
          reelProcessingError: reason,
          publishStatus: 'failed',
          publishFailureReason: reason,
        })
        .where(eq(scheduledPosts.id, post.id));
      results.failed += 1;
      results.errors.push(`${post.id}: ${reason}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown error';
      // Safe-update fallback so a thrown error doesn't leave the row
      // in 'meta_processing' forever.
      await db
        .update(scheduledPosts)
        .set({
          reelProcessingStatus: 'error',
          reelProcessingError: msg,
          publishStatus: 'failed',
          publishFailureReason: msg,
        })
        .where(eq(scheduledPosts.id, post.id));
      results.failed += 1;
      results.errors.push(`${post.id}: ${msg}`);
    }
  }

  return NextResponse.json({
    success: true,
    timestamp: now.toISOString(),
    candidates: candidates.length,
    results,
  });
}
