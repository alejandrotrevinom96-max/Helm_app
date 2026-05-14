// PR Sprint 7.19 — server-side TikTok publish for the cron path.
//
// Mirrors the per-contentType branching from
// app/api/integrations/tiktok/upload/route.ts, but takes a
// scheduledPosts row directly (no HTTP / Supabase auth — the
// cron is the trusted caller). Returns a result shape the
// publisher.ts dispatcher can map to its PublishResult.
//
// Why a separate helper instead of calling the HTTP endpoint:
// the route requires `supabase.auth.getUser()` which is empty
// on cron requests. We share the low-level TikTok client
// helpers (getValidAccessToken / initInboxUpload /
// initPhotoUpload) so the API surface stays consistent.

import { db } from '@/lib/db';
import {
  heygenJobs,
  tiktokPublishJobs,
  type ScheduledPost,
} from '@/lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import {
  getValidAccessToken,
  initInboxUpload,
  initPhotoUpload,
  TikTokAuthError,
} from './client';
import { logger } from '@/lib/observability/logger';

export interface TikTokScheduledPublishResult {
  /** True when a tiktok_publish_jobs row landed in the DB
   * (PROCESSING_UPLOAD). The cron treats this as a successful
   * publish — the post is now in the user's TikTok inbox /
   * processing pipeline. */
  success: boolean;
  /** TikTok-assigned publishId (only on success). */
  publishId?: string;
  /** Human-readable error to surface in the Library card. */
  error?: string;
  /**
   * The HeyGen video isn't ready yet. The cron should LEAVE
   * THIS POST in `publishStatus: null` so it's re-eligible on
   * the next tick. Do NOT increment retryCount and do NOT mark
   * as failed — the video render itself takes minutes.
   */
  notReadyYet?: boolean;
  /**
   * The failure is recoverable. Set isTransient=true so the
   * cron's existing retry-with-backoff path runs.
   */
  isTransient?: boolean;
}

// Bucket maps — kept in sync with the route handler.
const VIDEO_CONTENT_TYPES = new Set(['ugc', 'reel']);
const PHOTO_CONTENT_TYPES = new Set([
  'photo',
  'single_photo',
  'single_image',
]);
const CAROUSEL_CONTENT_TYPES = new Set(['carousel']);

function classify(
  contentType: string | null,
): 'video' | 'photo' | 'carousel' | 'unsupported' {
  if (!contentType) return 'video';
  if (VIDEO_CONTENT_TYPES.has(contentType)) return 'video';
  if (PHOTO_CONTENT_TYPES.has(contentType)) return 'photo';
  if (CAROUSEL_CONTENT_TYPES.has(contentType)) return 'carousel';
  return 'unsupported';
}

function deriveTitle(content: string | null | undefined): string {
  if (!content) return 'Untitled';
  const firstLine = content.split('\n')[0]?.trim() ?? '';
  return firstLine.slice(0, 90) || 'Untitled';
}

/**
 * Publish a scheduled TikTok post to the user's TikTok inbox
 * (video) or content posting init (photo/carousel) flow.
 */
