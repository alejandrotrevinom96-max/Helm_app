// PR #42 — Sprint 6.7: per-draft voting.
// PR #48 — Sprint 6.7.6: harden the UPDATE so silent failures
// can't masquerade as 200 OK. Pre-PR-48 the route was fire-
// and-forget (`.update(...).set(...).where(...)` with no
// `.returning()`); a 0-row UPDATE returned success to the
// client, the founder saw the optimistic vote toggle, but
// `user_vote` stayed null in the DB. Reload erased the vote
// → "el like no persiste". Now we read back the affected rows,
// 500 + log diagnostics if the count is zero, and the response
// echoes the persisted state so the client can sanity-check.
//
// POST /api/marketing/posts/[id]/vote
// Body: { vote: 'liked' | 'disliked' }
//
// Flips the user's vote on a generated draft. Liked drafts stay
// visible in Library and the calendar drafts pool; disliked
// drafts get visibleInLibrary=false (soft-delete) so they
// disappear from the user's view but stay in the table for
// future fine-tuning / reversibility.
//
// Auth: must own the project the draft belongs to. Drafts have
// project_id (not user_id directly), so we join through projects.
import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { generatedPosts, projects } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const vote = body?.vote;

  if (vote !== 'liked' && vote !== 'disliked') {
    return NextResponse.json(
      { error: 'Invalid vote. Expected "liked" or "disliked".' },
      { status: 400 }
    );
  }

  // Ownership: join generated_posts → projects and require
  // projects.user_id = current user. We can't filter directly on
  // generatedPosts.userId because the column doesn't exist (drafts
  // are scoped to a project, not a user, mirroring how the rest of
  // the marketing tables are organized).
  const [draft] = await db
    .select({
      id: generatedPosts.id,
      currentVote: generatedPosts.userVote,
    })
    .from(generatedPosts)
    .innerJoin(projects, eq(projects.id, generatedPosts.projectId))
    .where(and(eq(generatedPosts.id, id), eq(projects.userId, user.id)))
    .limit(1);

  if (!draft) {
    // Either not found or not owned — same response for both so we
    // don't leak existence of foreign drafts.
    return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  }

  // PR #48 — Sprint 6.7.6: read back the affected rows so we
  // can detect a silent 0-row UPDATE. If the previous SELECT
  // located the row, this should always affect 1 row; logging
  // a zero would point to a column-name / Drizzle-mapping
  // mismatch we'd never spot otherwise.
  const updated = await db
    .update(generatedPosts)
    .set({
      userVote: vote,
      votedAt: new Date(),
      // Disliked drafts hide from Library + drafts pool. Re-liking
      // a previously-disliked draft brings it back.
      visibleInLibrary: vote === 'liked',
    })
    .where(eq(generatedPosts.id, id))
    .returning({
      id: generatedPosts.id,
      userVote: generatedPosts.userVote,
      votedAt: generatedPosts.votedAt,
      visibleInLibrary: generatedPosts.visibleInLibrary,
    });

  if (updated.length === 0) {
    console.error('[VOTE] UPDATE affected 0 rows', {
      draftId: id,
      userId: user.id,
      vote,
    });
    return NextResponse.json(
      { error: 'Vote could not be saved. Please retry.' },
      { status: 500 }
    );
  }

  // PR #46 — Sprint 6.7.4: server-side cache invalidation. Pairs
  // with the client-side router.refresh() in MarketingClient as
  // defense in depth — revalidatePath drops the per-route data
  // cache so even users who land via a fresh page load (no
  // Router Cache hit) get the fresh count after a vote.
  revalidatePath('/marketing/library');
  revalidatePath('/marketing/calendar');
  revalidatePath('/marketing/generate');

  // PR #48 — return the persisted values so the client can
  // verify the round-trip without an extra read. If the founder
  // ever sees a Like that "doesn't stick" again, this gives QA
  // a single response to point at.
  return NextResponse.json({
    success: true,
    vote: updated[0].userVote,
    votedAt: updated[0].votedAt,
    visibleInLibrary: updated[0].visibleInLibrary,
    rowsAffected: updated.length,
  });
}
