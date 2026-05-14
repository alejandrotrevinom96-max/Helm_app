// PR #29 — Sprint 5.1: Auto-posting Meta foundation.
//
// GET /api/cron/publish-scheduled (called every minute by Vercel Cron)
//
// Polls scheduled_posts for rows ready to publish:
//   - status='scheduled' AND scheduledFor <= now AND publishStatus IS NULL
//     → first attempt
//   - publishStatus='failed' AND publishNextRetryAt <= now AND
//     publishRetryCount < MAX_RETRIES
//     → retry attempt
//
// Processes up to 20 rows per tick in parallel chunks of 4 (same
// pattern as PR #28's image batch — keeps wall time inside the 60s
// Vercel ceiling without burning fal-style rate limits).
//
// Auth: requires `Authorization: Bearer <CRON_SECRET>`. Vercel Cron
// sends this header automatically when CRON_SECRET is set; manual
// callers (e.g. local debug) need to provide it. If CRON_SECRET is
// unset we 401 — never run unauthenticated in any environment.
import { db } from '@/lib/db';
import { scheduledPosts } from '@/lib/db/schema';
import { eq, and, lte, or, isNull, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import {
  publishPost,
  calculateNextRetry,
  MAX_RETRIES,
} from '@/lib/meta/publisher';
// PR Sprint 7.17 — every successful cron publish feeds the
// Voice Engine via the server-side hook. Fire-and-forget; an
// engine failure never blocks the cron pass.
import { recordPublishOnSuccess } from '@/lib/voice-engine/hooks';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const BATCH_LIMIT = 20;
const CHUNK_SIZE = 4;

export async function GET(request: Request) {
  // Auth gate. CRON_SECRET MUST be set; otherwise nothing publishes.
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
      or(
        and(
          eq(scheduledPosts.status, 'scheduled'),
          lte(scheduledPosts.scheduledFor, now),
          isNull(scheduledPosts.publishStatus)
        ),
        and(
          eq(scheduledPosts.publishStatus, 'failed'),
          lte(scheduledPosts.publishNextRetryAt, now),
          sql`${scheduledPosts.publishRetryCount} < ${MAX_RETRIES}`
        )
      )
    )
    .limit(BATCH_LIMIT);

  const results = {
    processed: 0,
    published: 0,
    // PR #30 — Sprint 5.2: track Stories separately. `published` stays
    // the count of regular feed posts; `publishedAsStory` increments
    // when a Story-flagged row makes it through. Easier to spot Story-
    // specific failure patterns in the cron response logs.
    publishedAsStory: 0,
    failed: 0,
    retrying: 0,
    skipped: 0,
    errors: [] as string[],
  };

  for (let i = 0; i < candidates.length; i += CHUNK_SIZE) {
    const chunk = candidates.slice(i, i + CHUNK_SIZE);
    await Promise.all(
      chunk.map(async (post) => {
        results.processed += 1;
        try {
          // Mark as publishing — claims the row so a concurrent tick
          // (rare but possible if cron drift overlaps) doesn't double-
          // publish. We don't use a real lock; the second tick will
          // just see publishStatus='publishing' and skip.
          await db
            .update(scheduledPosts)
            .set({ publishStatus: 'publishing' })
            .where(eq(scheduledPosts.id, post.id));

          const result = await publishPost(post.id);

          if (result.success) {
            // PR #32 — Sprint 5.3: Reels return success+pendingPolling
            // because we only created the container; /media_publish
            // still has to wait for processing. Don't mark this row
            // as 'published' yet — the publisher already set
            // publishStatus to 'publishing' and the polling cron will
            // flip it to 'published' once Meta says FINISHED.
            if (result.pendingPolling) {
              // Leave publishStatus='publishing' so this cron skips
              // the row on next tick (the WHERE clause excludes
              // 'publishing'). The poll-reels cron filters by
              // reelProcessingStatus='meta_processing' and will
              // flip publishStatus to 'published' or 'failed' once
              // Meta returns a terminal status_code. No-op here.
              results.retrying += 1;
              return;
            }
            await db
              .update(scheduledPosts)
              .set({
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
            // PR Sprint 7.17 — feed the Voice Engine. The post
            // row is already in scope from the outer SELECT, so
            // no refetch needed. qualityScore defaults to 0.8
            // for cron-driven publishes (implicit "worked"
            // without explicit founder feedback). If the
            // founder later rates the post worked/flopped, the
            // existing Sprint 7.14 Performance Memory loop
            // captures that separately.
            void recordPublishOnSuccess({
              userId: post.userId,
              projectId: post.projectId,
              platform: post.platform,
              contentType: post.contentType,
              postId: post.id,
              text: post.content,
              qualityScore: 0.8,
            }).catch(() => {
              /* already logged in hooks.ts */
            });
            // PR #30 — separate counter for Stories so the response
            // surfaces "X feed posts + Y stories" instead of one
            // amalgamated number.
            if (post.isStory) {
              results.publishedAsStory += 1;
            } else {
              results.published += 1;
            }
          } else {
            const newRetryCount = (post.publishRetryCount ?? 0) + 1;
            const shouldRetry =
              !!result.isTransient && newRetryCount < MAX_RETRIES;
            await db
              .update(scheduledPosts)
              .set({
                publishStatus: 'failed',
                publishFailureReason: result.error ?? 'Unknown error',
                publishRetryCount: newRetryCount,
                publishNextRetryAt: shouldRetry
                  ? calculateNextRetry(newRetryCount)
                  : null,
              })
              .where(eq(scheduledPosts.id, post.id));
            if (shouldRetry) {
              results.retrying += 1;
            } else {
              results.failed += 1;
              results.errors.push(
                `${post.id}: ${result.error ?? 'unknown'}`
              );
            }
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'unknown error';
          await db
            .update(scheduledPosts)
            .set({
              publishStatus: 'failed',
              publishFailureReason: msg,
              publishRetryCount: (post.publishRetryCount ?? 0) + 1,
            })
            .where(eq(scheduledPosts.id, post.id));
          results.failed += 1;
          results.errors.push(`${post.id}: ${msg}`);
        }
      })
    );
  }

  return NextResponse.json({
    success: true,
    timestamp: now.toISOString(),
    candidates: candidates.length,
    results,
  });
}
