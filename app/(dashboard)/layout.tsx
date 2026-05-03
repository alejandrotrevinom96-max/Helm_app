import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { Sidebar } from '@/components/dashboard/sidebar';
import { getActiveProject, getAllUserProjects } from '@/lib/active-project';

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

  return (
    <div className="grid grid-cols-[240px_1fr] min-h-screen">
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
    </div>
  );
}
