import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { integrations } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { getAllUserProjects } from '@/lib/active-project';
import { IntegrationsClient } from './client';

export default async function IntegrationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const userIntegrations = await db
    .select({ provider: integrations.provider, createdAt: integrations.createdAt })
    .from(integrations)
    .where(eq(integrations.userId, user.id));

  const allProjects = await getAllUserProjects(user.id);

  return (
    <IntegrationsClient
      connected={userIntegrations.map((i) => i.provider)}
      allProjects={allProjects.map((p) => ({
        id: p.id,
        name: p.name,
        githubRepoFullName: p.githubRepoFullName,
        vercelProjectId: p.vercelProjectId,
        vercelTeamId: p.vercelTeamId,
        supabaseProjectRef: p.supabaseProjectRef,
        supabaseTables: (p.supabaseTables as { tableName: string; metricLabel: string }[] | null) ?? null,
        metaAdAccountId: p.metaAdAccountId,
      }))}
    />
  );
}
