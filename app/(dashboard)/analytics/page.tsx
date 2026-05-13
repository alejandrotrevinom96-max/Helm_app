// PR #83 — Sprint 7.8: regrouped analytics page.
//
// Top-down structure:
//   1. Page header + scope toggle (UNCHANGED — see PR #18; the
//      ALL PROJECTS / THIS PROJECT toggle remains untouched per
//      this sprint's hard constraint).
//   2. <InsightsStrip /> — AI-generated 2-3 actionable items.
//      Loads client-side with a skeleton; silent fail on error.
//   3. <AnalyticsClient /> — KPIs in 4 groups (Growth / Content
//      performance / Engagement / Monetization). The KPIs that
//      used to live in HelmActivitySection are folded INTO those
//      groups now, so HelmActivitySection is no longer rendered.
//
// `app/(dashboard)/analytics/helm-activity-section.tsx` stays on
// disk for revert safety but is dead code. Tree-shaking drops it
// from the bundle.
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { integrations, metricSnapshots, projects } from '@/lib/db/schema';
import { eq, and, gte, desc, inArray, sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getActiveProject } from '@/lib/active-project';
import { AnalyticsClient } from './client';
import { getDashboardData } from '@/lib/analytics/dashboard';
import { GlassCard } from '@/components/ui/glass-card';
import { InsightsStrip } from '@/components/analytics/insights-strip';
import type { MetricSnapshot } from '@/lib/db/schema';

type Scope = 'project' | 'global';

function parseScope(value: string | string[] | undefined): Scope {
  return value === 'global' ? 'global' : 'project';
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string | string[] }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const params = await searchParams;
  const scope = parseScope(params.scope);

  const project = await getActiveProject(user.id);

  const dashboard = await getDashboardData({
    scope,
    projectId: scope === 'project' ? project?.id : undefined,
  });
  if ('error' in dashboard) redirect('/login');

  let snapshots: MetricSnapshot[] = [];
  let lastSyncAt: Date | null = null;
  let hasMappings = false;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const since = thirtyDaysAgo.toISOString().split('T')[0];

  if (scope === 'project' && project) {
    snapshots = await db
      .select()
      .from(metricSnapshots)
      .where(
        and(
          eq(metricSnapshots.projectId, project.id),
          gte(metricSnapshots.date, since),
        ),
      )
      .orderBy(desc(metricSnapshots.date));

    const [latestSync] = await db
      .select({ syncedAt: metricSnapshots.syncedAt })
      .from(metricSnapshots)
      .where(eq(metricSnapshots.projectId, project.id))
      .orderBy(desc(metricSnapshots.syncedAt))
      .limit(1);
    lastSyncAt = latestSync?.syncedAt ?? null;

    hasMappings = !!(
      project.vercelProjectId ||
      project.supabaseProjectRef ||
      project.metaAdAccountId
    );
  } else if (scope === 'global') {
    const userProjects = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.userId, user.id));
    const ids = userProjects.map((p) => p.id);
    if (ids.length > 0) {
      snapshots = await db
        .select()
        .from(metricSnapshots)
        .where(
          and(
            inArray(metricSnapshots.projectId, ids),
            gte(metricSnapshots.date, since),
          ),
        )
        .orderBy(desc(metricSnapshots.date));

      const [latestSync] = await db
        .select({ syncedAt: metricSnapshots.syncedAt })
        .from(metricSnapshots)
        .where(inArray(metricSnapshots.projectId, ids))
        .orderBy(desc(metricSnapshots.syncedAt))
        .limit(1);
      lastSyncAt = latestSync?.syncedAt ?? null;

      const mappingCount = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(projects)
        .where(
          and(
            eq(projects.userId, user.id),
            sql`(${projects.vercelProjectId} IS NOT NULL OR ${projects.supabaseProjectRef} IS NOT NULL OR ${projects.metaAdAccountId} IS NOT NULL)`,
          ),
        );
      hasMappings = (mappingCount[0]?.n ?? 0) > 0;
    }
  }

  const connectedIntegrations = await db
    .select({ provider: integrations.provider })
    .from(integrations)
    .where(eq(integrations.userId, user.id));
  const connected = new Set(connectedIntegrations.map((i) => i.provider));
  const hasVercel = connected.has('vercel');
  const hasSupabase = connected.has('supabase');
  const hasMeta = connected.has('meta');
  // PR #83: Reddit is the second priority for the smart banner
  // (after Meta Ads). Same source-set semantics as the other
  // providers — present in `integrations.provider` iff connected.
  const hasReddit = connected.has('reddit');

  return (
    <div className="p-6 md:p-10 max-w-6xl">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4 mb-6">
        <div>
          <h1 className="font-display text-display-lg font-light tracking-tight mb-2">
            Analytics
          </h1>
          <p className="text-text-2">
            Real metrics from your stack — plus what you&apos;re doing in Helm.
          </p>
        </div>

        {/* Scope toggle — UNCHANGED. URL-driven so refresh and
            sharing keep the same view. This sprint explicitly
            does not touch this control. */}
        <div className="flex items-center gap-1 bg-bg-elev rounded-lg p-1 border border-border self-start">
          <Link
            href="/analytics?scope=project"
            scroll={false}
            className={`px-3 py-1.5 text-[10px] font-mono uppercase tracking-[0.1em] rounded-md transition-colors ${
              scope === 'project'
                ? 'bg-accent text-white'
                : 'text-text-3 hover:text-text-1'
            }`}
          >
            This project
          </Link>
          <Link
            href="/analytics?scope=global"
            scroll={false}
            className={`px-3 py-1.5 text-[10px] font-mono uppercase tracking-[0.1em] rounded-md transition-colors ${
              scope === 'global'
                ? 'bg-accent text-white'
                : 'text-text-3 hover:text-text-1'
            }`}
          >
            All projects
          </Link>
        </div>
      </div>

      <InsightsStrip />

      {scope === 'project' && !project ? (
        <GlassCard className="p-8 text-center">
          <p className="text-text-2 mb-2">
            No project selected. Switch to All projects or create one to see
            analytics.
          </p>
          <Link
            href="/integrations"
            className="text-accent hover:underline text-sm"
          >
            Open Integrations →
          </Link>
        </GlassCard>
      ) : (
        <AnalyticsClient
          project={
            scope === 'project' && project
              ? project
              : { id: 'all', name: 'All projects' }
          }
          snapshots={snapshots}
          hasVercel={hasVercel}
          hasSupabase={hasSupabase}
          hasMeta={hasMeta}
          hasReddit={hasReddit}
          lastSyncAt={lastSyncAt}
          hasMappings={hasMappings}
          scope={scope}
          totalSignups={dashboard.totalSignups}
          postsPublished={dashboard.postsPublished}
          researchInsights={dashboard.researchInsights}
          validateResponseRate={dashboard.validateResponseRate}
        />
      )}
    </div>
  );
}
