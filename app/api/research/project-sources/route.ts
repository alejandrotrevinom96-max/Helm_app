// PR #59 — Sprint 7.0.3: list a project's connected (or any status)
// research sources for the UI. The sources page client uses this to
// hydrate after add-subreddit + scan operations without a full
// page reload.
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projects, projectSources, sourceDirectory } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { NextResponse } from 'next/server';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_STATUSES = new Set([
  'connected',
  'suggested',
  'skipped',
  'all',
]);

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
  const statusFilter = url.searchParams.get('status') ?? 'connected';

  if (!projectId || !UUID_RE.test(projectId)) {
    return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 });
  }
  if (!VALID_STATUSES.has(statusFilter)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const conditions =
    statusFilter === 'all'
      ? [eq(projectSources.projectId, projectId)]
      : [
          eq(projectSources.projectId, projectId),
          eq(projectSources.status, statusFilter),
        ];

  const rows = await db
    .select({
      id: projectSources.id,
      sourceId: sourceDirectory.id,
      platform: sourceDirectory.platform,
      identifier: sourceDirectory.identifier,
      displayName: sourceDirectory.displayName,
      url: sourceDirectory.url,
      memberCount: sourceDirectory.memberCount,
      description: sourceDirectory.description,
      status: projectSources.status,
      signalScore: projectSources.signalScore,
      findingsCount: projectSources.findingsCount,
      scanCount: projectSources.scanCount,
      lastScannedAt: projectSources.lastScannedAt,
      connectedAt: projectSources.connectedAt,
    })
    .from(projectSources)
    .innerJoin(
      sourceDirectory,
      eq(projectSources.sourceId, sourceDirectory.id),
    )
    .where(and(...conditions))
    .orderBy(desc(projectSources.connectedAt));

  return NextResponse.json({ sources: rows });
}
