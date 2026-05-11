// PR #56 — Sprint 7.0: Research Auto-Discovery landing page.
//
// Server component: resolves the active project, hydrates the
// currently-connected sources + previously-skipped sources for context,
// then hands off to the client.
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projectSources, sourceDirectory } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { getActiveProject } from '@/lib/active-project';
import { SourcesClient } from './client';

export default async function ResearchSourcesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const project = await getActiveProject(user.id);
  if (!project) redirect('/onboarding');

  // Hydrate the "Connected" list so the founder sees what they've
  // already approved without an extra fetch. Join against the global
  // directory in a single round-trip — Drizzle's relational query
  // builder would also work but the plain join keeps things obvious.
  const connectedRows = await db
    .select({
      ps: projectSources,
      sd: sourceDirectory,
    })
    .from(projectSources)
    .innerJoin(sourceDirectory, eq(sourceDirectory.id, projectSources.sourceId))
    .where(
      and(
        eq(projectSources.projectId, project.id),
        eq(projectSources.status, 'connected'),
      ),
    );

  const connected = connectedRows.map(({ ps, sd }) => ({
    id: sd.id,
    platform: sd.platform,
    identifier: sd.identifier,
    displayName: sd.displayName,
    url: sd.url,
    memberCount: sd.memberCount,
    description: sd.description,
    language: sd.language,
    signalScore: ps.signalScore ?? 50,
    connectedAt: ps.connectedAt?.toISOString() ?? null,
  }));

  return (
    <SourcesClient
      project={{ id: project.id, name: project.name }}
      connected={connected}
    />
  );
}
