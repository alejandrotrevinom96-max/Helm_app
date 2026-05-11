// PR #56 — Sprint 7.0: founder dismisses a discovered source.
//
// Sets projectSources.status='skipped'. The Discover endpoint
// excludes any source the founder has already decided on (connected
// or skipped), so skipping is permanent for this project until the
// founder revives it from a settings UI (not in scope this sprint).
// Isolation: same ownership-join pattern as connect-source.
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projects, projectSources, sourceDirectory } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { projectId, sourceId } = body as {
    projectId?: string;
    sourceId?: string;
  };
  if (!projectId || !sourceId) {
    return NextResponse.json(
      { error: 'projectId and sourceId required' },
      { status: 400 },
    );
  }

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const [source] = await db
    .select({ id: sourceDirectory.id })
    .from(sourceDirectory)
    .where(eq(sourceDirectory.id, sourceId))
    .limit(1);
  if (!source) {
    return NextResponse.json({ error: 'Source not found' }, { status: 404 });
  }

  const [existing] = await db
    .select()
    .from(projectSources)
    .where(
      and(
        eq(projectSources.projectId, projectId),
        eq(projectSources.sourceId, sourceId),
      ),
    )
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(projectSources)
      .set({ status: 'skipped' })
      .where(eq(projectSources.id, existing.id))
      .returning();
    return NextResponse.json({ projectSource: updated });
  }

  const [inserted] = await db
    .insert(projectSources)
    .values({
      projectId,
      userId: user.id,
      sourceId,
      status: 'skipped',
    })
    .returning();

  return NextResponse.json({ projectSource: inserted });
}
