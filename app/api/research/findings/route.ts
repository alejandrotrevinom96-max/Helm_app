import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projects, researchFindings } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { NextResponse } from 'next/server';

const VALID_SOURCES = new Set(['reddit', 'hackernews', 'indiehackers']);

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('projectId');
  if (!projectId) {
    return NextResponse.json({ error: 'projectId required' }, { status: 400 });
  }

  const rawOffset = parseInt(searchParams.get('offset') ?? '0', 10);
  const rawLimit = parseInt(searchParams.get('limit') ?? '20', 10);
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(1, rawLimit), 50)
    : 20;
  const source = searchParams.get('source');

  // Anti-tampering: project must belong to caller.
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const condition =
    source && VALID_SOURCES.has(source)
      ? and(
          eq(researchFindings.projectId, projectId),
          eq(researchFindings.source, source)
        )
      : eq(researchFindings.projectId, projectId);

  const findings = await db
    .select()
    .from(researchFindings)
    .where(condition)
    .orderBy(desc(researchFindings.matchScore))
    .limit(limit)
    .offset(offset);

  return NextResponse.json({
    findings,
    hasMore: findings.length === limit,
  });
}
