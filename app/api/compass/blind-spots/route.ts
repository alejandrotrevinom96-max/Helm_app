// PR #70 — Sprint 7.1C: Blind Spots list endpoint.
//
// Returns every row for the project, ordered detected-first then
// by confidence DESC. Severity is text, so we sort it in JS after
// the SQL pull (critical > high > medium > low) before returning;
// the SQL ORDER BY just establishes the cheap primary buckets.
//
// `hasScan` lets the UI decide whether to render "Run first scan"
// vs the populated panel without making a second roundtrip.
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { compassBlindSpots, projects } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { NextResponse } from 'next/server';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId') ?? '';
  if (!UUID_RE.test(projectId)) {
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

  const rows = await db
    .select()
    .from(compassBlindSpots)
    .where(eq(compassBlindSpots.projectId, projectId))
    .orderBy(
      desc(compassBlindSpots.detected),
      desc(compassBlindSpots.confidenceScore),
    );

  // Secondary sort in JS: detected rows by severity rank (critical
  // first), then confidence. SQL already grouped detected/undetected.
  const sorted = [...rows].sort((a, b) => {
    if (a.detected !== b.detected) return a.detected ? -1 : 1;
    if (a.detected && b.detected) {
      const sa = SEVERITY_RANK[a.severity ?? ''] ?? 0;
      const sb = SEVERITY_RANK[b.severity ?? ''] ?? 0;
      if (sa !== sb) return sb - sa;
    }
    return (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0);
  });

  const summary = {
    total: sorted.length,
    detected: sorted.filter((r) => r.detected).length,
    critical: sorted.filter((r) => r.detected && r.severity === 'critical')
      .length,
    high: sorted.filter((r) => r.detected && r.severity === 'high').length,
    medium: sorted.filter((r) => r.detected && r.severity === 'medium').length,
    low: sorted.filter((r) => r.detected && r.severity === 'low').length,
    open: sorted.filter((r) => r.detected && r.userStatus === 'open').length,
  };

  const lastScannedAt =
    sorted.length > 0
      ? sorted
          .map((r) => r.createdAt)
          .filter((d): d is Date => d instanceof Date)
          .sort((a, b) => b.getTime() - a.getTime())[0] ?? null
      : null;

  return NextResponse.json({
    hasScan: sorted.length > 0,
    blindSpots: sorted,
    summary,
    lastScannedAt,
  });
}
