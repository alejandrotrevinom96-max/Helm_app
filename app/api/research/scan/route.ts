// PR Sprint 7.25 Phase 11.5 — manual research scan route.
//
// Founder-driven scan triggered from the Research page's "Scan now ↻"
// button. The heavy lifting (multi-source fetch, Haiku scoring,
// insert + lastSyncedAt update) lives in lib/research/scan.ts so the
// new /api/cron/research-scan can call the same function against
// every active project.
//
// This route owns:
//   - Supabase auth + ownership check (project belongs to user).
//   - Lazy-create the researchConfig row when missing.
//   - Map the helper result to the existing HTTP response shape that
//     the Research client expects (no-keywords → 400 with hint).
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projects, researchConfig } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { scanProjectResearch } from '@/lib/research/scan';

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { projectId } = await request.json();
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project)
    return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Load (or lazy-create) the research config.
  let [config] = await db
    .select()
    .from(researchConfig)
    .where(eq(researchConfig.projectId, projectId))
    .limit(1);
  if (!config) {
    [config] = await db
      .insert(researchConfig)
      .values({ projectId })
      .returning();
  }

  const result = await scanProjectResearch(project, config);

  if (result.noKeywords) {
    return NextResponse.json(
      {
        error: 'No keywords configured',
        hint: 'Add keywords in the Configuration card before scanning.',
        scanned: 0,
        inserted: 0,
      },
      { status: 400 },
    );
  }

  return NextResponse.json({
    scanned: result.scanned,
    scored: result.scored,
    inserted: result.inserted,
    sources: result.sources,
  });
}
