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
      // PR #63 — Sprint 7.0.6: carry structured-draft fields so the
      // Calendar badge + Library scheduled-post type filter both
      // surface the format. Null on legacy pillar-variant drafts.
      contentType: generatedPosts.contentType,
      structuredContent: generatedPosts.structuredContent,
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

  // PR #64 — Sprint 7.0.7: posteability validation for structured
  // drafts. Sprint 7.0.4 ships drafts as JSON scripts (hook/beats/
  // captions for Reels, slides for Carousels, etc.) but the
  // structured-drafts flow doesn't yet produce the media files Meta
  // needs to publish. We refuse to schedule what can't auto-publish
  // so the founder doesn't end up with a library full of perpetual
  // failures. Sprint 7.0.8+ will wire media generation per format.
  const blockReason = unpostableReason(draft);
  if (blockReason) {
    return NextResponse.json(
      { error: blockReason, code: 'unpostable' },
      { status: 400 },
    );
  }

  // PR #64 — Sprint 7.0.7: when the draft is a structured Reel
  // with a video attached, route it through the existing Reel
  // publisher flow even if the generate-time isReel toggle was
  // never flipped. Same for Story (no contentType for Story yet,
  // so isStory stays as-set).
  const effectiveIsReel =
    draft.isReel || (draft.contentType === 'reel' && Boolean(draft.videoUrl));

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
      isReel: effectiveIsReel,
      videoUrl: draft.videoUrl ?? null,
      reelProcessingStatus: effectiveIsReel ? 'uploaded' : null,
      // PR #63 — Sprint 7.0.6: copy structured-draft metadata.
      contentType: draft.contentType,
      structuredContent: draft.structuredContent ?? null,
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

// PR #64 — Sprint 7.0.7: classify a draft's auto-publishability.
//
// Returns null when the draft can be auto-published today, or a
// founder-facing reason string when it can't. The UI surfaces the
// string directly so we keep them concrete and actionable.
//
// Rules:
//   - Instagram needs media: a Reel without videoUrl, a Photo /
//     Carousel without visualUrl can't be published.
//   - Carousel + Story + most non-photo IG types need media we
//     don't yet generate from structured drafts (deferred to a
//     later sprint that adds slide-image generation).
//   - Non-Meta platforms (LinkedIn / Reddit / Threads / X) have
//     no publisher wired yet, so we refuse to schedule until the
//     respective integration lands.
//   - Legacy plain-text drafts (contentType=null) pass through
//     untouched — the existing isReel/isStory paths cover them.
function unpostableReason(draft: {
  platform: string;
  contentType: string | null;
  visualUrl?: string | null;
  videoUrl?: string | null;
}): string | null {
  const ct = draft.contentType;
  if (!ct) return null; // legacy plain-text — existing flow handles it

  // Non-Meta platforms: no publisher wired yet.
  if (draft.platform === 'linkedin') {
    return 'LinkedIn auto-publish isn\'t wired yet. Save the draft and copy it manually for now.';
  }
  if (draft.platform === 'reddit') {
    return 'Reddit auto-publish isn\'t wired yet. Copy the title + body and post manually.';
  }
  if (draft.platform === 'threads') {
    return 'Threads auto-publish isn\'t wired yet. Sprint 7.0.9 will add this.';
  }
  if (draft.platform === 'x') {
    return 'X (Twitter) auto-publish needs a pay-per-use API key. Sprint 7.0.8 will wire this.';
  }

  // Instagram & Facebook formats.
  if (ct === 'reel') {
    if (!draft.videoUrl) {
      return 'Reel script ready, but auto-publish needs a video. Upload one in Generate, or copy the script and post manually.';
    }
    return null;
  }
  if (ct === 'carousel') {
    return 'Carousel auto-publish needs slide images (one per slide). Sprint 7.0.8 will add slide-image generation; for now copy the slides and post manually.';
  }
  if (ct === 'photo' || ct === 'single_image') {
    if (!draft.visualUrl) {
      return 'Photo post needs a visual. Use Generate\'s "+ Add visual" button, then schedule.';
    }
    return null;
  }
  if (ct === 'ugc') {
    return 'UGC video isn\'t auto-publishable yet — Sprint 7.0.10 plans HeyGen integration. Copy the script and record manually.';
  }
  if (ct === 'community_post') {
    // Facebook community post is text-only; allowed.
    if (draft.platform === 'facebook') return null;
    return 'Community posts are Facebook-only. Re-generate on Facebook.';
  }
  if (ct === 'text_post') {
    // No native text-only support on IG; OK on FB.
    if (draft.platform === 'facebook') return null;
    return 'Text posts on this platform aren\'t auto-publishable yet.';
  }

  // Unknown contentType — refuse rather than guess.
  return `Don't know how to publish "${ct}" on ${draft.platform} yet. Copy manually for now.`;
}
