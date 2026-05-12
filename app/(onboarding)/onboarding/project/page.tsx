// PR #74 — Sprint 7.2B Step 2: Project.
//
// Server shell — checks whether the user already has a project (e.g.
// they created one via the AddProjectModal from a landing-URL
// pre-fill in PR #72). If so, treat this step as already-complete
// and pre-fill the form for editing, or skip ahead.
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { projects, onboardingProgress } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { ProjectClient } from './client';

export default async function OnboardingProjectPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // If the founder already has a project (from PR #72 landing
  // pre-fill or a previous wizard attempt), we hand them an
  // "Edit & continue" state instead of forcing a duplicate.
  const [existingProject] = await db
    .select({ id: projects.id, name: projects.name, brandUrl: projects.brandUrl })
    .from(projects)
    .where(eq(projects.userId, user.id))
    .orderBy(desc(projects.createdAt))
    .limit(1);

  // Pull any cached one-liner from a prior visit.
  const [progress] = await db
    .select({ brandAnswers: onboardingProgress.brandAnswers })
    .from(onboardingProgress)
    .where(eq(onboardingProgress.userId, user.id))
    .limit(1);
  const priorAnswers =
    (progress?.brandAnswers as Record<string, unknown> | null) ?? {};
  const priorOneLiner =
    typeof priorAnswers.oneLiner === 'string' ? priorAnswers.oneLiner : '';

  return (
    <ProjectClient
      existingProject={existingProject ?? null}
      priorOneLiner={priorOneLiner}
    />
  );
}
