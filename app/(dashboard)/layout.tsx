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
import * as Sentry from '@sentry/nextjs';
import type { Project } from '@/lib/db/schema';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [dbUser] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);

  // PR Sprint D-1 hotfix — when the projects schema in code is ahead
  // of the prod DB (e.g. new tuning columns added but the migration
  // hasn't been applied yet), Drizzle's `select()` generates SQL
  // referencing columns that don't exist and the whole dashboard
  // 500s for every user. Wrap in try/catch: capture to Sentry,
  // degrade to "no active project" so the founder can still reach
  // /settings and /admin/migrate-* endpoints to fix the schema
  // drift. Sidebar handles empty allProjects gracefully.
  let allProjects: Project[] = [];
  let activeProject: Project | null = null;
  try {
    allProjects = await getAllUserProjects(user.id);
    activeProject = await getActiveProject(user.id);
  } catch (e) {
    Sentry.captureException(e, {
      tags: { area: 'dashboard-layout', kind: 'projects-query-failed' },
      extra: { userId: user.id },
    });
    console.error(
      '[dashboard-layout] projects query failed — likely schema drift between code + DB. Run the admin migrate endpoints.',
      e,
    );
  }

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
    // PR Sprint final-fix — dashboard root.
    //
    // Root cause of "Photo Studio page-scrolls but UGC doesn't":
    // the dashboard's <main> had `overflow-y-auto` BUT no height
    // constraint. Main grew with content; the OUTER PAGE scrolled.
    // UGC happened to fit; Photo Studio's preview with
    // visual_failed messages didn't. The studio-shell-grid
    // bounding worked in isolation but lost the war against the
    // unbounded parent main.
    //
    // Fix: bound <main> to the viewport with both a vh height
    // (universally supported) and a dvh cap (modern mobile
    // chrome-aware). Two arbitrary-value Tailwind classes:
    //   h-[calc(100vh)]      → main is at least viewport-tall
    //   max-h-[calc(100dvh)] → but cap at the *visible* viewport
    // Combined: on desktop both ≈ 100vh; on mobile when chrome
    // is showing, dvh < vh so max-h caps to dvh (no overflow
    // under URL bar); when chrome hides, dvh ≈ vh so layout
    // expands naturally. Outer div gets overflow-hidden so the
    // page itself can never scroll regardless of inner content.
    <div className="h-[calc(100vh)] max-h-[calc(100dvh)] md:grid md:grid-cols-[240px_1fr] overflow-hidden">
      <Sidebar
        activeProject={activeProject}
        allProjects={allProjects}
        user={{
          name: dbUser?.name ?? 'Founder',
          email: dbUser?.email ?? '',
          avatarUrl: dbUser?.avatarUrl ?? null,
        }}
      />
      <main className="h-[calc(100vh)] max-h-[calc(100dvh)] overflow-y-auto">
        {children}
      </main>
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
