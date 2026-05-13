// PR #80 — Sprint 7.5.2: publish-now endpoint.
//
// Before this commit there was no way to publish a draft
// IMMEDIATELY from the UI. The flow required scheduling a row in
// scheduled_posts and waiting for the cron at /api/cron/publish-
// scheduled to pick it up — which meant minutes of latency for
// what should be a 1-click action, and no observability into
// success/failure until the next cron pass.
//
// This route:
//   1. Pulls the draft from generated_posts (ownership-join).
//   2. Inserts a scheduled_posts row with scheduledFor=now +
//      status='scheduled'. We reuse scheduled_posts (not a
//      separate "publish queue") so the publishPost dispatcher,
//      the Library, and the Calendar all see the post the same
//      way they see scheduled rows.
//   3. Deletes the draft (mirrors /api/marketing/library/[id]/
//      schedule which does the same).
//   4. Calls publishPost(newScheduledId) SYNCHRONOUSLY so the
//      caller gets the success/failure in the response.
//
// On publish failure, the scheduled_posts row stays put with
// status='failed' — the founder can retry via the existing
// /api/marketing/library/[id]/retry-publish endpoint. No data
// loss.
//
// Plan-correction note: the original sprint plan suggested
// updating generated_posts directly (set status='published').
// That breaks downstream consumers — the Library/Calendar +
// publisher dispatch all key off scheduled_posts. Routing
// through scheduled_posts keeps the data model coherent.
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

  // Ownership-join — generated_posts has no user_id column so we
  // verify via projects.userId. Same pattern as the schedule
  // endpoint.
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
  // A draft flagged as Story has no image attached at the draft
  // layer, so we refuse fast rather than letting the publisher
  // surface a cryptic "media missing" later.
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
    })
    .returning();

  // Best-effort draft cleanup. If this fails the founder ends up
  // with the same row in BOTH tables — surfaceable, not data
  // loss. Same trade-off as the schedule endpoint.
  await db.delete(generatedPosts).where(eq(generatedPosts.id, id));

  // Now publish. publishPost reads scheduled_posts by id, branches
  // on platform (x / linkedin / threads / facebook / instagram),
  // and either calls the platform-specific helper or the Meta
  // Graph path. Synchronous — the founder waits for the result.
  let publishResult;
  try {
    publishResult = await publishPost(scheduled.id);
  } catch (err) {
    console.error('[publish-now] publishPost threw:', err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Publish failed',
        errorKind: 'unknown',
        scheduledPostId: scheduled.id,
        hint: 'Tu draft quedó en scheduled_posts con status=failed. Retry desde Library.',
      },
      { status: 500 },
    );
  }

  if (!publishResult.success) {
    return NextResponse.json(
      {
        success: false,
        error: publishResult.error ?? 'Publish failed',
        errorKind: publishResult.isTransient
          ? 'transient'
          : 'permanent',
        scheduledPostId: scheduled.id,
        hint: publishResult.isTransient
          ? 'Falló pero es transient — retry desde Library.'
          : 'Falló y no es retryable — chequeá integration en /integrations.',
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    success: true,
    scheduledPostId: scheduled.id,
    // PublishResult only carries metaPostId + permalink for Meta-
    // platform success. X/LinkedIn/Threads helpers persist their
    // own external IDs onto the scheduled_posts row directly
    // (publishedExternalId column) — the client can refetch the
    // row via /api/marketing/library to get them.
    metaPostId: publishResult.metaPostId ?? null,
    permalink: publishResult.permalink ?? null,
  });
}
