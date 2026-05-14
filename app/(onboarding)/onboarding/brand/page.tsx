// PR #74 — Sprint 7.2B Step 3: Brand context.
//
// Server shell — hydrates the client with whatever the founder
// already entered in step 2 (the oneLiner doubles as a "niche"
// hint) and any prior brand-step answers from a previous wizard
// attempt. Keeps the form pre-filled across browser refreshes.
//
// PR Sprint 7.19 — also acts as the entry-point for the "new
// project from sidebar modal" flow. When `?project=<uuid>&newProject=1`
// is present, the page:
//   - Validates the founder owns that project.
//   - Skips the prior-brand-answers prefill (a returning user
//     creating a new project shouldn't see leftover text from
//     their FIRST onboarding round).
//   - Passes `projectId` + `mode='new_project'` down to the
//     client so it scopes the brand bible save + the wizard
//     handoff to the new project.
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { onboardingProgress, projects } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { BrandClient } from './client';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function OnboardingBrandPage({
  searchParams,
}: {
  searchParams: Promise<{
    project?: string | string[];
    newProject?: string | string[];
  }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const params = await searchParams;
  const projectParam = Array.isArray(params.project)
    ? params.project[0]
    : params.project;
  const newProjectFlag = Array.isArray(params.newProject)
    ? params.newProject[0]
    : params.newProject;
  const isNewProjectFlow =
    typeof projectParam === 'string' &&
    UUID_RE.test(projectParam) &&
    newProjectFlag === '1';

  // For the new-project flow, ownership-check the target project
  // before letting the wizard target it. Defensive — the modal
  // creates the project right before navigating here, but a
  // hand-typed URL with someone else's project id shouldn't be
  // honored.
  let scopedProjectId: string | null = null;
  if (isNewProjectFlow) {
    const [owned] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.id, projectParam as string),
          eq(projects.userId, user.id),
        ),
      )
      .limit(1);
    if (owned) scopedProjectId = owned.id;
  }

  // Pre-fill: skipped on the new-project flow so we get a clean
  // slate. On the normal flow we pull the prior wizard answers.
  let initialNiche = '';
  let initialAudience = '';
  let initialTone = '';
  if (!scopedProjectId) {
    const [progress] = await db
      .select({ brandAnswers: onboardingProgress.brandAnswers })
      .from(onboardingProgress)
      .where(eq(onboardingProgress.userId, user.id))
      .limit(1);
    const prior =
      (progress?.brandAnswers as Record<string, unknown> | null) ?? {};
    const asStr = (v: unknown): string => (typeof v === 'string' ? v : '');
    initialNiche = asStr(prior.niche) || asStr(prior.oneLiner);
    initialAudience = asStr(prior.audience);
    initialTone = asStr(prior.tone);
  }

  return (
    <BrandClient
      initialNiche={initialNiche}
      initialAudience={initialAudience}
      initialTone={initialTone}
      projectId={scopedProjectId}
      mode={scopedProjectId ? 'new_project' : 'wizard'}
    />
  );
}
