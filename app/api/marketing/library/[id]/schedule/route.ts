// PR #25 — Sprint 2.4: Drafts pool drawer in Calendar.
//
// POST /api/marketing/library/[id]/schedule
//
// Inverse of move-to-draft (PR #24). Promotes a draft (generated_posts
// row) into a scheduled post (scheduled_posts row) with the given
// scheduledFor timestamp, then deletes the draft. This is what the
// calendar drag-drop calls when the user drops a chip from the Drafts
// pool onto a calendar day.
//
// Why a real move (not a status flip): generated_posts has no userId,
// no scheduledFor, no visualUrl, and the Library UNION query
// (PR #23) keys "draft" off the source table, not just status. A
// status='scheduled' row that's still in generated_posts would render
// in the wrong tab and break the lifecycle assumptions everywhere
// downstream (Calendar, Performance Memory, Compass).
//
// Body:    { scheduledFor: string }   ISO timestamp
// Returns: { success, post: { id, content, platform, scheduledFor, ... } }
//
// Strict scoping: ownership is verified through projects.userId because
// generated_posts has no userId column.
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  generatedPosts,
  projects,
  scheduledPosts,
} from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { scheduledFor } = body as { scheduledFor?: unknown };

  if (typeof scheduledFor !== 'string') {
    return NextResponse.json(
      { error: 'scheduledFor (ISO string) is required' },
      { status: 400 }
    );
  }
  const when = new Date(scheduledFor);
  if (Number.isNaN(when.getTime())) {
    return NextResponse.json(
      { error: 'scheduledFor is not a valid date' },
      { status: 400 }
    );
  }

  // Verify ownership through the parent project — generated_posts has
  // no user_id column. PR #30 also pulls is_story so the flag travels
  // from the draft pool into scheduled_posts unchanged. PR #32 adds
  // is_reel + video_url for the same reason.
  const [draft] = await db
    .select({
      id: generatedPosts.id,
      projectId: generatedPosts.projectId,
      platform: generatedPosts.platform,
      content: generatedPosts.content,
      isStory: generatedPosts.isStory,
      isReel: generatedPosts.isReel,
      videoUrl: generatedPosts.videoUrl,
    })
    .from(generatedPosts)
    .innerJoin(projects, eq(projects.id, generatedPosts.projectId))
    .where(
      and(eq(generatedPosts.id, id), eq(projects.userId, user.id))
    )
    .limit(1);
  if (!draft) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // PR #30 — Stories validation when promoting a draft. The draft
  // has no visual_url column today (drafts don't carry images), so
  // a Story-flagged draft cannot be scheduled directly — the user
  // must regenerate with an image. Surface that clearly.
  if (draft.isStory) {
    if (draft.platform !== 'instagram') {
      return NextResponse.json(
        {
          error:
            'Story flag is set but platform is not Instagram. Stories only ship to Instagram.',
        },
        { status: 400 }
      );
    }
    return NextResponse.json(
      {
        error:
          'This draft is flagged as a Story but has no image attached. Regenerate it with an image, then schedule.',
      },
      { status: 400 }
    );
  }

  // PR #32 — Reels validation when promoting a draft. A Reel-flagged
  // draft must already have a video uploaded; otherwise the publisher
  // would fail later. Surface that here so the user re-uploads or
  // un-flags the draft before scheduling.
  if (draft.isReel) {
    if (draft.platform !== 'instagram') {
      return NextResponse.json(
        {
          error:
            'Reel flag is set but platform is not Instagram. Reels only ship to Instagram.',
        },
        { status: 400 }
      );
    }
    if (!draft.videoUrl) {
      return NextResponse.json(
        {
          error:
            'This draft is flagged as a Reel but has no video uploaded. Re-upload or un-flag the draft, then schedule.',
        },
        { status: 400 }
      );
    }
  }

  // Insert the new scheduled post FIRST. If something fails, the
  // draft is still recoverable — better than losing both rows.
  const [newScheduled] = await db
    .insert(scheduledPosts)
    .values({
      projectId: draft.projectId,
      userId: user.id,
      platform: draft.platform,
      content: draft.content,
      scheduledFor: when,
      status: 'scheduled',
      isStory: draft.isStory,
      isReel: draft.isReel,
      videoUrl: draft.videoUrl ?? null,
      reelProcessingStatus: draft.isReel ? 'uploaded' : null,
    })
    .returning();

  // Now delete the draft. If this fails the user ends up with both a
  // draft AND a scheduled copy — surfaceable, recoverable, no data
  // loss. Acceptable failure mode.
  await db.delete(generatedPosts).where(eq(generatedPosts.id, id));

  return NextResponse.json({
    success: true,
    post: {
      id: newScheduled.id,
      projectId: newScheduled.projectId,
      platform: newScheduled.platform,
      content: newScheduled.content,
      scheduledFor: newScheduled.scheduledFor.toISOString(),
      status: newScheduled.status,
    },
  });
}