export async function publishScheduledPostToTikTok(
  post: ScheduledPost,
): Promise<TikTokScheduledPublishResult> {
  const kind = classify(post.contentType);

  if (kind === 'unsupported') {
    return {
      success: false,
      error: `Content type '${post.contentType}' is not supported for TikTok publishing yet.`,
      isTransient: false,
    };
  }

  // Idempotency — if a non-terminal job already exists for
  // this scheduled post, treat as already-published.
  const [existing] = await db
    .select()
    .from(tiktokPublishJobs)
    .where(
      and(
        eq(tiktokPublishJobs.scheduledPostId, post.id),
        eq(tiktokPublishJobs.userId, post.userId),
      ),
    )
    .orderBy(desc(tiktokPublishJobs.createdAt))
    .limit(1);
  if (
    existing &&
    (existing.status === 'PROCESSING_UPLOAD' ||
      existing.status === 'SEND_TO_USER_INBOX' ||
      existing.status === 'PUBLISH_COMPLETE')
  ) {
    return { success: true, publishId: existing.publishId };
  }

  // VIDEO PATH
  if (kind === 'video') {
    const [heygenJob] = await db
      .select()
      .from(heygenJobs)
      .where(
        and(
          eq(heygenJobs.userId, post.userId),
          eq(heygenJobs.projectId, post.projectId),
          eq(heygenJobs.status, 'completed'),
        ),
      )
      .orderBy(desc(heygenJobs.completedAt))
      .limit(1);

    if (!heygenJob || !heygenJob.videoUrl) {
      // Per the sprint brief: don't fail the post — leave it
      // scheduled so the next cron tick re-checks once the
      // video render finishes.
      return {
        success: false,
        notReadyYet: true,
        error:
          "Your video is being processed. We'll publish automatically when it's ready.",
      };
    }

    const accessToken = await resolveAccessToken(post.userId);
    if ('error' in accessToken) return accessToken.error;

    try {
      const init = await initInboxUpload({
        accessToken: accessToken.token,
        videoUrl: heygenJob.videoUrl,
      });
      const [inserted] = await db
        .insert(tiktokPublishJobs)
        .values({
          userId: post.userId,
          scheduledPostId: post.id,
          heygenJobId: heygenJob.id,
          publishId: init.publishId,
          status: 'PROCESSING_UPLOAD',
          sourceVideoUrl: heygenJob.videoUrl,
        })
        .returning();
      return { success: true, publishId: inserted.publishId };
    } catch (err) {
      logger.error(
        'tiktok/publish-scheduled',
        'video init failed',
        { userId: post.userId, scheduledPostId: post.id, error: err },
      );
      return {
        success: false,
        error:
          'TikTok publishing failed. Try again or publish manually from the TikTok app.',
        isTransient: true,
      };
    }
  }

  // PHOTO PATH
  if (kind === 'photo') {
    if (!post.visualUrl) {
      return {
        success: false,
        error:
          'Generate an image for this post before publishing to TikTok.',
        isTransient: false,
      };
    }
    const accessToken = await resolveAccessToken(post.userId);
    if ('error' in accessToken) return accessToken.error;

    try {
      const init = await initPhotoUpload({
        accessToken: accessToken.token,
        photoUrls: [post.visualUrl],
        title: deriveTitle(post.content),
        description: post.content,
      });
      const [inserted] = await db
        .insert(tiktokPublishJobs)
        .values({
          userId: post.userId,
          scheduledPostId: post.id,
          publishId: init.publishId,
          status: 'PROCESSING_UPLOAD',
          sourceVideoUrl: post.visualUrl,
        })
        .returning();
      return { success: true, publishId: inserted.publishId };
    } catch (err) {
      logger.error(
        'tiktok/publish-scheduled',
        'photo init failed',
        { userId: post.userId, scheduledPostId: post.id, error: err },
      );
      return {
        success: false,
        error:
          'TikTok publishing failed. Try again or publish manually from the TikTok app.',
        isTransient: true,
      };
    }
  }

  // CAROUSEL PATH — per the brief, surface the manual-upload
  // hint instead of attempting auto-publish from cron. This is
  // intentionally more conservative than the user-driven
  // upload route (which DOES try the multi-photo init): cron
  // failures are silent until the founder opens Library, so we
  // prefer a clear failure message over a silent attempt that
  // might land posts in an unexpected shape.
  return {
    success: false,
    error: 'TikTok Carousel requires manual upload.',
    isTransient: false,
  };
}

async function resolveAccessToken(
  userId: string,
): Promise<{ token: string } | { error: TikTokScheduledPublishResult }> {
  try {
    const result = await getValidAccessToken(userId);
    return { token: result.accessToken };
  } catch (err) {
    if (err instanceof TikTokAuthError) {
      return {
        error: {
          success: false,
          error:
            err.code === 'not_connected'
              ? 'Connect TikTok at /integrations before publishing.'
              : 'Re-authorize TikTok at /integrations to keep publishing.',
          isTransient: false,
        },
      };
    }
    throw err;
  }
}
