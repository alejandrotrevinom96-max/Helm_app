import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { waitlistPages, waitlistResponses } from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { getActiveProject } from '@/lib/active-project';
import { ValidateClient } from './client';

export default async function ValidatePage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const project = await getActiveProject(user.id);
  if (!project) redirect('/onboarding');

  const params = await searchParams;
  const showArchived = params.archived === 'true';

  // List depends on toggle. We also fetch the archived count so the toggle
  // link can show "(N)" without a second round-trip.
  const pages = await db
    .select({
      id: waitlistPages.id,
      slug: waitlistPages.slug,
      title: waitlistPages.title,
      subtitle: waitlistPages.subtitle,
      isActive: waitlistPages.isActive,
      createdAt: waitlistPages.createdAt,
      template: waitlistPages.template,
      templateConfig: waitlistPages.templateConfig,
      responseCount: sql<number>`count(${waitlistResponses.id})::int`,
    })
    .from(waitlistPages)
    .leftJoin(
      waitlistResponses,
      eq(waitlistResponses.waitlistPageId, waitlistPages.id)
    )
    .where(
      and(
        eq(waitlistPages.projectId, project.id),
        eq(waitlistPages.isActive, !showArchived)
      )
    )
    .groupBy(waitlistPages.id);

  // Counts for the opposite tab so the toggle link can display "(N)"
  const [{ archivedCount }] = await db
    .select({
      archivedCount: sql<number>`count(*)::int`,
    })
    .from(waitlistPages)
    .where(
      and(
        eq(waitlistPages.projectId, project.id),
        eq(waitlistPages.isActive, false)
      )
    );

  return (
    <ValidateClient
      project={project}
      pages={pages}
      showArchived={showArchived}
      archivedCount={archivedCount ?? 0}
    />
  );
}
