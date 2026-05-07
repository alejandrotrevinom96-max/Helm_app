// PR #27 — Sprint 4: Image validation loop.
//
// PATCH /api/brand-bible/validation-images/[id]
//
// Records (or clears) the user's vote on a single validation image.
// Body: { vote: 'positive' | 'negative' | null, voteReason?: string }
//
// Why null is allowed: lets the user retract a previous vote
// without deleting the row. Keeps cost data + image URL intact for
// the future re-generation pass that learns from votes.
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { brandImageValidations } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';

const VALID_VOTES = new Set(['positive', 'negative']);

export async function PATCH(
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
  const { vote, voteReason } = body as {
    vote?: unknown;
    voteReason?: unknown;
  };

  let voteValue: string | null = null;
  if (vote === null) {
    voteValue = null;
  } else if (typeof vote === 'string' && VALID_VOTES.has(vote)) {
    voteValue = vote;
  } else {
    return NextResponse.json(
      { error: "vote must be 'positive', 'negative', or null" },
      { status: 400 }
    );
  }

  // Validate ownership + existence in one query.
  const [image] = await db
    .select()
    .from(brandImageValidations)
    .where(
      and(
        eq(brandImageValidations.id, id),
        eq(brandImageValidations.userId, user.id)
      )
    )
    .limit(1);
  if (!image) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const reason =
    typeof voteReason === 'string' && voteReason.trim().length > 0
      ? voteReason.trim()
      : null;

  const [updated] = await db
    .update(brandImageValidations)
    .set({
      vote: voteValue,
      voteReason: reason,
      // Clear votedAt when vote becomes null so the row reads "no
      // vote" cleanly downstream.
      votedAt: voteValue ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(brandImageValidations.id, id),
        eq(brandImageValidations.userId, user.id)
      )
    )
    .returning();

  return NextResponse.json({ success: true, image: updated });
}
