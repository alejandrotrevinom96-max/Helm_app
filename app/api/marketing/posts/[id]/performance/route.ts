// PR #51 — Sprint 6.8.2: /api/marketing/posts/[id]/performance.
//
// Performance rating endpoint that works on EITHER a draft
// (generated_posts row) OR a scheduled post (scheduled_posts
// row). The id space is uuid v4 — collisions across the two
// tables are astronomically unlikely, so we look up in
// scheduled_posts first (more common rate target), fall back
// to generated_posts.
//
// POST /api/marketing/posts/[id]/performance
// Body: { rating: 'worked' | 'flopped' | null, note?, metrics? }
//
// Ownership: transitive via project for drafts, direct via
// scheduledPosts.userId for scheduled. Both refuse with 403 if
// the post doesn't belong to the current user's projects.
//
// Sprint 6.8.1 already routes the Library PostDetailModal's
// PATCH to /api/marketing/library/[id] for scheduled posts;
// this endpoint is a parallel surface aligned with the
// /api/marketing/posts/[id]/vote convention so callers under
// the marketing/posts/* namespace are consistent. Both write
// paths are valid — pick whichever fits the caller's mental
// model.
import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  generatedPosts,
  projects,
  scheduledPosts,
} from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

const VALID_RATINGS = new Set<string>(['worked', 'flopped']);

interface MetricsShape {
  reach?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  impressions?: number;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function validateMetrics(input: unknown): MetricsShape | null | { error: string } {
  if (input == null) return null;
  if (!isPlainObject(input)) return { error: 'metrics must be an object' };
  const allowed = new Set(['reach', 'likes', 'comments', 'shares', 'impressions']);
  const out: MetricsShape = {};
  for (const [k, v] of Object.entries(input)) {
    if (!allowed.has(k)) {
      return { error: `metrics.${k} is not an allowed key` };
    }
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      return { error: `metrics.${k} must be a non-negative number` };
    }
    out[k as keyof MetricsShape] = v;
  }
  return out;
}

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
  const rating = body?.rating;
  const note = typeof body?.note === 'string' ? body.note.trim() : null;
  const metricsResult = validateMetrics(body?.metrics);

  // Rating: 'worked' | 'flopped' | null. null clears a previous
  // rating (lets the founder retract feedback).
  if (rating !== null && !VALID_RATINGS.has(rating)) {
    return NextResponse.json(
      {
        error:
          'rating must be "worked", "flopped", or null to clear.',
      },
      { status: 400 }
    );
  }
  if (metricsResult && 'error' in metricsResult) {
    return NextResponse.json({ error: metricsResult.error }, { status: 400 });
  }
  const metrics =
    metricsResult && !('error' in metricsResult) ? metricsResult : null;

  // 1) Look up in scheduled_posts first (more common rate
  // target). Ownership: scheduled_posts.userId === current user.
  const [sched] = await db
    .select({ id: scheduledPosts.id })
    .from(scheduledPosts)
    .where(
      and(eq(scheduledPosts.id, id), eq(scheduledPosts.userId, user.id))
    )
    .limit(1);

  if (sched) {
    // Map jsonb metrics → the 4 separate columns scheduled_posts
    // carries (legacy shape from the Library PATCH endpoint).
    const updated = await db
      .update(scheduledPosts)
      .set({
        performanceRating: rating ?? null,
        performanceNote: note,
        ratedAt: rating ? new Date() : null,
        metricsImpressions:
          metrics?.impressions ?? metrics?.reach ?? undefined,
        metricsLikes: metrics?.likes ?? undefined,
        metricsComments: metrics?.comments ?? undefined,
        metricsShares: metrics?.shares ?? undefined,
      })
      .where(eq(scheduledPosts.id, id))
      .returning({
        id: scheduledPosts.id,
        performanceRating: scheduledPosts.performanceRating,
        ratedAt: scheduledPosts.ratedAt,
      });

    if (updated.length === 0) {
      console.error('[PERFORMANCE] scheduled UPDATE 0 rows', {
        id,
        userId: user.id,
      });
      return NextResponse.json(
        { error: 'Could not save rating.' },
        { status: 500 }
      );
    }

    revalidatePath('/marketing/library');
    revalidatePath('/marketing/calendar');
    revalidatePath('/marketing/generate');

    return NextResponse.json({
      success: true,
      source: 'scheduled' as const,
      rating: updated[0].performanceRating,
      ratedAt: updated[0].ratedAt,
      rowsAffected: updated.length,
    });
  }

  // 2) Fall back to generated_posts (drafts). Ownership is
  // transitive via projects.userId — same JOIN pattern the vote
  // endpoint uses (PR #42 / Sprint 6.7).
  const [draft] = await db
    .select({ id: generatedPosts.id })
    .from(generatedPosts)
    .innerJoin(projects, eq(projects.id, generatedPosts.projectId))
    .where(
      and(eq(generatedPosts.id, id), eq(projects.userId, user.id))
    )
    .limit(1);

  if (!draft) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 });
  }

  // Drafts use the jsonb performance_metrics column added in
  // Sprint 6.8.2 (mirror shape vs the 4-column scheduled split).
  const updated = await db
    .update(generatedPosts)
    .set({
      performanceRating: rating ?? null,
      performanceNote: note,
      performanceMetrics: metrics as never,
      performanceRatedAt: rating ? new Date() : null,
    })
    .where(eq(generatedPosts.id, id))
    .returning({
      id: generatedPosts.id,
      performanceRating: generatedPosts.performanceRating,
      performanceRatedAt: generatedPosts.performanceRatedAt,
    });

  if (updated.length === 0) {
    console.error('[PERFORMANCE] draft UPDATE 0 rows', {
      id,
      userId: user.id,
    });
    return NextResponse.json(
      { error: 'Could not save rating.' },
      { status: 500 }
    );
  }

  revalidatePath('/marketing/library');
  revalidatePath('/marketing/calendar');
  revalidatePath('/marketing/generate');

  return NextResponse.json({
    success: true,
    source: 'generated' as const,
    rating: updated[0].performanceRating,
    ratedAt: updated[0].performanceRatedAt,
    rowsAffected: updated.length,
  });
}
