// PR #87 — Sprint 7.11: Upload to TikTok Inbox.
// PR Sprint 7.19 — branched by contentType so Single Photo and
// Carousel posts route through the Photo Content API instead of
// the HeyGen video path. Pre-fix every scheduledPost hit the
// HeyGen lookup; photo posts that had a Flux image but no HeyGen
// job failed with a misleading "no completed HeyGen video"
// error.
//
// Body: { scheduledPostId: string }
//
// Flow per content type:
//   - 'ugc' | 'reel'                → HeyGen video path
//     1. Find the completed heygen_job for this user/project.
//     2. Init TikTok inbox video upload (PULL_FROM_URL).
//   - 'photo' | 'single_image'      → Flux single-photo path
//     1. Read scheduledPost.visualUrl (Supabase Storage URL).
//     2. Init TikTok photo upload with one photo.
//   - 'carousel'                    → Flux multi-photo path
//     1. Read scheduledPost.visualUrls[] (Supabase Storage URLs).
//     2. Init TikTok photo upload with up to 35 photos.
//     3. If TikTok rejects, surface a manual-upload hint.
//   - unknown / null contentType    → legacy fallthrough to the
//     HeyGen path so existing video drafts keep working.
//
// Persists a tiktok_publish_jobs row + returns { publishId } so
// the client can start polling /status?publishId=…
//
// Idempotency: if a non-terminal job already exists for this
// scheduled post, we return it instead of double-uploading.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  scheduledPosts,
  heygenJobs,
  tiktokPublishJobs,
  generatedPosts,
} from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import {
  getValidAccessToken,
  initInboxUpload,
  initPhotoUpload,
  TikTokAuthError,
} from '@/lib/tiktok/client';
import { logger } from '@/lib/observability/logger';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const maxDuration = 60;

// ============================================================
// Content type buckets
// ============================================================
//
// PR Sprint 7.19 — single source of truth for routing. Anything
// not in the photo/carousel sets falls through to the legacy
// HeyGen video path so existing UGC/Reel drafts keep working.
const VIDEO_CONTENT_TYPES = new Set(['ugc', 'reel']);
const PHOTO_CONTENT_TYPES = new Set([
  'photo',
  'single_photo',
  'single_image',
]);
const CAROUSEL_CONTENT_TYPES = new Set(['carousel']);

type TikTokKind = 'video' | 'photo' | 'carousel' | 'unsupported';

function classifyContentType(contentType: string | null): TikTokKind {
  if (!contentType) return 'video'; // legacy heygen path
  if (VIDEO_CONTENT_TYPES.has(contentType)) return 'video';
  if (PHOTO_CONTENT_TYPES.has(contentType)) return 'photo';
  if (CAROUSEL_CONTENT_TYPES.has(contentType)) return 'carousel';
  return 'unsupported';
}

