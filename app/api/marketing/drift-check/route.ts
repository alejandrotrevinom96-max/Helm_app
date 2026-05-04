import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { scheduledPosts } from '@/lib/db/schema';
import { eq, desc, and, isNotNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import type { ScoreBreakdown } from '@/lib/ai/consistency-score';

const DRIFT_TOTAL_THRESHOLD = 75;
const DRIFT_DIMENSION_THRESHOLD = 6;
const MIN_POSTS_FOR_DRIFT = 5;

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // projectId is currently optional — we filter by user only because a
  // founder's brand drift is per-user, not per-project. We accept the param
  // for forward-compat with multi-project filtering.
  const { searchParams } = new URL(request.url);
  void searchParams.get('projectId');

  const recent = await db
    .select({
      id: scheduledPosts.id,
      content: scheduledPosts.content,
      consistencyScore: scheduledPosts.consistencyScore,
      scoreBreakdown: scheduledPosts.scoreBreakdown,
      createdAt: scheduledPosts.createdAt,
    })
    .from(scheduledPosts)
    .where(
      and(
        eq(scheduledPosts.userId, user.id),
        isNotNull(scheduledPosts.consistencyScore)
      )
    )
    .orderBy(desc(scheduledPosts.createdAt))
    .limit(10);

  if (recent.length < MIN_POSTS_FOR_DRIFT) {
    return NextResponse.json({
      sufficient: false,
      driftDetected: false,
      hint: `Need at least ${MIN_POSTS_FOR_DRIFT} scored posts to detect drift. You have ${recent.length}.`,
      postsAnalyzed: recent.length,
    });
  }

  const lastFive = recent.slice(0, MIN_POSTS_FOR_DRIFT);
  const avgScore = Math.round(
    lastFive.reduce((sum, p) => sum + (p.consistencyScore ?? 0), 0) /
      lastFive.length
  );

  const dimensionsAvg: ScoreBreakdown = {
    voice: 0,
    vocabulary: 0,
    nonNegotiables: 0,
    pillarAlignment: 0,
    audienceResonance: 0,
  };

  for (const post of lastFive) {
    const bd = post.scoreBreakdown as ScoreBreakdown | null;
    if (!bd) continue;
    dimensionsAvg.voice += bd.voice ?? 0;
    dimensionsAvg.vocabulary += bd.vocabulary ?? 0;
    dimensionsAvg.nonNegotiables += bd.nonNegotiables ?? 0;
    dimensionsAvg.pillarAlignment += bd.pillarAlignment ?? 0;
    dimensionsAvg.audienceResonance += bd.audienceResonance ?? 0;
  }
  (Object.keys(dimensionsAvg) as Array<keyof ScoreBreakdown>).forEach((k) => {
    dimensionsAvg[k] = Math.round((dimensionsAvg[k] / lastFive.length) * 10) / 10;
  });

  const weakestEntry = (
    Object.entries(dimensionsAvg) as Array<[keyof ScoreBreakdown, number]>
  ).sort((a, b) => a[1] - b[1])[0];

  const driftDetected =
    avgScore < DRIFT_TOTAL_THRESHOLD ||
    weakestEntry[1] < DRIFT_DIMENSION_THRESHOLD;

  return NextResponse.json({
    sufficient: true,
    averageScore: avgScore,
    dimensionsAvg,
    weakestDimension: { name: weakestEntry[0], score: weakestEntry[1] },
    driftDetected,
    postsAnalyzed: lastFive.length,
    recommendations: driftDetected
      ? [
          `Your average consistency score is ${avgScore}/100`,
          `Weakest dimension: ${weakestEntry[0]} (${weakestEntry[1]}/10)`,
          avgScore < 60
            ? 'Consider revisiting your brand bible — your posts may be drifting'
            : 'Generate more posts using a single pillar focus to re-anchor',
        ]
      : [],
  });
}
