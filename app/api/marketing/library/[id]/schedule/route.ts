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
      // PR #65 — Sprint 7.0.8: carousel slide image URLs. Carried
      // forward so the publisher cron can post the multi-image
      // carousel without a roundtrip back to generated_posts.
      visualUrls: generatedPosts.visualUrls,
      // PR Sprint 7.13 (BUG 3) — singular image URL for non-
      // carousel posts (single photo, IG photo, etc.). Was
      // never copied to scheduledPosts.visualUrl pre-fix, so
      // scheduled single-image posts lost their image
      // immediately — Library + Calendar both rendered the
      // post without a visual.
      imageUrl: generatedPosts.imageUrl,
      imagePrompt: generatedPosts.imagePrompt,
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
      // PR #65 — Sprint 7.0.8: carry slide image URLs for carousels.
      visualUrls: (draft.visualUrls as string[] | null) ?? null,
      // PR Sprint 7.13 (BUG 3) — carry the singular image URL too.
      // For non-carousel posts the image lives on generatedPosts.
      // imageUrl; this is the column scheduledPosts uses for the
      // same purpose (visualUrl).
      visualUrl: draft.imageUrl ?? null,
      visualPrompt: draft.imagePrompt ?? null,
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
  visualUrls?: unknown;
  structuredContent?: unknown;
}): string | null {
  const ct = draft.contentType;
  if (!ct) return null; // legacy plain-text — existing flow handles it

  // PR #65 — Sprint 7.0.8: X is now postable when env creds are
  // configured. We probe the env var here (server-side); if missing
  // we refuse the schedule rather than letting the cron fail.
  const xConfigured = Boolean(
    process.env.X_API_KEY &&
      process.env.X_API_SECRET &&
      process.env.X_ACCESS_TOKEN &&
      process.env.X_ACCESS_TOKEN_SECRET,
  );

  // Non-Meta platforms.
  // PR #66 — Sprint 7.0.9: LinkedIn + Threads now wired. We only
  // check the content shape here; runtime connection health
  // (token expired, scope missing, etc.) is surfaced when the
  // publisher actually runs. That avoids two sources of truth
  // and matches how Meta is handled — schedule trusts that an
  // integration exists; publisher provides the human message
  // when it doesn't.
  if (draft.platform === 'linkedin') {
    if (ct === 'single_image' && !draft.visualUrl) {
      return 'LinkedIn single_image post needs a visual. Use Generate\'s "+ Add visual" first.';
    }
    if (ct === 'carousel') {
      const urls = Array.isArray(draft.visualUrls)
        ? (draft.visualUrls as unknown[]).filter(
            (u) => typeof u === 'string' && u.length > 0,
          )
        : [];
      if (urls.length === 0) {
        return 'LinkedIn carousel needs slide images. Click "Generate slides" on the draft first.';
      }
    }
    return null;
  }
  if (draft.platform === 'reddit') {
    return 'Reddit auto-publish isn\'t wired yet (requires app review). Copy the title + body and post manually.';
  }
  if (draft.platform === 'threads') {
    if (ct === 'photo' && !draft.visualUrl) {
      return 'Threads photo post needs a visual. Use Generate\'s "+ Add visual" first.';
    }
    // Length check — Threads caps at 500.
    const text =
      getStringField(draft.structuredContent, 'content') ?? '';
    if (text.length > 500) {
      return `Threads body is ${text.length} chars (over 500). Regenerate shorter.`;
    }
    return null;
  }
  if (draft.platform === 'x') {
    if (!xConfigured) {
      return 'X (Twitter) publishing needs API credentials (X_API_KEY + secrets) configured server-side.';
    }
    // single_tweet + thread both supported. Other types fall through.
    if (ct === 'single_tweet') {
      const text =
        getStringField(draft.structuredContent, 'content') ?? '';
      if (!text) {
        return 'Tweet body is empty. Regenerate the draft.';
      }
      if (text.length > 280) {
        return `Tweet is ${text.length} chars (over 280). Regenerate shorter.`;
      }
      return null;
    }
    if (ct === 'thread') {
      const tweets = getThreadTweets(draft.structuredContent);
      if (tweets.length === 0) {
        return 'Thread body is empty. Regenerate the draft.';
      }
      const tooLong = tweets.findIndex((t) => t.length > 280);
      if (tooLong !== -1) {
        return `Thread tweet ${tooLong + 1} is over 280 chars. Regenerate.`;
      }
      return null;
    }
    return `Don't know how to publish "${ct}" on X yet.`;
  }

  // Instagram & Facebook formats.
  if (ct === 'reel') {
    if (!draft.videoUrl) {
      return 'Reel script ready, but auto-publish needs a video. Upload one in Generate, or copy the script and post manually.';
    }
    return null;
  }
  if (ct === 'carousel') {
    // PR #65 — Sprint 7.0.8: now postable when slide images are
    // generated. We require one URL per slide.
    const slides = getSlideCount(draft.structuredContent);
    const urls = Array.isArray(draft.visualUrls)
      ? (draft.visualUrls as unknown[]).filter(
          (u) => typeof u === 'string' && u.length > 0,
        )
      : [];
    if (slides === 0) {
      return 'Carousel has no slides. Regenerate the draft.';
    }
    if (urls.length < slides) {
      return `Carousel has ${slides} slides but only ${urls.length} slide image(s). Click "Generate slides" on the draft first.`;
    }
    return null;
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

// Tiny helpers for structuredContent shape introspection.
function getSlideCount(structured: unknown): number {
  if (!structured || typeof structured !== 'object') return 0;
  const slides = (structured as { slides?: unknown }).slides;
  return Array.isArray(slides) ? slides.length : 0;
}
function getStringField(structured: unknown, key: string): string | null {
  if (!structured || typeof structured !== 'object') return null;
  const v = (structured as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : null;
}
function getThreadTweets(structured: unknown): string[] {
  if (!structured || typeof structured !== 'object') return [];
  const tweets = (structured as { tweets?: unknown }).tweets;
  if (!Array.isArray(tweets)) return [];
  return tweets.filter((t): t is string => typeof t === 'string');
}
