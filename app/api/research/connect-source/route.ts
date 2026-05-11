// PR #56 — Sprint 7.0: founder approves a discovered source.
//
// Sets projectSources.status='connected' + stamps connectedAt. If the
// row doesn't exist yet (the source was discovered but never ranked),
// we insert with a sensible default score. Isolation: project must
// belong to caller; we re-verify by joining on projects.userId every
// time — never trust client-passed projectId alone.
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

  // Isolation re-check.
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Source must exist in the directory.
  const [source] = await db
    .select({ id: sourceDirectory.id })
    .from(sourceDirectory)
    .where(eq(sourceDirectory.id, sourceId))
    .limit(1);
  if (!source) {
    return NextResponse.json({ error: 'Source not found' }, { status: 404 });
  }

  // Upsert: if a row exists, flip to 'connected'; otherwise insert.
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
      .set({ status: 'connected', connectedAt: new Date() })
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
      status: 'connected',
      connectedAt: new Date(),
      signalScore: 50, // unranked-but-connected default
    })
    .returning();

  return NextResponse.json({ projectSource: inserted });
}
