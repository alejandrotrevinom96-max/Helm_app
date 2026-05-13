// PR #80 — Sprint 7.5.2: publish-now endpoint.
// PR #86 — Sprint 7.10 (Bug #3): two follow-ups against this route:
//
//   FIX 1: After publishPost succeeds, this route now UPDATEs
//          scheduledPosts with status='posted', publishStatus=
//          'published', publishedAt/postedAt, metaPostId,
//          metaPermalink — matching the cron's success path. Pre-
//          fix the row stayed at status='scheduled' (the Library
//          would show "Scheduled" forever even after Twitter
//          accepted the tweet).
//
//   FIX 3: ?fromScheduled=1 dispatches against an existing
//          scheduled_posts row instead of a draft. Lets the
//          founder click "Post now" on an already-scheduled row
//          to flip it to immediate publish.
//
// Before this commit there was no way to publish a draft
// IMMEDIATELY from the UI. The flow required scheduling a row in
// scheduled_posts and waiting for the cron at /api/cron/publish-
// scheduled to pick it up — which meant minutes of latency for
// what should be a 1-click action, and no observability into
// success/failure until the next cron pass.
//
// This route:
//   1. Pulls the draft from generated_posts (ownership-join), OR
//      pulls the scheduled_posts row directly when
//      ?fromScheduled=1.
//   2. (Draft path only) Inserts a scheduled_posts row with
//      scheduledFor=now + status='scheduled'. We reuse
//      scheduled_posts (not a separate "publish queue") so the
//      publishPost dispatcher, the Library, and the Calendar all
//      see the post the same way they see scheduled rows.
//   3. (Draft path only) Deletes the draft.
//   4. Calls publishPost(scheduledId) SYNCHRONOUSLY so the
//      caller gets the success/failure in the response.
//   5. On success, UPDATEs the scheduled row with the terminal
//      publishStatus + metaPostId + metaPermalink (FIX 1).
//
// On publish failure, the scheduled_posts row stays put with
// publishStatus='failed' — the founder can retry via the existing
// /api/marketing/library/[id]/retry-publish endpoint. No data
// loss.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  generatedPosts,
  scheduledPosts,
  projects,
} from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { publishPost } from '@/lib/meta/publisher';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  // PR #86 — Sprint 7.10 (FIX 3): ?fromScheduled=1 routes the call
  // against an existing scheduled_posts row.
  const url = new URL(request.url);
  const fromScheduled = url.searchParams.get('fromScheduled') === '1';

  // ------------------------------------------------------------
  // SCHEDULED PATH — already in scheduled_posts; just dispatch.
  // ------------------------------------------------------------
  if (fromScheduled) {
    const [existing] = await db
      .select()
      .from(scheduledPosts)
      .where(
        and(
          eq(scheduledPosts.id, id),
          eq(scheduledPosts.userId, user.id),
        ),
      )
      .limit(1);

    if (!existing) {
      return NextResponse.json(
        { error: 'Scheduled post not found or forbidden' },
        { status: 404 },
      );
    }

    if (existing.status !== 'scheduled') {
      return NextResponse.json(
        {
          error: `Cannot post now from status='${existing.status}'.`,
          errorKind: 'invalid_state',
        },
        { status: 409 },
      );
    }

    return await dispatchPublish(existing.id);
  }

  // ------------------------------------------------------------
  // DRAFT PATH — migrate generated_posts row to scheduled_posts.
  // ------------------------------------------------------------
  const [draft] = await db
    .select({
      id: generatedPosts.id,
      projectId: generatedPosts.projectId,
      platform: generatedPosts.platform,
      content: generatedPosts.content,
      isStory: generatedPosts.isStory,
      isReel: generatedPosts.isReel,
      videoUrl: generatedPosts.videoUrl,
      contentType: generatedPosts.contentType,
      structuredContent: generatedPosts.structuredContent,
      visualUrls: generatedPosts.visualUrls,
      // PR Sprint 7.13 (BUG 3) — copy singular image URL through.
      // Pre-fix the post-now path matched the schedule endpoint's
      // gap: imageUrl on the draft was dropped on the way to
      // scheduledPosts.visualUrl, so single-image post-nows lost
      // their visual immediately.
      imageUrl: generatedPosts.imageUrl,
      imagePrompt: generatedPosts.imagePrompt,
    })
    .from(generatedPosts)
    .innerJoin(projects, eq(projects.id, generatedPosts.projectId))
    .where(and(eq(generatedPosts.id, id), eq(projects.userId, user.id)))
    .limit(1);

  if (!draft) {
    return NextResponse.json(
      { error: 'Draft not found or forbidden' },
      { status: 404 },
    );
  }

  // Stories + Reels validation — same as the schedule endpoint.
  if (draft.isStory) {
    return NextResponse.json(
      {
        error:
          'This draft is flagged as a Story but has no image attached. Regenerate it with an image, then post now.',
        errorKind: 'missing_media',
      },
      { status: 400 },
    );
  }
  if (draft.isReel && !draft.videoUrl) {
    return NextResponse.json(
      {
        error:
          'This draft is flagged as a Reel but has no video uploaded. Re-upload or un-flag the draft, then post now.',
        errorKind: 'missing_media',
      },
      { status: 400 },
    );
  }

  const effectiveIsReel =
    draft.isReel ||
    (draft.contentType === 'reel' && Boolean(draft.videoUrl));

  const now = new Date();

  // Same insert shape as the schedule endpoint — preserves
  // visualUrls (PR #65 carousel slides), structuredContent (PR
  // #63 structured drafts), isStory/isReel/videoUrl flags. Status
  // starts as 'scheduled' (not 'publishing') so the publishPost
  // dispatcher sees a valid scheduled row.
  const [scheduled] = await db
    .insert(scheduledPosts)
    .values({
      projectId: draft.projectId,
      userId: user.id,
      platform: draft.platform,
      content: draft.content,
      scheduledFor: now,
      status: 'scheduled',
      isStory: draft.isStory,
      isReel: effectiveIsReel,
      videoUrl: draft.videoUrl ?? null,
      reelProcessingStatus: effectiveIsReel ? 'uploaded' : null,
      contentType: draft.contentType,
      structuredContent: draft.structuredContent ?? null,
      visualUrls: (draft.visualUrls as string[] | null) ?? null,
      // PR Sprint 7.13 (BUG 3) — carry singular image URL.
      visualUrl: draft.imageUrl ?? null,
      visualPrompt: draft.imagePrompt ?? null,
    })
    .returning();

  // Best-effort draft cleanup. If this fails the founder ends up
  // with the same row in BOTH tables — surfaceable, not data loss.
  await db.delete(generatedPosts).where(eq(generatedPosts.id, id));

  return await dispatchPublish(scheduled.id);
}

