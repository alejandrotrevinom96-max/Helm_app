// PR #77 — Sprint 7.4: Compass landing rebuilt as a dashboard of
// the five deep-dive features built in Sprints 7.1A–7.1E. The
// previous VC-style single-reading flow (CompassDial,
// DimensionBreakdown, BullCase/BearCase via InsightsThesis,
// ScoreHistory, RecommendationsList) is no longer wired through
// this page.
//
// IMPORTANT — what we KEPT on disk:
//   - app/(dashboard)/compass/client.tsx (legacy CompassClient)
//   - compass-dial.tsx, dimension-breakdown.tsx,
//     insights-thesis.tsx, recommendations-list.tsx,
//     score-history.tsx, compass-form-modal.tsx
//
// They're unused but compile clean. A revert that wants the VC
// compass back only has to touch this file. We did NOT move them
// into a `_legacy/` folder because the relative imports inside
// client.tsx ('./compass-dial', etc.) would break — the plan's
// recommendation to mv-then-prefix would have wrecked the build.
//
// All five summary fetches run in parallel via Promise.all so the
// landing renders as fast as the slowest single query.
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getActiveProject } from '@/lib/active-project';
import { db } from '@/lib/db';
import {
  positioningBenchmarks,
  competitors,
  priorityMatrices,
  priorityItems,
  compassTasks,
  compassBlindSpots,
  compassDecisions,
} from '@/lib/db/schema';
import { eq, and, gte, desc, asc, sql } from 'drizzle-orm';
import { CompassLandingClient } from './landing-client';
import { GlassCard } from '@/components/ui/glass-card';

