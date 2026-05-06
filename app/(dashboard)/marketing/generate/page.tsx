import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { generatedPosts, scheduledPosts } from '@/lib/db/schema';
import { eq, desc, and, asc } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { getActiveProject } from '@/lib/active-project';
import { MarketingClient } from '../client';

// PR #22 split the Marketing tab into Generate / Calendar / Library
// sub-tabs. This page hosts the existing generation flow (brand bible
// card, multi-draft generator, upcoming posts sidebar) — same content
// as the pre-PR-22 /marketing page, just one level deeper so the
// sub-nav layout can wrap it.
export default async function MarketingGeneratePage() {
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
