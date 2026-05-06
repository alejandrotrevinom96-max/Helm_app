// PR #23 — Sprint 2.2.
//
// PATCH /api/marketing/library/[id]
//
// Lets the founder log post-publish feedback from the Library detail
// modal: rating (worked / flopped / not_sure), free-text notes, and 4
// optional manual metrics. Only applies to scheduled_posts (drafts have
// nothing to rate). Strictly scoped to user.id.
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { scheduledPosts } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';

const VALID_RATINGS = new Set(['worked', 'flopped', 'not_sure']);

// Coerce body input that should be a non-negative integer or null.
// Anything else (negative, NaN, string-of-junk, undefined) becomes null
// so we never write garbage.
function coerceMetric(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'string' ? Number(v) : (v as number);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

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
  const {
    performanceRating,
    performanceNote,
    metricsImpressions,
    metricsLikes,
    metricsComments,
    metricsShares,
  } = body as {
    performanceRating?: unknown;
    performanceNote?: unknown;
    metricsImpressions?: unknown;
    metricsLikes?: unknown;
    metricsComments?: unknown;
    metricsShares?: unknown;
  };

  // Validate rating: null clears, valid string sets, anything else 400s.
  let ratingValue: string | null = null;
  let setRating = false;
  if (performanceRating === null) {
    ratingValue = null;
    setRating = true;
  } else if (typeof performanceRating === 'string') {
    if (!VALID_RATINGS.has(performanceRating)) {
      return NextResponse.json(
        { error: `Invalid rating. Use: ${[...VALID_RATINGS].join(', ')}` },
        { status: 400 }
      );
    }
    ratingValue = performanceRating;
    setRating = true;
  }

  // Ownership check + existence — single combined query.
  const [post] = await db
    .select()
    .from(scheduledPosts)
    .where(
      and(eq(scheduledPosts.id, id), eq(scheduledPosts.userId, user.id))
    )
    .limit(1);
  if (!post) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Build the update patch piece by piece so undefined fields stay
  // untouched (PATCH semantics — sending only `metricsLikes` shouldn't
  // wipe `performanceNote`).
  const patch: Record<string, unknown> = {};
  if (setRating) {
    patch.performanceRating = ratingValue;
    patch.ratedAt = ratingValue ? new Date() : null;
  }
  if (typeof performanceNote === 'string') {
    patch.performanceNote = performanceNote.trim() || null;
  } else if (performanceNote === null) {
    patch.performanceNote = null;
  }
  if (metricsImpressions !== undefined)
    patch.metricsImpressions = coerceMetric(metricsImpressions);
  if (metricsLikes !== undefined)
    patch.metricsLikes = coerceMetric(metricsLikes);
  if (metricsComments !== undefined)
    patch.metricsComments = coerceMetric(metricsComments);
  if (metricsShares !== undefined)
    patch.metricsShares = coerceMetric(metricsShares);

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const [updated] = await db
    .update(scheduledPosts)
    .set(patch)
    .where(
      and(eq(scheduledPosts.id, id), eq(scheduledPosts.userId, user.id))
    )
    .returning();

  return NextResponse.json({ success: true, post: updated });
}
