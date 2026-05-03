import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { waitlistPages, waitlistSignups } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { getActiveProject } from '@/lib/active-project';
import { ValidateClient } from './client';

export default async function ValidatePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const project = await getActiveProject(user.id);
  if (!project) redirect('/onboarding');

  // Get all waitlist pages with signup counts
  const pages = await db
    .select({
      id: waitlistPages.id,
      slug: waitlistPages.slug,
      title: waitlistPages.title,
      subtitle: waitlistPages.subtitle,
      isActive: waitlistPages.isActive,
      createdAt: waitlistPages.createdAt,
      signupCount: sql<number>`count(${waitlistSignups.id})::int`,
    })
    .from(waitlistPages)
    .leftJoin(waitlistSignups, eq(waitlistSignups.waitlistPageId, waitlistPages.id))
    .where(eq(waitlistPages.projectId, project.id))
    .groupBy(waitlistPages.id);

  return <ValidateClient project={project} pages={pages} />;
}
