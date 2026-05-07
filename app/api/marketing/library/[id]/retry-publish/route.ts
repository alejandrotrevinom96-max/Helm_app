// PR #29 — Sprint 5.1: Auto-posting Meta foundation.
//
// POST /api/marketing/library/[id]/retry-publish
//
// User-initiated immediate retry. Resets publishRetryCount so the
// post gets the full retry budget again, marks it 'publishing', and
// fires the publisher synchronously. The user sees the result in the
// modal without waiting for the next cron tick.
//
// Only applies to scheduled_posts rows owned by the caller.
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { scheduledPosts } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { publishPost } from '@/lib/meta/publisher';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [post] = await db
    .select()
    .from(scheduledPosts)
    .where(
      and(
        eq(scheduledPosts.id, id),
        eq(scheduledPosts.userId, user.id)
      )
    )
    .limit(1);
  if (!post) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Reset retry count for manual retry — user is signaling "try again
  // fresh, the original failure may have been a fluke".
  await db
    .update(scheduledPosts)
    .set({
      publishStatus: 'publishing',
      publishRetryCount: 0,
      publishNextRetryAt: null,
    })
    .where(eq(scheduledPosts.id, id));

  const result = await publishPost(id);

  if (result.success) {
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
      .where(eq(scheduledPosts.id, id));
    return NextResponse.json({
      success: true,
      permalink: result.permalink ?? null,
    });
  }

  await db
    .update(scheduledPosts)
    .set({
      publishStatus: 'failed',
      publishFailureReason: result.error ?? 'Unknown error',
      publishRetryCount: 1,
    })
    .where(eq(scheduledPosts.id, id));

  return NextResponse.json(
    { success: false, error: result.error ?? 'Publish failed' },
    { status: 500 }
  );
}
