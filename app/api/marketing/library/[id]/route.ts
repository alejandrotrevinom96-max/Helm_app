// PR #23 — Sprint 2.2 (PATCH for feedback).
// PR #24 — Sprint 2.3 extends PATCH with scheduledFor (used by Calendar
// drag-drop) and adds DELETE for permanent removal.
//
// PATCH  /api/marketing/library/[id]?source=scheduled|generated
// DELETE /api/marketing/library/[id]?source=scheduled|generated
//
// `source` defaults to 'scheduled' (the only one PATCH originally
// supported, kept for back-compat with PR #23 callers). DELETE accepts
// both because the founder may want to nuke a draft from the Library
// view without first scheduling it.
//
// Strict scoping:
//   - scheduled_posts has user_id directly → eq(userId, user.id)
//   - generated_posts goes through projects.user_id (no direct user_id)
//
// Both branches return 404 on ownership mismatch so we don't leak the
// existence of someone else's post id.
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  generatedPosts,
  projects,
  scheduledPosts,
} from '@/lib/db/schema';
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

function parseSource(url: URL): 'scheduled' | 'generated' {
  return url.searchParams.get('source') === 'generated'
    ? 'generated'
    : 'scheduled';
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(request.url);
  const source = parseSource(url);

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
    scheduledFor,
  } = body as {
    performanceRating?: unknown;
    performanceNote?: unknown;
    metricsImpressions?: unknown;
    metricsLikes?: unknown;
    metricsComments?: unknown;
    metricsShares?: unknown;
    scheduledFor?: unknown;
  };

  // Drafts (generated_posts) don't have any of these fields — they only
  // store content + status. PATCH on a draft is a no-op for now; the
  // user route to "edit a draft" would be regenerate, not PATCH.
  if (source === 'generated') {
    return NextResponse.json(
      {
        error:
          'Drafts cannot be edited directly. Use clone, schedule, or delete.',
      },
      { status: 400 }
    );
  }

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

  // Validate scheduledFor: must parse to a real date if provided.
  let scheduledForDate: Date | null = null;
  let setScheduledFor = false;
  if (scheduledFor !== undefined) {
    if (typeof scheduledFor !== 'string') {
      return NextResponse.json(
        { error: 'scheduledFor must be an ISO timestamp string' },
        { status: 400 }
      );
    }
    const parsed = new Date(scheduledFor);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json(
        { error: 'scheduledFor is not a valid date' },
        { status: 400 }
      );
    }
    scheduledForDate = parsed;
    setScheduledFor = true;
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
  if (setScheduledFor && scheduledForDate) {
    // Reschedule resets a 'cancelled' post back to 'scheduled'. We don't
    // touch 'posted' rows — those have a publishedAt and changing the
    // schedule retroactively is misleading.
    if (post.status === 'posted') {
      return NextResponse.json(
        { error: 'Cannot reschedule a published post' },
        { status: 400 }
      );
    }
    patch.scheduledFor = scheduledForDate;
    if (post.status === 'cancelled') patch.status = 'scheduled';
  }

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

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(request.url);
  const source = parseSource(url);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (source === 'scheduled') {
    // Direct user_id check — no join needed.
    const result = await db
      .delete(scheduledPosts)
      .where(
        and(
          eq(scheduledPosts.id, id),
          eq(scheduledPosts.userId, user.id)
        )
      )
      .returning({ id: scheduledPosts.id });
    if (result.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  }

  // generated_posts has no user_id — verify ownership through the
  // parent project. We can't do a single-statement delete-with-join in
  // drizzle for postgres, so we read first to confirm ownership, then
  // delete by id.
  const [draft] = await db
    .select({ id: generatedPosts.id })
    .from(generatedPosts)
    .innerJoin(projects, eq(projects.id, generatedPosts.projectId))
    .where(
      and(eq(generatedPosts.id, id), eq(projects.userId, user.id))
    )
    .limit(1);
  if (!draft) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  await db.delete(generatedPosts).where(eq(generatedPosts.id, id));
  return NextResponse.json({ success: true });
}