export default async function CompassPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const project = await getActiveProject(user.id);
  if (!project) {
    return (
      <div className="p-6 md:p-10 max-w-3xl">
        <h1 className="font-display text-display-lg font-light tracking-tight mb-2">
          Compass
        </h1>
        <p className="text-text-2 mb-8">
          Strategic dashboard — Priority Matrix, Positioning Benchmark,
          Strategic Timeline, Blind Spots, Decision Log.
        </p>
        <GlassCard className="p-8 text-center">
          <p className="text-text-2">
            Creá un proyecto primero para ver tu Compass dashboard.
          </p>
        </GlassCard>
      </div>
    );
  }

  const now = new Date();
  const projectId = project.id;

  // Parallel fetches. Each is intentionally narrow:
  //   - benchmark: latest row
  //   - topCompetitor: highest-confidence approved competitor
  //   - matrixRow + matrix item counts: separate queries because
  //     items live in a different table (priority_items has FK to
  //     priority_matrices.id). Counted via a single GROUP BY query.
  //   - upcomingTasks: next 3 by scheduledFor
  //   - openBlindSpots: detected=true + userStatus='open'
  //   - recentDecisions: latest 3 by decidedAt
  const [
    benchmarkRow,
    topCompetitorRow,
    latestMatrix,
    upcomingTaskRows,
    openBlindSpotRows,
    recentDecisionRows,
  ] = await Promise.all([
    db
      .select({
        id: positioningBenchmarks.id,
        marketGap: positioningBenchmarks.marketGap,
        uniquePositioning: positioningBenchmarks.uniquePositioning,
        competitorsAnalyzed: positioningBenchmarks.competitorsAnalyzed,
        createdAt: positioningBenchmarks.createdAt,
      })
      .from(positioningBenchmarks)
      .where(eq(positioningBenchmarks.projectId, projectId))
      .orderBy(desc(positioningBenchmarks.createdAt))
      .limit(1),

    // Top competitor by name presence — used as a single-line hint
    // on the Positioning Benchmark card. Schema-loose: we pick the
    // most-recently-touched row that has a name. If there are no
    // approved competitors yet, the card just hides the line.
    db
      .select({
        id: competitors.id,
        name: competitors.name,
      })
      .from(competitors)
      .where(eq(competitors.projectId, projectId))
      .orderBy(desc(competitors.createdAt))
      .limit(1),

    db
      .select({
        id: priorityMatrices.id,
        createdAt: priorityMatrices.createdAt,
      })
      .from(priorityMatrices)
      .where(eq(priorityMatrices.projectId, projectId))
      .orderBy(desc(priorityMatrices.createdAt))
      .limit(1),

    db
      .select({
        id: compassTasks.id,
        title: compassTasks.title,
        scheduledFor: compassTasks.scheduledFor,
        status: compassTasks.status,
        taskType: compassTasks.taskType,
      })
      .from(compassTasks)
      .where(
        and(
          eq(compassTasks.projectId, projectId),
          gte(compassTasks.scheduledFor, now),
        ),
      )
      .orderBy(asc(compassTasks.scheduledFor))
      .limit(3),

    db
      .select({
        id: compassBlindSpots.id,
        title: compassBlindSpots.title,
        severity: compassBlindSpots.severity,
        framework: compassBlindSpots.framework,
        detected: compassBlindSpots.detected,
        userStatus: compassBlindSpots.userStatus,
      })
      .from(compassBlindSpots)
      .where(
        and(
          eq(compassBlindSpots.projectId, projectId),
          eq(compassBlindSpots.detected, true),
          eq(compassBlindSpots.userStatus, 'open'),
        ),
      )
      .orderBy(desc(compassBlindSpots.confidenceScore))
      .limit(5),

    db
      .select({
        id: compassDecisions.id,
        title: compassDecisions.title,
        category: compassDecisions.category,
        alignmentScore: compassDecisions.alignmentScore,
        decidedAt: compassDecisions.decidedAt,
        status: compassDecisions.status,
      })
      .from(compassDecisions)
      .where(eq(compassDecisions.projectId, projectId))
      .orderBy(desc(compassDecisions.decidedAt))
      .limit(3),
  ]);

  // Quadrant counts for the Priority Matrix card. We GROUP BY in
  // one round-trip rather than 4 separate counts. Only runs when
  // there's actually a matrix.
  let matrixSummary: {
    id: string;
    createdAt: string | null;
    total: number;
    doNow: number;
    scheduled: number;
    fillers: number;
    avoid: number;
  } | null = null;
  if (latestMatrix[0]) {
    const rows = await db
      .select({
        quadrant: priorityItems.quadrant,
        count: sql<number>`count(*)::int`,
      })
      .from(priorityItems)
      .where(eq(priorityItems.matrixId, latestMatrix[0].id))
      .groupBy(priorityItems.quadrant);

    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.quadrant] = Number(r.count) || 0;
    matrixSummary = {
      id: latestMatrix[0].id,
      createdAt:
        latestMatrix[0].createdAt instanceof Date
          ? latestMatrix[0].createdAt.toISOString()
          : null,
      total: rows.reduce((a, r) => a + (Number(r.count) || 0), 0),
      doNow: counts.do_now ?? 0,
      scheduled: counts.scheduled ?? 0,
      fillers: counts.fillers ?? 0,
      avoid: counts.avoid ?? 0,
    };
  }

  // Stringify all timestamps before they cross the server→client
  // boundary — Date instances don't serialize cleanly through the
  // RSC payload.
  const benchmark = benchmarkRow[0]
    ? {
        id: benchmarkRow[0].id,
        marketGap: benchmarkRow[0].marketGap,
        uniquePositioning: benchmarkRow[0].uniquePositioning,
        competitorsAnalyzed: benchmarkRow[0].competitorsAnalyzed,
        createdAt:
          benchmarkRow[0].createdAt instanceof Date
            ? benchmarkRow[0].createdAt.toISOString()
            : null,
      }
    : null;

  const topCompetitor = topCompetitorRow[0]
    ? {
        id: topCompetitorRow[0].id,
        name: topCompetitorRow[0].name,
      }
    : null;

  const upcomingTasks = upcomingTaskRows.map((t) => ({
    id: t.id,
    title: t.title,
    scheduledFor:
      t.scheduledFor instanceof Date ? t.scheduledFor.toISOString() : null,
    status: t.status,
    taskType: t.taskType,
  }));

  const openBlindSpots = openBlindSpotRows.map((s) => ({
    id: s.id,
    title: s.title,
    severity: s.severity,
    framework: s.framework,
    detected: s.detected,
    userStatus: s.userStatus,
  }));

  const recentDecisions = recentDecisionRows.map((d) => ({
    id: d.id,
    title: d.title,
    category: d.category,
    alignmentScore: d.alignmentScore,
    decidedAt:
      d.decidedAt instanceof Date ? d.decidedAt.toISOString() : null,
    status: d.status,
  }));

  return (
    <CompassLandingClient
      project={{ id: project.id, name: project.name }}
      benchmark={benchmark}
      topCompetitor={topCompetitor}
      matrix={matrixSummary}
      upcomingTasks={upcomingTasks}
      openBlindSpots={openBlindSpots}
      recentDecisions={recentDecisions}
    />
  );
}
