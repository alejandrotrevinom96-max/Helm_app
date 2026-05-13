import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { users, integrations, projects } from '@/lib/db/schema';
import { eq, and, isNotNull } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { Sidebar } from '@/components/dashboard/sidebar';
import { getActiveProject, getAllUserProjects } from '@/lib/active-project';
import { OnboardingClientWrapper } from '@/components/onboarding/wrapper';
import { ChatWidget } from '@/components/chat/ChatWidget';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [dbUser] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  const allProjects = await getAllUserProjects(user.id);
  const activeProject = await getActiveProject(user.id);

  // Avoid self-redirect loop when the user is already on /onboarding.
  // Without this guard the layout would trigger a 307 to its own URL,
  // which under HMR + scanUserRepos burns through GitHub's API quota.
  const pathname = (await headers()).get('x-pathname') ?? '';
  if (
    !dbUser?.hasCompletedOnboarding &&
    allProjects.length === 0 &&
    !pathname.startsWith('/onboarding')
  ) {
    redirect('/onboarding');
  }

  // Wizard state: only fetched/shown once the user has at least one project
  // and is past the legacy GitHub-scan flow. Otherwise we'd double-render
  // a modal on top of /onboarding which is itself an onboarding screen.
  const onboardingStep = dbUser?.onboardingStep ?? 0;
  const showWizard =
    allProjects.length > 0 &&
    onboardingStep < 99 &&
    !pathname.startsWith('/onboarding');

  let hasGitHubToken = false;
  let hasBrandContext = false;
  if (showWizard) {
    const [gh] = await db
      .select({ id: integrations.id })
      .from(integrations)
      .where(and(eq(integrations.userId, user.id), eq(integrations.provider, 'github')))
      .limit(1);
    hasGitHubToken = !!gh;

    const [brand] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.userId, user.id), isNotNull(projects.brandContext)))
      .limit(1);
    hasBrandContext = !!brand;
  }

  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
      <Sidebar
        activeProject={activeProject}
        allProjects={allProjects}
        user={{
          name: dbUser?.name ?? 'Founder',
          email: dbUser?.email ?? '',
          avatarUrl: dbUser?.avatarUrl ?? null,
        }}
      />
      <main className="overflow-y-auto">{children}</main>
      {showWizard && (
        <OnboardingClientWrapper
          initialStep={onboardingStep}
          hasGitHubToken={hasGitHubToken}
          hasBrandContext={hasBrandContext}
          hasAnyProject={allProjects.length > 0}
        />
      )}
      {/* PR Sprint 7.15 — native Helm AI chat. Floating bottom-
          right launcher that opens a Glass panel; renders on
          every dashboard page. projectId comes from the active-
          project resolver above so messages tag onto the right
          project automatically (and gracefully fall back to
          null when the founder has no project yet, e.g. mid-
          onboarding). z-40 sits above page content but below
          the onboarding wrapper's z-50 so it never blocks the
          wizard. */}
      <ChatWidget projectId={activeProject?.id ?? null} />
    </div>
  );
}
