// PR #67 — Sprint 7.1A: founder adds a competitor manually.
// Auto-approved (confidence=100, detectedBy='user'). The next
// scrape pass picks it up like any other approved row.
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { competitors, projects } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_TYPES = new Set(['direct', 'adjacent', 'inspirational']);

function normalizeUrl(input: string): string | null {
  if (typeof input !== 'string') return null;
  try {
    const u = new URL(input.startsWith('http') ? input : `https://${input}`);
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/$/, '')}${u.search}`;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: {
    projectId?: string;
    name?: string;
    url?: string;
    type?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { projectId, name, url, type } = body;
  if (!projectId || !UUID_RE.test(projectId)) {
    return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 });
  }
  if (!name || typeof name !== 'string' || name.trim().length < 1) {
    return NextResponse.json({ error: 'name required' }, { status: 400 });
  }
  if (!url || typeof url !== 'string') {
    return NextResponse.json({ error: 'url required' }, { status: 400 });
  }
  const normalized = normalizeUrl(url);
  if (!normalized) {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
  }

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const competitorType =
    typeof type === 'string' && VALID_TYPES.has(type) ? type : 'direct';

  const [inserted] = await db
    .insert(competitors)
    .values({
      projectId,
      userId: user.id,
      name: name.trim().slice(0, 120),
      url: normalized,
      type: competitorType,
      detectedBy: 'user',
      confidenceScore: 100,
      approvedByUser: true,
      scrapeStatus: 'pending',
    })
    .onConflictDoUpdate({
      target: [competitors.projectId, competitors.url],
      set: {
        name: name.trim().slice(0, 120),
        type: competitorType,
        approvedByUser: true,
        // Keep the scraped data if it's already there; the founder
        // re-adding the same URL shouldn't blow away results.
        updatedAt: new Date(),
      },
    })
    .returning();

  return NextResponse.json({ success: true, competitor: inserted });
}
