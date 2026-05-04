import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { integrations, metricSnapshots } from '@/lib/db/schema';
import { eq, and, gte, desc } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getActiveProject } from '@/lib/active-project';
import { AnalyticsClient } from './client';
import { getDashboardData } from '@/lib/analytics/dashboard';
import { GlassCard } from '@/components/ui/glass-card';
import { Sparkline } from '@/components/ui/sparkline';

export default async function AnalyticsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const dashboard = await getDashboardData();
  if ('error' in dashboard) redirect('/login');

  const project = await getActiveProject(user.id);

  // Optional: per-project metrics block (Vercel/Supabase/Meta) renders
  // below the KPI dashboard. We only fetch its data when there's an
  // active project — analytics is now useful even without one mapped.
  let snapshots: typeof metricSnapshots.$inferSelect[] = [];
  let hasVercel = false;
  let hasSupabase = false;
  let hasMeta = false;
  let lastSyncAt: Date | null = null;
  let hasMappings = false;

  if (project) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    snapshots = await db
      .select()
      .from(metricSnapshots)
      .where(
        and(
          eq(metricSnapshots.projectId, project.id),
          gte(metricSnapshots.date, thirtyDaysAgo.toISOString().split('T')[0])
        )
      )
      .orderBy(desc(metricSnapshots.date));

    const connectedIntegrations = await db
      .select({ provider: integrations.provider })
      .from(integrations)
      .where(eq(integrations.userId, user.id));
    const connected = new Set(connectedIntegrations.map((i) => i.provider));
    hasVercel = connected.has('vercel');
    hasSupabase = connected.has('supabase');
    hasMeta = connected.has('meta');

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
  }

  const allZero =
    dashboard.totalSignups.value === 0 &&
    dashboard.postsPublished.value === 0 &&
    dashboard.researchInsights.value === 0;

  return (
    <div className="p-6 md:p-10 max-w-6xl">
      <h1 className="font-display text-display-lg font-light tracking-tight mb-2">
        Analytics
      </h1>
      <p className="text-text-2 mb-8">Your business at a glance.</p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <GlassCard className="p-5">
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
            Waitlist signups
          </div>
          {/*
            The number is all-time across every Helm waitlist this user
            owns. The sparkline below is the last 14 days, hence the
            split label — pre-PR-15 the subtitle said "last 14 days"
            for the value too, which contradicted the count.
            This metric is independent of the Supabase Auth user count
            shown in the per-project metrics section below.
          */}
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

      {project && (
        <div className="border-t border-border pt-8">
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-3">
            Project metrics — {project.name}
          </div>
          <AnalyticsClient
            project={project}
            snapshots={snapshots}
            hasVercel={hasVercel}
            hasSupabase={hasSupabase}
            hasMeta={hasMeta}
            lastSyncAt={lastSyncAt}
            hasMappings={hasMappings}
            embedded
          />
        </div>
      )}
    </div>
  );
}
