// PR #83 — Sprint 7.8: regrouped analytics page.
//
// Top-down structure:
//   1. Page header + scope toggle (URL-driven; same as PR #18).
//   2. <InsightsStrip /> — AI-generated 2-3 actionable items.
//      Loads client-side with a skeleton; silent fail on error.
//   3. <AnalyticsClient /> — KPIs in 4 groups (Growth / Content
//      performance / Engagement / Monetization).
//
// PR Sprint 7.25 Phase 3 — repainted on top of the platform redesign
// (AmbientBackground wrapper, 88px Instrument Serif italic + animated
// gradient accent, mono green "live · stack metrics" eyebrow, scope
// toggle as a pill row). Data fetching is byte-identical to pre-7.25.
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { integrations, metricSnapshots, projects } from '@/lib/db/schema';
import { eq, and, gte, desc, inArray, sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getActiveProject } from '@/lib/active-project';
import { AnalyticsClient } from './client';
import { getDashboardData } from '@/lib/analytics/dashboard';
import { AmbientBackground } from '@/components/ui/ambient-background';
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
  const hasReddit = connected.has('reddit');

  return (
    <AmbientBackground accentTint="blue">
      <main className="platform-main platform-main-wide">
        <header className="platform-page-head platform-page-head-row platform-reveal-1">
          <div>
            <span className="platform-eyebrow platform-eyebrow-live">
              live · stack metrics
            </span>
            <h1>
              Analytics<span className="accent-grad">.</span>
            </h1>
            <p className="sub">
              Real metrics from your stack — plus what you&apos;re doing in
              Helm. <b style={{ color: 'var(--text-1)' }}>No estimated
              numbers, no vanity charts.</b>
            </p>
          </div>

          {/* Scope toggle — URL-driven (PR #18). Refresh + share keep
              the same view. The mockup uses a single pill row; both
              links carry the new platform-scope-opt visual but the
              navigation hookup is unchanged. */}
          <div className="platform-scope-toggle">
            <Link
              href="/analytics?scope=project"
              scroll={false}
              className={`platform-scope-opt${
                scope === 'project' ? ' platform-scope-opt-on' : ''
              }`}
            >
              This project
            </Link>
            <Link
              href="/analytics?scope=global"
              scroll={false}
              className={`platform-scope-opt${
                scope === 'global' ? ' platform-scope-opt-on' : ''
              }`}
            >
              All projects
            </Link>
          </div>
        </header>

        <InsightsStrip />

        {scope === 'project' && !project ? (
          <section className="platform-card platform-card-glow-blue platform-reveal-2">
            <p className="platform-desc" style={{ marginBottom: '10px' }}>
              No project selected. Switch to All projects or create one to
              see analytics.
            </p>
            <Link href="/integrations" className="platform-cta-link">
              Open Integrations
              <svg viewBox="0 0 16 16" fill="none" aria-hidden>
                <path
                  d="M3 8h10M9 4l4 4-4 4"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Link>
          </section>
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
      </main>
    </AmbientBackground>
  );
}