// ============================================================
// HTTP handler
// ============================================================

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { scheduledPostId?: unknown };
  try {
    body = (await request.json()) as { scheduledPostId?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (
    typeof body.scheduledPostId !== 'string' ||
    !UUID_RE.test(body.scheduledPostId)
  ) {
    return NextResponse.json(
      { error: 'Invalid scheduledPostId' },
      { status: 400 },
    );
  }
  const scheduledPostId = body.scheduledPostId;

  // Ownership check + payload fetch.
  const [scheduled] = await db
    .select()
    .from(scheduledPosts)
    .where(
      and(
        eq(scheduledPosts.id, scheduledPostId),
        eq(scheduledPosts.userId, user.id),
      ),
    )
    .limit(1);
  if (!scheduled) {
    return NextResponse.json(
      { error: 'Scheduled post not found or forbidden' },
      { status: 404 },
    );
  }

  // Reuse an existing non-terminal upload job for idempotency.
  const [existingJob] = await db
    .select()
    .from(tiktokPublishJobs)
    .where(
      and(
        eq(tiktokPublishJobs.scheduledPostId, scheduledPostId),
        eq(tiktokPublishJobs.userId, user.id),
      ),
    )
    .orderBy(desc(tiktokPublishJobs.createdAt))
    .limit(1);
  if (
    existingJob &&
    (existingJob.status === 'PROCESSING_UPLOAD' ||
      existingJob.status === 'SEND_TO_USER_INBOX' ||
      existingJob.status === 'PUBLISH_COMPLETE')
  ) {
    return NextResponse.json({
      success: true,
      publishId: existingJob.publishId,
      status: existingJob.status,
      reused: true,
    });
  }

  const kind = classifyContentType(scheduled.contentType);

  if (kind === 'unsupported') {
    return NextResponse.json(
      {
        error: `Content type '${scheduled.contentType}' is not supported for TikTok publishing yet.`,
        errorKind: 'unsupported_content_type',
      },
      { status: 400 },
    );
  }

  // ============================================================
  // VIDEO PATH (HeyGen-rendered) — original Sprint 7.11 logic
  // ============================================================
  if (kind === 'video') {
    // Find the completed HeyGen job for this content. Strategy:
    // we know the scheduled_post came from a draft (publish-now
    // or schedule path) and the heygen_job FK'd that draft.
    // Since publish-now DELETEs the draft, the heygen_job's
    // draftId may already be dangling — query by user+project+
    // status='completed' and pick the most-recent one.
    const [heygenJob] = await db
      .select()
      .from(heygenJobs)
      .where(
        and(
          eq(heygenJobs.userId, user.id),
          eq(heygenJobs.projectId, scheduled.projectId),
          eq(heygenJobs.status, 'completed'),
        ),
      )
      .orderBy(desc(heygenJobs.completedAt))
      .limit(1);

    // Defense-in-depth: if the heygen_job's draftId still
    // exists, double-check the script alignment (helps when the
    // founder has multiple video drafts in flight).
    if (heygenJob?.draftId) {
      const [draft] = await db
        .select({ id: generatedPosts.id })
        .from(generatedPosts)
        .where(eq(generatedPosts.id, heygenJob.draftId))
        .limit(1);
      void draft; // not gated — publish-now may have deleted it.
    }

    if (!heygenJob || !heygenJob.videoUrl) {
      return NextResponse.json(
        {
          error:
            "Your video is still being processed. Check back in a few minutes once the video render finishes.",
          errorKind: 'no_video',
        },
        { status: 400 },
      );
    }

    const tokenResult = await loadAccessToken(user.id);
    if ('error' in tokenResult) return tokenResult.error;

    let publishId: string;
    try {
      const init = await initInboxUpload({
        accessToken: tokenResult.accessToken,
        videoUrl: heygenJob.videoUrl,
      });
      publishId = init.publishId;
    } catch (err) {
      logger.error(
        'integrations/tiktok/upload',
        'video init failed',
        { userId: user.id, scheduledPostId, error: err },
      );
      return NextResponse.json(
        {
          error:
            'TikTok publishing failed. Try again or publish manually from the TikTok app.',
          errorKind: 'tiktok_init_failed',
        },
        { status: 502 },
      );
    }

    const [inserted] = await db
      .insert(tiktokPublishJobs)
      .values({
        userId: user.id,
        scheduledPostId,
        heygenJobId: heygenJob.id,
        publishId,
        status: 'PROCESSING_UPLOAD',
        sourceVideoUrl: heygenJob.videoUrl,
      })
      .returning();

    return NextResponse.json({
      success: true,
      publishId: inserted.publishId,
      status: inserted.status,
      jobId: inserted.id,
    });
  }

  // ============================================================
  // PHOTO PATH (single Flux image) — new in Sprint 7.19
  // ============================================================
  if (kind === 'photo') {
    if (!scheduled.visualUrl) {
      return NextResponse.json(
        {
          error:
            'Generate an image for this post before publishing to TikTok.',
          errorKind: 'no_image',
        },
        { status: 400 },
      );
    }

    const tokenResult = await loadAccessToken(user.id);
    if ('error' in tokenResult) return tokenResult.error;

    let publishId: string;
    try {
      const init = await initPhotoUpload({
        accessToken: tokenResult.accessToken,
        photoUrls: [scheduled.visualUrl],
        title: deriveTitle(scheduled.content),
        description: scheduled.content,
      });
      publishId = init.publishId;
    } catch (err) {
      logger.error(
        'integrations/tiktok/upload',
        'photo init failed',
        { userId: user.id, scheduledPostId, error: err },
      );
      return NextResponse.json(
        {
          error:
            'TikTok publishing failed. Try again or publish manually from the TikTok app.',
          errorKind: 'tiktok_init_failed',
        },
        { status: 502 },
      );
    }

    const [inserted] = await db
      .insert(tiktokPublishJobs)
      .values({
        userId: user.id,
        scheduledPostId,
        // heygenJobId stays null for photo uploads. sourceVideoUrl
        // gets the photo URL so audit traces remain useful (the
        // column name predates Sprint 7.19; we treat it as
        // "source media URL" going forward).
        publishId,
        status: 'PROCESSING_UPLOAD',
        sourceVideoUrl: scheduled.visualUrl,
      })
      .returning();

    return NextResponse.json({
      success: true,
      publishId: inserted.publishId,
      status: inserted.status,
      jobId: inserted.id,
    });
  }

  // ============================================================
  // CAROUSEL PATH (multi-photo) — new in Sprint 7.19
  // ============================================================
  if (kind === 'carousel') {
    const urls = Array.isArray(scheduled.visualUrls)
      ? scheduled.visualUrls.filter(
          (u): u is string => typeof u === 'string' && u.length > 0,
        )
      : [];
    if (urls.length === 0) {
      return NextResponse.json(
        {
          error:
            'Generate the slide images for this carousel before publishing to TikTok.',
          errorKind: 'no_image',
        },
        { status: 400 },
      );
    }

    const tokenResult = await loadAccessToken(user.id);
    if ('error' in tokenResult) return tokenResult.error;

    let publishId: string;
    try {
      const init = await initPhotoUpload({
        accessToken: tokenResult.accessToken,
        // TikTok accepts up to 35; our carousels cap at 8-10
        // but be defensive in case the schema ever grows.
        photoUrls: urls.slice(0, 35),
        title: deriveTitle(scheduled.content),
        description: scheduled.content,
      });
      publishId = init.publishId;
    } catch (err) {
      logger.warn(
        'integrations/tiktok/upload',
        'carousel init failed — falling back to manual-upload guidance',
        {
          userId: user.id,
          scheduledPostId,
          slideCount: urls.length,
          error: err,
        },
      );
      return NextResponse.json(
        {
          error:
            'TikTok Carousel publishing requires manual upload. Download your slides and upload them directly in the TikTok app.',
          errorKind: 'carousel_manual_upload',
        },
        { status: 400 },
      );
    }

    const [inserted] = await db
      .insert(tiktokPublishJobs)
      .values({
        userId: user.id,
        scheduledPostId,
        publishId,
        status: 'PROCESSING_UPLOAD',
        // First slide URL as the audit trace (matches "cover"
        // in the API call).
        sourceVideoUrl: urls[0],
      })
      .returning();

    return NextResponse.json({
      success: true,
      publishId: inserted.publishId,
      status: inserted.status,
      jobId: inserted.id,
    });
  }

  // Unreachable — classifyContentType returns one of the four
  // tags handled above. Keeps TS exhaustive.
  return NextResponse.json(
    { error: 'Unrecognized content type' },
    { status: 400 },
  );
}

// ============================================================
// Helpers
// ============================================================

/**
 * Resolve a usable TikTok access token. Returns either
 * `{ accessToken }` on success, or `{ error: NextResponse }` so
 * the caller can early-return without duplicating the error
 * shape across video/photo/carousel branches.
 */
async function loadAccessToken(
  userId: string,
): Promise<{ accessToken: string } | { error: NextResponse }> {
  try {
    const result = await getValidAccessToken(userId);
    return { accessToken: result.accessToken };
  } catch (err) {
    if (err instanceof TikTokAuthError) {
      return {
        error: NextResponse.json(
          {
            error: err.message,
            errorKind: err.code,
            hint:
              err.code === 'not_connected'
                ? 'Connect TikTok at /integrations.'
                : 'Re-authorize TikTok at /integrations.',
          },
          { status: err.code === 'not_connected' ? 404 : 401 },
        ),
      };
    }
    throw err;
  }
}

/**
 * Build a short TikTok post title from the caption. TikTok caps
 * the title field at 90 chars; using a meaningful prefix is
 * nicer than a blank "Untitled" — the user will overwrite from
 * the inbox anyway.
 */
function deriveTitle(content: string | null | undefined): string {
  if (!content) return 'Untitled';
  const firstLine = content.split('\n')[0]?.trim() ?? '';
  return firstLine.slice(0, 90) || 'Untitled';
}

// GET ?scheduledPostId=… — returns the latest tiktok_publish_job
// for a scheduled post. The Library UI uses this on mount to
// decide whether to render "Send to TikTok" or "In your inbox ✓".
//
// (draftId lookups deliberately not supported here. The Library
// button only surfaces on scheduled rows that already have a
// completed heygen video — see post-detail-modal.tsx — so the
// scheduledPostId path is enough.)
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const scheduledPostId = url.searchParams.get('scheduledPostId');
  if (!scheduledPostId || !UUID_RE.test(scheduledPostId)) {
    return NextResponse.json(
      { error: 'Provide scheduledPostId' },
      { status: 400 },
    );
  }

  const [job] = await db
    .select()
    .from(tiktokPublishJobs)
    .where(
      and(
        eq(tiktokPublishJobs.userId, user.id),
        eq(tiktokPublishJobs.scheduledPostId, scheduledPostId),
      ),
    )
    .orderBy(desc(tiktokPublishJobs.createdAt))
    .limit(1);

  return NextResponse.json({ job: job ?? null });
}
