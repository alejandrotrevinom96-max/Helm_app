// PR #67 — Sprint 7.1A: server-component shell for the Compass
// Positioning Benchmark page. Resolves the active project + initial
// competitor list + last cached benchmark, then hands off to the
// client. Matches the Compass/Research/Marketing convention.
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getActiveProject } from '@/lib/active-project';
import { db } from '@/lib/db';
import {
  competitors,
  positioningBenchmarks,
  brandAnalysis,
} from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { CompetitorsClient } from './client';

export default async function CompetitorsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const project = await getActiveProject(user.id);
  if (!project) redirect('/onboarding');

  // Initial competitors list (avoids a client roundtrip on mount).
  const competitorRows = await db
    .select()
    .from(competitors)
    .where(eq(competitors.projectId, project.id))
    .orderBy(desc(competitors.confidenceScore));

  // Latest benchmark, if any (expired ones still get hydrated so
  // the founder sees the previous output while regenerating).
  const [benchmark] = await db
    .select()
    .from(positioningBenchmarks)
    .where(eq(positioningBenchmarks.projectId, project.id))
    .orderBy(desc(positioningBenchmarks.createdAt))
    .limit(1);

  // Has-analysis flag — the detect endpoint requires a brand
  // analysis row, so we surface the gap upfront instead of waiting
  // for a 400 on the first detect click.
  const [analysis] = await db
    .select({ id: brandAnalysis.id })
    .from(brandAnalysis)
    .where(eq(brandAnalysis.projectId, project.id))
    .orderBy(desc(brandAnalysis.createdAt))
    .limit(1);

  return (
    <CompetitorsClient
      project={{ id: project.id, name: project.name }}
      initialCompetitors={competitorRows.map((c) => ({
        id: c.id,
        name: c.name,
        url: c.url,
        type: c.type,
        confidenceScore: c.confidenceScore,
        approvedByUser: c.approvedByUser,
        scrapeStatus: c.scrapeStatus,
        scrapeError: c.scrapeError,
        positioningSummary: c.positioningSummary,
        headline: c.headline,
        valueProp: c.valueProp,
        contentAngles: c.contentAngles as string[] | null,
        detectedBy: c.detectedBy,
      }))}
      initialBenchmark={
        benchmark
          ? {
              id: benchmark.id,
              marketGap: benchmark.marketGap,
              uniquePositioning: benchmark.uniquePositioning,
              opportunities: benchmark.opportunitiesAccionable,
              defensiveWeaknesses: benchmark.defensiveWeaknesses,
              comparisonDimensions: benchmark.comparisonDimensions,
              competitorsAnalyzed: benchmark.competitorsAnalyzed,
              expiresAt: benchmark.expiresAt?.toISOString() ?? null,
              createdAt: benchmark.createdAt.toISOString(),
            }
          : null
      }
      hasBrandAnalysis={Boolean(analysis)}
    />
  );
}
