import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { scheduledPosts, projects } from '@/lib/db/schema';
import { eq, desc, and, isNotNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import type { ScoreBreakdown } from '@/lib/ai/consistency-score';
import type { BrandBible } from '@/lib/types/brand';
import { detectPillarsInPost } from '@/lib/ai/pillar-detection';

const DRIFT_TOTAL_THRESHOLD = 75;
const DRIFT_DIMENSION_THRESHOLD = 6;
const MIN_POSTS_FOR_DRIFT = 5;
// A pillar is "drifting" when its appearance rate is more than 30 percentage
// points below what its weight would predict. Calibrated empirically — too
// strict and every pillar triggers; too lax and real drift stays invisible.
const PILLAR_DRIFT_THRESHOLD = 30;

interface PillarCoverage {
  pillar: string;
  weight: number;
  appearanceRate: number;
  expectedRate: number;
  gap: number;
  drifting: boolean;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('projectId');

  const recent = await db
    .select({
      id: scheduledPosts.id,
      content: scheduledPosts.content,
      projectId: scheduledPosts.projectId,
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
      pillarDriftDetected: false,
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

  const aggregateDriftDetected =
    avgScore < DRIFT_TOTAL_THRESHOLD ||
    weakestEntry[1] < DRIFT_DIMENSION_THRESHOLD;

  // Per-pillar coverage analysis. Requires a brand bible with pillars; if
  // there's no project context or no pillars, we skip this section but
  // still return the aggregate drift result.
  let pillarCoverage: PillarCoverage[] = [];
  let pillarDriftDetected = false;

  // Pick the project to evaluate against. If a projectId was passed, use
  // that; otherwise pick the project the most recent post belongs to.
  let targetProjectId: string | null = projectId;
  if (!targetProjectId && lastFive.length > 0) {
    targetProjectId = lastFive[0].projectId;
  }

  if (targetProjectId) {
    const [project] = await db
      .select({ brandContext: projects.brandContext })
      .from(projects)
      .where(
        and(eq(projects.id, targetProjectId), eq(projects.userId, user.id))
      )
      .limit(1);

    const bible = (project?.brandContext as BrandBible | null) ?? null;
    const pillars = bible?.pillars ?? [];

    if (pillars.length > 0) {
      // Run pillar detection across the 5 posts in parallel. Each call
      // does a keyword pass first (cheap) and only hits Haiku when the
      // keyword pass is incomplete.
      const matchesPerPost = await Promise.all(
        lastFive.map((post) =>
          detectPillarsInPost(
            post.content,
            pillars.map((p) => ({ name: p.name, description: p.description }))
          )
        )
      );

      // Sum weights so we can compute relative "expected appearance rate"
      // per pillar — a 50-weight pillar in a bible with two 50-weight
      // pillars is expected ~50% of the time.
      const totalWeight = pillars.reduce((s, p) => s + (p.weight ?? 0), 0);

      pillarCoverage = pillars.map((p) => {
        const matchedCount = matchesPerPost.filter((postMatches) =>
          postMatches.some(
            (m) =>
              m.pillarName.toLowerCase() === p.name.toLowerCase() && m.matched
          )
        ).length;
        const appearanceRate = Math.round(
          (matchedCount / lastFive.length) * 100
        );
        const expectedRate =
          totalWeight > 0
            ? Math.round(((p.weight ?? 0) / totalWeight) * 100)
            : Math.round(100 / pillars.length);
        const gap = expectedRate - appearanceRate;
        return {
          pillar: p.name,
          weight: p.weight ?? 0,
          appearanceRate,
          expectedRate,
          gap,
          drifting: gap > PILLAR_DRIFT_THRESHOLD,
        };
      });

      pillarDriftDetected = pillarCoverage.some((p) => p.drifting);
    }
  }

  const driftDetected = aggregateDriftDetected || pillarDriftDetected;

  const recommendations: string[] = [];
  if (aggregateDriftDetected) {
    recommendations.push(`Your average consistency score is ${avgScore}/100`);
    recommendations.push(
      `Weakest dimension: ${weakestEntry[0]} (${weakestEntry[1]}/10)`
    );
    recommendations.push(
      avgScore < 60
        ? 'Consider revisiting your brand bible — your posts may be drifting'
        : 'Generate more posts using a single pillar focus to re-anchor'
    );
  }
  if (pillarDriftDetected) {
    const driftingPillars = pillarCoverage
      .filter((p) => p.drifting)
      .map((p) => p.pillar)
      .join(', ');
    recommendations.push(
      `Pillars under-represented: ${driftingPillars}. Generate posts that lean into them.`
    );
  }

  return NextResponse.json({
    sufficient: true,
    averageScore: avgScore,
    dimensionsAvg,
    weakestDimension: { name: weakestEntry[0], score: weakestEntry[1] },
    driftDetected,
    pillarDriftDetected,
    pillarCoverage,
    postsAnalyzed: lastFive.length,
    recommendations,
  });
}
