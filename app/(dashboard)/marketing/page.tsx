import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { generatedPosts, scheduledPosts } from '@/lib/db/schema';
import { eq, desc, and, asc } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { getActiveProject } from '@/lib/active-project';
import { MarketingClient } from './client';

export default async function MarketingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const project = await getActiveProject(user.id);
  if (!project) redirect('/onboarding');

  const recentPosts = await db
    .select()
    .from(generatedPosts)
    .where(eq(generatedPosts.projectId, project.id))
    .orderBy(desc(generatedPosts.createdAt))
    .limit(10);

  const upcoming = await db
    .select()
    .from(scheduledPosts)
    .where(
      and(
        eq(scheduledPosts.projectId, project.id),
        eq(scheduledPosts.status, 'scheduled')
      )
    )
    .orderBy(asc(scheduledPosts.scheduledFor))
    .limit(10);

  // Server-side check: only show "Add visual" buttons / show loading
  // states / etc. when fal.ai is wired up. Avoids the user clicking and
  // getting a 503 they can't act on.
  const visualsAvailable = !!process.env.FAL_API_KEY;

  return (
    <MarketingClient
      project={project}
      recentPosts={recentPosts}
      upcoming={upcoming}
      visualsAvailable={visualsAvailable}
    />
  );
}
