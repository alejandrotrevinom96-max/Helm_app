import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { waitlistPages, waitlistResponses } from '@/lib/db/schema';
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

  // Count responses (the new generic table — covers every template, not only
  // email-bearing signups). LEFT JOIN so pages with zero responses still show.
  const pages = await db
    .select({
      id: waitlistPages.id,
      slug: waitlistPages.slug,
      title: waitlistPages.title,
      subtitle: waitlistPages.subtitle,
      isActive: waitlistPages.isActive,
      createdAt: waitlistPages.createdAt,
      template: waitlistPages.template,
      responseCount: sql<number>`count(${waitlistResponses.id})::int`,
    })
    .from(waitlistPages)
    .leftJoin(
      waitlistResponses,
      eq(waitlistResponses.waitlistPageId, waitlistPages.id)
    )
    .where(eq(waitlistPages.projectId, project.id))
    .groupBy(waitlistPages.id);

  return <ValidateClient project={project} pages={pages} />;
}
