// PR #24 — Sprint 2.3.
//
// POST /api/marketing/library/[id]/move-to-draft
//
// Moves a scheduled_posts row back to drafts. Implementation detail:
// our schema has TWO tables (generated_posts for drafts, scheduled_posts
// for everything with a date), so "move to draft" actually means
// "insert a new generated_posts row with the same content + delete the
// scheduled_posts row" — not a status flip.
//
// Why a real move (not soft-toggle): generated_posts has no userId,
// no scheduledFor, no metrics. Trying to flip status='draft' on
// scheduled_posts would leave a row that's still "scheduled" semantically
// (still has scheduledFor, still has visualUrl) and confuses the
// Library UNION query.
//
// Only applies to scheduled_posts. Drafts are already drafts. Published
// posts can't be moved back (founder feedback / metrics would be lost).
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { generatedPosts, scheduledPosts } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';

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

  // Confirm ownership + read the source row.
  const [src] = await db
    .select()
    .from(scheduledPosts)
    .where(
      and(eq(scheduledPosts.id, id), eq(scheduledPosts.userId, user.id))
    )
    .limit(1);
  if (!src) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (src.status === 'posted' || src.status === 'notified') {
    // Published / notified posts have history we don't want to discard.
    return NextResponse.json(
      {
        error:
          'Cannot move a published post back to drafts. Use clone instead to remix it.',
      },
      { status: 400 }
    );
  }

  // Insert into generated_posts. We DON'T copy visualUrl because the
  // generated_posts table has no visual column — the user would need
  // to regenerate the visual when scheduling again. Storing the prompt
  // = '(restored from schedule)' makes it clear in the Drafts list
  // where this came from.
  const [newDraft] = await db
    .insert(generatedPosts)
    .values({
      projectId: src.projectId,
      platform: src.platform,
      content: src.content,
      prompt: '(restored from schedule)',
      status: 'draft',
      // PR #23 added cloned_from_id for "Clone & remix"; we reuse it
      // here so the founder can audit "this draft was originally a
      // scheduled post (id=…)".
      clonedFromId: src.id,
    })
    .returning();

  // Delete the scheduled row last so a partial failure doesn't lose
  // the data. (Postgres single-statement transaction would be ideal but
  // drizzle's batch helper is sqlite-only; the failure mode here is a
  // duplicate draft, which is recoverable.)
  await db.delete(scheduledPosts).where(eq(scheduledPosts.id, id));

  return NextResponse.json({
    success: true,
    draft: {
      id: newDraft.id,
      content: newDraft.content,
      platform: newDraft.platform,
      projectId: newDraft.projectId,
    },
  });
}
