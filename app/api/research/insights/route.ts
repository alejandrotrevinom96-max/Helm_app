// PR #57 — Sprint 7.0.1: read the latest research_insights row for a
// project. Used by /research to render the "Pain points this week"
// section without re-running the extractor.
//
// Strict isolation: ownership-join on projects.userId. Returns 403
// (not 404) for foreign projectId so we don't leak which IDs exist.
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projects, researchInsights } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { NextResponse } from 'next/server';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId');

  if (!projectId || !UUID_RE.test(projectId)) {
    return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 });
  }

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [latest] = await db
    .select()
    .from(researchInsights)
    .where(eq(researchInsights.projectId, projectId))
    .orderBy(desc(researchInsights.createdAt))
    .limit(1);

  return NextResponse.json({
    success: true,
    hasInsight: Boolean(latest),
    insight: latest ?? null,
  });
}
