import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { integrations, metricSnapshots } from '@/lib/db/schema';
import { eq, and, gte, desc } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { getActiveProject } from '@/lib/active-project';
import { AnalyticsClient } from './client';

export default async function AnalyticsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const project = await getActiveProject(user.id);
  if (!project) redirect('/onboarding');

  // Last 30 days of metrics
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const snapshots = await db
    .select()
    .from(metricSnapshots)
    .where(
      and(
        eq(metricSnapshots.projectId, project.id),
        gte(metricSnapshots.date, thirtyDaysAgo.toISOString().split('T')[0])
      )
    )
    .orderBy(desc(metricSnapshots.date));

  // Check which integrations are connected
  const connectedIntegrations = await db
    .select({ provider: integrations.provider })
    .from(integrations)
    .where(eq(integrations.userId, user.id));

  const connected = new Set(connectedIntegrations.map((i) => i.provider));

  // Last sync timestamp across all sources for this project
  const [latestSync] = await db
    .select({ syncedAt: metricSnapshots.syncedAt })
    .from(metricSnapshots)
    .where(eq(metricSnapshots.projectId, project.id))
    .orderBy(desc(metricSnapshots.syncedAt))
    .limit(1);

  // Whether the active project still has any remote mapped
  const hasMappings = !!(
    project.vercelProjectId ||
    project.supabaseProjectRef ||
    project.metaAdAccountId
  );

  return (
    <AnalyticsClient
      project={project}
      snapshots={snapshots}
      hasVercel={connected.has('vercel')}
      hasSupabase={connected.has('supabase')}
      hasMeta={connected.has('meta')}
      lastSyncAt={latestSync?.syncedAt ?? null}
      hasMappings={hasMappings}
    />
  );
}
