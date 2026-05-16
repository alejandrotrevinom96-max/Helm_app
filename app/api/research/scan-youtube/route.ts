// PR Sprint B-finish-2 — channel-based YouTube scan endpoint.
//
// POST /api/research/scan-youtube
//   Body: { projectId: string }
//   Auth: founder must own the project.
//
// Mirror of /api/research/scan-rss but for connected YouTube
// channels. Iterates every project_sources row joined to a
// platform='youtube' source_directory row, fetches recent
// videos + top comments from each, and writes them as
// research_findings rows the pain-point extractor consumes.
//
// Rate limit: 6/hr/user (same envelope Reddit RSS uses). The
// YouTube Data API itself rate-limits at the deploy level via
// YOUTUBE_API_KEY's project quota — this caps client-side spam.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projects, researchConfig } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { checkRateLimit } from '@/lib/rate-limit';
import { scanProjectYouTube } from '@/lib/research/youtube-scan';

export const maxDuration = 60;

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

  const limit = checkRateLimit(
    `research-scan-youtube:${user.id}`,
    6,
    60 * 60 * 1000,
  );
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
        hint: `Try again in ${Math.ceil(limit.resetMs / 60000)} minutes.`,
      },
      { status: 429 },
    );
  }

  let body: { projectId?: string };
  try {
    body = (await request.json()) as { projectId?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { projectId } = body;
  if (!projectId || !UUID_RE.test(projectId)) {
    return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 });
  }

  // Ownership gate.
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

  const result = await scanProjectYouTube(projectId);

  // Mirror the scan-rss shape: stamp researchConfig.lastSyncedAt
  // when anything actually scanned so the /research "Last scan"
  // indicator covers YouTube too. We don't stamp on the
  // not-configured path — that would lie about activity.
  if (result.configured && result.channelsScanned > 0) {
    await db
      .update(researchConfig)
      .set({ lastSyncedAt: new Date() })
      .where(eq(researchConfig.projectId, projectId));
  }

  return NextResponse.json({
    success: true,
    findingsAdded: result.findingsAdded,
    channelsScanned: result.channelsScanned,
    results: result.channels,
    hint: result.hint,
    configured: result.configured,
  });
}