// ------------------------------------------------------------
// Shared dispatch — runs publishPost + writes back terminal
// state. Extracted so the draft path and the scheduled-row path
// converge on identical success/failure handling.
// ------------------------------------------------------------
async function dispatchPublish(scheduledId: string): Promise<Response> {
  // Mark publishing so a concurrent click (rare but possible)
  // doesn't double-fire.
  await db
    .update(scheduledPosts)
    .set({ publishStatus: 'publishing' })
    .where(eq(scheduledPosts.id, scheduledId));

  let publishResult;
  try {
    publishResult = await publishPost(scheduledId);
  } catch (err) {
    console.error('[publish-now] publishPost threw:', err);
    const msg = err instanceof Error ? err.message : 'Publish failed';
    await db
      .update(scheduledPosts)
      .set({
        publishStatus: 'failed',
        publishFailureReason: msg.slice(0, 500),
      })
      .where(eq(scheduledPosts.id, scheduledId));
    return NextResponse.json(
      {
        success: false,
        error: msg,
        errorKind: 'unknown',
        scheduledPostId: scheduledId,
        hint: 'Your row stayed in scheduled_posts with status=failed. Retry from Library.',
      },
      { status: 500 },
    );
  }

  if (!publishResult.success) {
    await db
      .update(scheduledPosts)
      .set({
        publishStatus: 'failed',
        publishFailureReason: (publishResult.error ?? 'Unknown error').slice(
          0,
          500,
        ),
      })
      .where(eq(scheduledPosts.id, scheduledId));
    return NextResponse.json(
      {
        success: false,
        error: publishResult.error ?? 'Publish failed',
        errorKind: publishResult.isTransient ? 'transient' : 'permanent',
        scheduledPostId: scheduledId,
        hint: publishResult.isTransient
          ? "Failed but it's transient — retry from Library."
          : 'Failed and not retryable — check the integration at /integrations.',
      },
      { status: 502 },
    );
  }

  // PR #86 — Sprint 7.10 (FIX 1): write the success terminal
  // state. Mirrors the cron worker exactly so a row published
  // via "Post now" looks identical to one published via the
  // cron schedule.
  const now = new Date();
  await db
    .update(scheduledPosts)
    .set({
      publishStatus: 'published',
      status: 'posted',
      publishedAt: now,
      postedAt: now,
      metaPostId: publishResult.metaPostId ?? null,
      metaPermalink: publishResult.permalink ?? null,
      publishFailureReason: null,
      publishNextRetryAt: null,
    })
    .where(eq(scheduledPosts.id, scheduledId));

  return NextResponse.json({
    success: true,
    scheduledPostId: scheduledId,
    // X publisher returns metaPostId=tweet_id and permalink=
    // https://x.com/i/web/status/<id>; LinkedIn/Threads/Meta
    // return their own equivalents. Either way the client can
    // open the permalink directly from the response banner
    // without an extra refetch.
    metaPostId: publishResult.metaPostId ?? null,
    permalink: publishResult.permalink ?? null,
  });
}
