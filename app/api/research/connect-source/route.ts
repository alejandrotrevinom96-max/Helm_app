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

// PR #57 — Sprint 7.0.1 (BUG #22 fix): validate UUID shape before
// the DB query. Postgres rejects malformed UUIDs with a query error
// that bubbles up as a 500, masking what is actually a 400.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { projectId?: string; sourceId?: string };
  try {
    body = (await request.json()) as { projectId?: string; sourceId?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { projectId, sourceId } = body;
  if (!projectId || !UUID_RE.test(projectId)) {
    return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 });
  }
  if (!sourceId || !UUID_RE.test(sourceId)) {
    return NextResponse.json({ error: 'Invalid sourceId' }, { status: 400 });
  }

  try {
    // Isolation re-check.
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
      .limit(1);
    if (!project) {
      return NextResponse.json(
        { error: 'Project not found or forbidden' },
        { status: 403 },
      );
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
      return NextResponse.json({ projectSource: updated, success: true });
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

    return NextResponse.json({ projectSource: inserted, success: true });
  } catch (e) {
    console.error('[connect-source] failed:', e);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
