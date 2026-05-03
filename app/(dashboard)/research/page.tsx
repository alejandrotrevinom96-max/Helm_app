import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { researchFindings, researchConfig } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { getActiveProject } from '@/lib/active-project';
import { ResearchClient } from './client';

const DEFAULT_SOURCES = {
  reddit: true,
  hackernews: true,
  indiehackers: true,
  googleTrends: true,
};

export default async function ResearchPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const project = await getActiveProject(user.id);
  if (!project) redirect('/onboarding');

  const findings = await db
    .select()
    .from(researchFindings)
    .where(eq(researchFindings.projectId, project.id))
    .orderBy(desc(researchFindings.matchScore))
    .limit(50);

  const [config] = await db
    .select()
    .from(researchConfig)
    .where(eq(researchConfig.projectId, project.id))
    .limit(1);

  // Normalize for the client: never pass undefined/null where the UI expects
  // arrays/objects, so the client doesn't have to defensive-default at every
  // site.
  const initialConfig = {
    keywords: (config?.keywords as string[] | null) ?? [],
    competitors: (config?.competitors as string[] | null) ?? [],
    excludeWords: (config?.excludeWords as string[] | null) ?? [],
    sources: (config?.sources as typeof DEFAULT_SOURCES | null) ?? DEFAULT_SOURCES,
    weeklyInsight: config?.weeklyInsight ?? null,
    weeklyInsightAt: config?.weeklyInsightAt ?? null,
    lastSyncedAt: config?.lastSyncedAt ?? null,
  };

  return (
    <ResearchClient
      project={project}
      findings={findings}
      initialConfig={initialConfig}
    />
  );
}
