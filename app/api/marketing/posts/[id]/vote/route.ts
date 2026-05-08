// PR #42 — Sprint 6.7: per-draft voting.
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

  await db
    .update(generatedPosts)
    .set({
      userVote: vote,
      votedAt: new Date(),
      // Disliked drafts hide from Library + drafts pool. Re-liking
      // a previously-disliked draft brings it back.
      visibleInLibrary: vote === 'liked',
    })
    .where(eq(generatedPosts.id, id));

  return NextResponse.json({
    success: true,
    vote,
    visibleInLibrary: vote === 'liked',
  });
}
