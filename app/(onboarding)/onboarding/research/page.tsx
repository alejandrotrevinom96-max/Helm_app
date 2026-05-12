// PR #74 — Sprint 7.2B Step 4: Research scan.
//
// Server shell — resolves the primary project (from onboarding
// progress, then active-project fallback) so the client can call
// research endpoints with the right projectId. If no project
// exists yet, kicks the founder back to step 2.
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import {
  projects,
  onboardingProgress,
} from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { ResearchClient } from './client';

export default async function OnboardingResearchPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Tier 1 — wizard's primary project.
  const [progress] = await db
    .select({ primaryProjectId: onboardingProgress.primaryProjectId })
    .from(onboardingProgress)
    .where(eq(onboardingProgress.userId, user.id))
    .limit(1);
  let projectId = progress?.primaryProjectId ?? null;

  // Tier 2 — most recent project.
  if (!projectId) {
    const [latest] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.userId, user.id))
      .orderBy(desc(projects.createdAt))
      .limit(1);
    if (latest) projectId = latest.id;
  }

  if (!projectId) {
    redirect('/onboarding/project');
  }

  return <ResearchClient projectId={projectId} />;
}
