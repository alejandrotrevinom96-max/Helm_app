// PR #51 — Sprint 6.8.2: /api/marketing/posts/[id]/performance.
// PR #52 — Sprint 6.8.3: rate-ability validation.
//
// Performance rating endpoint for scheduled posts. The id must
// belong to a scheduled_posts row that has either been
// published OR has a scheduledFor timestamp in the past — i.e.
// the founder has had time to observe how the post actually
// performed. Drafts (generated_posts rows) and future-scheduled
// posts are refused with 400 + an explanatory error.
//
// POST /api/marketing/posts/[id]/performance
// Body: { rating: 'worked' | 'flopped' | null, note?, metrics? }
//
// Ownership: scheduledPosts.userId === current user. Drafts
// looked up via projects ownership only to produce a useful
// 400 error message instead of a confusing 404 (so the founder
// learns WHY drafts can't be rated).
//
// Sprint 6.8.2 originally accepted drafts and wrote to
// generated_posts.performance_*. That was the wrong call:
// performance is a post-fact assessment of how content
// resonated, and drafts are pre-fact. The Library + Insights
// surfaces only count scheduled performance anyway, so writes
// to drafts were invisible to the founder ("rating doesn't
// persist!"). PR #52 corrects the contract.
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
import sanitizeHtml from 'sanitize-html';

// PR #55 — Sprint 6.9: same XSS strip as the quotes endpoints.
// performanceNote is shown in the Library modal AND re-fed into
// the Generate prompt's performance context (Sprint 6.8) — an
// unsanitized payload is a prompt-injection vector on top of
// the browser-XSS risk.
function sanitizeNote(input: unknown): string {
  if (typeof input !== 'string') return '';
  return sanitizeHtml(input, {
    allowedTags: [],
    allowedAttributes: {},
    disallowedTagsMode: 'discard',
  }).trim();
}

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
  // PR #55 — Sprint 6.9: strip HTML from the note before
  // persisting. Empty string after sanitize → null in DB.
  const cleanNote = sanitizeNote(body?.note);
  const note = cleanNote || null;
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

  // 1) Look up in scheduled_posts. We pull the lifecycle
  // timestamps too so we can validate the post is actually
  // rate-able (past-scheduled or published).
  const [sched] = await db
    .select({
      id: scheduledPosts.id,
      scheduledFor: scheduledPosts.scheduledFor,
      publishedAt: scheduledPosts.publishedAt,
      postedAt: scheduledPosts.postedAt,
    })
    .from(scheduledPosts)
    .where(
      and(eq(scheduledPosts.id, id), eq(scheduledPosts.userId, user.id))
    )
    .limit(1);

  if (sched) {
    // PR #52 — Sprint 6.8.3: only allow rating a post that has
    // actually happened (or whose scheduled time has passed —
    // even if Meta auto-publish is blocked / disabled, the
    // founder will have shared it manually by then). Future-
    // scheduled posts and never-fired drafts can't carry a
    // performance signal yet.
    const now = new Date();
    const scheduledForDate = sched.scheduledFor
      ? new Date(sched.scheduledFor)
      : null;
    const isPastScheduled =
      scheduledForDate !== null && scheduledForDate <= now;
    const isPublished =
      sched.publishedAt !== null || sched.postedAt !== null;

    if (rating !== null && !isPastScheduled && !isPublished) {
      return NextResponse.json(
        {
          error:
            'Cannot rate a post that hasn’t happened yet. Wait until its scheduled time has passed (or you’ve shared it), then rate.',
          scheduledFor: sched.scheduledFor,
        },
        { status: 400 }
      );
    }

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

  // 2) Not in scheduled_posts. Check whether it's a draft —
  // if so, produce a useful error message; otherwise 404.
  // PR #52 — Sprint 6.8.3: drafts can NOT be rated. Performance
  // is a post-fact reality check, not a pre-publish guess.
  const [draft] = await db
    .select({ id: generatedPosts.id, status: generatedPosts.status })
    .from(generatedPosts)
    .innerJoin(projects, eq(projects.id, generatedPosts.projectId))
    .where(
      and(eq(generatedPosts.id, id), eq(projects.userId, user.id))
    )
    .limit(1);

  if (draft) {
    return NextResponse.json(
      {
        error:
          'Drafts can’t be rated. Schedule this draft first, then rate it after the scheduled time has passed.',
        currentStatus: draft.status,
      },
      { status: 400 }
    );
  }

  return NextResponse.json({ error: 'Post not found' }, { status: 404 });
}
