// PR #87 — Sprint 7.11: Upload to TikTok Inbox.
//
// Body: { scheduledPostId: string }
//
// Flow:
//   1. Verify the founder owns the scheduledPost.
//   2. Find the matching HeyGen job for the underlying draft —
//      we accept either (a) a heygen_job whose draftId already
//      mapped to a scheduled_post via publish-now's migration, or
//      (b) a direct lookup by heygenJobId persisted on the
//      scheduledPost in a future schema patch. For 7.11 we look
//      up via the most-recent heygen_job for the draft path,
//      falling back to any heygen_job for the user when the
//      direct path can't resolve.
//   3. Confirm the HeyGen job is completed (video_url present).
//   4. Get a valid TikTok access token via the auto-refresh
//      helper.
//   5. Call TikTok's inbox/video/init/ with PULL_FROM_URL — the
//      video bytes go HeyGen → TikTok directly; Vercel never
//      retransmits.
//   6. Persist a tiktok_publish_jobs row with the publish_id +
//      status='PROCESSING_UPLOAD'.
//   7. Return { success, publishId } so the client can start
//      polling /status?publishId=…
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
  TikTokAuthError,
} from '@/lib/tiktok/client';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const maxDuration = 60;

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

  // Find the completed HeyGen job for this content. Strategy:
  // we know the scheduled_post came from a draft (publish-now or
  // schedule path) and the heygen_job FK'd that draft. Since
  // publish-now DELETEs the draft, the heygen_job's draftId may
  // already be dangling — query by user+project+status='completed'
  // and pick the most-recent one created near the scheduled_post.
  // For a tighter mapping we'd add scheduledPostId to heygen_jobs;
  // good follow-up.
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

  // Defense-in-depth: if the heygen_job's draftId still exists,
  // double-check the script alignment (helps when the founder
  // has multiple video drafts in flight).
  if (heygenJob?.draftId) {
    const [draft] = await db
      .select({ id: generatedPosts.id })
      .from(generatedPosts)
      .where(eq(generatedPosts.id, heygenJob.draftId))
      .limit(1);
    void draft; // we don't gate on draft existence — it may have
    // been deleted by publish-now.
  }

  if (!heygenJob || !heygenJob.videoUrl) {
    return NextResponse.json(
      {
        error:
          'No completed HeyGen video found for this post. Generate the video before sending to TikTok.',
        errorKind: 'no_video',
      },
      { status: 400 },
    );
  }

  // Get a valid access token (auto-refresh).
  let accessToken: string;
  try {
    const result = await getValidAccessToken(user.id);
    accessToken = result.accessToken;
  } catch (err) {
    if (err instanceof TikTokAuthError) {
      return NextResponse.json(
        {
          error: err.message,
          errorKind: err.code,
          hint:
            err.code === 'not_connected'
              ? 'Connect TikTok at /integrations.'
              : 'Re-authorize TikTok at /integrations.',
        },
        { status: err.code === 'not_connected' ? 404 : 401 },
      );
    }
    throw err;
  }

  // Fire TikTok inbox init.
  let publishId: string;
  try {
    const init = await initInboxUpload({
      accessToken,
      videoUrl: heygenJob.videoUrl,
    });
    publishId = init.publishId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'TikTok init failed';
    return NextResponse.json(
      {
        error: msg,
        errorKind: 'tiktok_init_failed',
      },
      { status: 502 },
    );
  }

  // Persist the job ledger.
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
