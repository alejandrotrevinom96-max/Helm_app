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

// PR #57 — Sprint 7.0.1 (BUG #22 fix): same UUID guard as
// connect-source so malformed IDs hit 400 not 500.
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
      return NextResponse.json({ projectSource: updated, success: true });
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

    return NextResponse.json({ projectSource: inserted, success: true });
  } catch (e) {
    console.error('[skip-source] failed:', e);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
