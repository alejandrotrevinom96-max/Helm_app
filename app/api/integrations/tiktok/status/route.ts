// PR #87 — Sprint 7.11: TikTok publish status poller.
//
// GET ?publishId=…
//
// Calls TikTok's status/fetch/ endpoint with the publish_id we
// got from inbox/video/init/ during the upload step. Returns the
// latest lifecycle stage so the Library UI can flip from
// "Sending…" to "In your inbox ✓" without a manual refresh.
//
// The endpoint also UPDATEs the tiktok_publish_jobs row on every
// poll so the next page load can render the latest state
// without re-hitting TikTok (the job ledger becomes the source
// of truth between polls).
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { tiktokPublishJobs } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import {
  getValidAccessToken,
  fetchPublishStatus,
  TikTokAuthError,
} from '@/lib/tiktok/client';

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const publishId = url.searchParams.get('publishId');
  if (!publishId) {
    return NextResponse.json(
      { error: 'publishId required' },
      { status: 400 },
    );
  }

  // Ownership check + ledger fetch.
  const [job] = await db
    .select()
    .from(tiktokPublishJobs)
    .where(
      and(
        eq(tiktokPublishJobs.publishId, publishId),
        eq(tiktokPublishJobs.userId, user.id),
      ),
    )
    .limit(1);
  if (!job) {
    return NextResponse.json(
      { error: 'Publish job not found' },
      { status: 404 },
    );
  }

  // Short-circuit on terminal states — no point re-hitting
  // TikTok once we've already seen SEND_TO_USER_INBOX /
  // PUBLISH_COMPLETE / FAILED.
  if (
    job.status === 'SEND_TO_USER_INBOX' ||
    job.status === 'PUBLISH_COMPLETE' ||
    job.status === 'FAILED'
  ) {
    return NextResponse.json({
      publishId,
      status: job.status,
      failReason: job.errorMessage,
      terminal: true,
    });
  }

  let accessToken: string;
  try {
    const result = await getValidAccessToken(user.id);
    accessToken = result.accessToken;
  } catch (err) {
    if (err instanceof TikTokAuthError) {
      return NextResponse.json(
        { error: err.message, errorKind: err.code },
        { status: 401 },
      );
    }
    throw err;
  }

  let status: string;
  let failReason: string | null;
  try {
    const result = await fetchPublishStatus({ accessToken, publishId });
    status = result.status;
    failReason = result.failReason;
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'TikTok status fetch failed',
        errorKind: 'tiktok_status_failed',
      },
      { status: 502 },
    );
  }

  await db
    .update(tiktokPublishJobs)
    .set({
      status,
      errorMessage: failReason ?? (status === 'FAILED' ? 'FAILED' : null),
      updatedAt: new Date(),
    })
    .where(eq(tiktokPublishJobs.id, job.id));

  return NextResponse.json({
    publishId,
    status,
    failReason,
    terminal:
      status === 'SEND_TO_USER_INBOX' ||
      status === 'PUBLISH_COMPLETE' ||
      status === 'FAILED',
  });
}
