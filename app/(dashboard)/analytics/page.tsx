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
import { Sparkline } from '@/components/ui/sparkline';
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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const params = await searchParams;
  const scope = parseScope(params.scope);

  const project = await getActiveProject(user.id);

  const dashboard = await getDashboardData({
    scope,
    projectId: scope === 'project' ? project?.id : undefined,
  });
  if ('error' in dashboard) redirect('/login');

  // Per-project metrics block. In project scope we filter to one project;
  // in global scope we collapse every project's latest snapshot per
  // (source, metric) and sum across projects (the aggregate dashboard
  // total visitors / signups / spend).
  let snapshots: MetricSnapshot[] = [];
  let hasVercel = false;
  let hasSupabase = false;
  let hasMeta = false;
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
          gte(metricSnapshots.date, since)
        )
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
    // Global mode: pull every project's snapshots in the window and let
    // the client display the latest value per (source, metric) summed.
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
            gte(metricSnapshots.date, since)
          )
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
            sql`(${projects.vercelProjectId} IS NOT NULL OR ${projects.supabaseProjectRef} IS NOT NULL OR ${projects.metaAdAccountId} IS NOT NULL)`
          )
        );
      hasMappings = (mappingCount[0]?.n ?? 0) > 0;
    }
  }

  const connectedIntegrations = await db
    .select({ provider: integrations.provider })
    .from(integrations)
    .where(eq(integrations.userId, user.id));
  const connected = new Set(connectedIntegrations.map((i) => i.provider));
  hasVercel = connected.has('vercel');
  hasSupabase = connected.has('supabase');
  hasMeta = connected.has('meta');

  const allZero =
    dashboard.totalSignups.value === 0 &&
    dashboard.postsPublished.value === 0 &&
    dashboard.researchInsights.value === 0;

  const projectScopeLabel =
    scope === 'project' && project
      ? `Project metrics — ${project.name}`
      : 'All projects metrics';

  return (
    <div className="p-6 md:p-10 max-w-6xl">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4 mb-8">
        <div>
          <h1 className="font-display text-display-lg font-light tracking-tight mb-2">
            Analytics
          </h1>
          <p className="text-text-2">Your business at a glance.</p>
        </div>

        {/* Scope toggle: simple two-button segmented control. We use
            <Link> so the URL reflects the choice (server-rendered, refresh-
            friendly, sharable). localStorage isn't needed — the URL IS the
            persistence layer. */}
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <GlassCard className="p-5">
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
            Waitlist signups
          </div>
          <div className="font-display text-3xl font-light tracking-tight mb-2">
            {dashboard.totalSignups.value}
          </div>
          <div className="text-accent">
            <Sparkline
              data={dashboard.totalSignups.sparkline}
              width={100}
              height={24}
              ariaLabel="signups trend"
            />
          </div>
          <div className="text-[10px] text-text-3 mt-1">
            all-time · sparkline 14d
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
            Posts published
          </div>
          <div className="font-display text-3xl font-light tracking-tight mb-2">
            {dashboard.postsPublished.value}
          </div>
          <div className="text-accent">
            <Sparkline
              data={dashboard.postsPublished.sparkline}
              width={100}
              height={24}
              ariaLabel="posts trend"
            />
          </div>
          <div className="text-[10px] text-text-3 mt-1">last 30 days</div>
        </GlassCard>

        <GlassCard className="p-5">
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
            Research findings
          </div>
          <div className="font-display text-3xl font-light tracking-tight mb-2">
            {dashboard.researchInsights.value}
          </div>
          <div className="text-accent">
            <Sparkline
              data={dashboard.researchInsights.sparkline}
              width={100}
              height={24}
              ariaLabel="findings trend"
            />
          </div>
          <div className="text-[10px] text-text-3 mt-1">
            all-time · sparkline 14d
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
            Avg responses per page
          </div>
          <div className="font-display text-3xl font-light tracking-tight mb-2">
            {dashboard.validateResponseRate.value}
          </div>
          <div className="text-[10px] text-text-3 mt-2">
            {dashboard.validateResponseRate.total} total ·{' '}
            {dashboard.validateResponseRate.activePages} pages
          </div>
        </GlassCard>
      </div>

      {allZero && (
        <GlassCard className="p-8 text-center mb-8">
          <p className="text-text-2 mb-4">
            No data yet. Start by creating a waitlist or scheduling a post.
          </p>
          <div className="flex gap-4 justify-center text-sm">
            <Link href="/marketing" className="text-accent hover:underline">
              → Marketing
            </Link>
            <Link href="/validate" className="text-accent hover:underline">
              → Validate
            </Link>
            <Link href="/research" className="text-accent hover:underline">
              → Research
            </Link>
          </div>
        </GlassCard>
      )}

      {(scope === 'project' ? !!project : snapshots.length > 0) && (
        <div className="border-t border-border pt-8">
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-3">
            {projectScopeLabel}
          </div>
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
            lastSyncAt={lastSyncAt}
            hasMappings={hasMappings}
            embedded
            scope={scope}
          />
        </div>
      )}
    </div>
  );
}
