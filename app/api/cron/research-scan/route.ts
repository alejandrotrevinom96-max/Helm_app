// PR Sprint 7.25 Phase 11.5 — research auto-scan cron.
//
// GET /api/cron/research-scan  (auth: Bearer CRON_SECRET)
//
// Runs the research scan against every active project whose config
// hasn't been refreshed in the last 24h. Without this cron the only
// way new Reddit / HN / IH posts entered Helm was the founder
// clicking "Scan now ↻" — and the feed went stale the moment they
// stopped checking.
//
// Cost discipline (Haiku scoring runs ~$0.005 per matched item):
//   - Per-tick project cap: 5. Even with 30 findings per project,
//     a worst-case tick costs ~$0.75. Running daily that's ~$22/mo
//     if every project sits at the worst case.
//   - 24-hour staleness gate so we never re-scan a project the
//     founder just manually-scanned (their lastSyncedAt is fresh).
//   - Skip projects with empty keyword lists — scoring without
//     keywords would just burn the model on noise.
//
// Schedule: daily at 02:00 UTC (set in vercel.json). One run per
// day matches Reddit RSS's 1×/day-per-sub contract (lib/research/
// reddit-rss.ts) and gives the founder a fresh feed every morning
// without overlapping the manual scan path.
//
// Idempotency: scanProjectResearch updates lastSyncedAt on every
// invocation, so a hypothetical double-tick within the same 24h
// window would see the staleness gate skip every project on the
// second pass.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { projects, researchConfig } from '@/lib/db/schema';
import { eq, and, lt, isNull, or } from 'drizzle-orm';
import { scanProjectResearch } from '@/lib/research/scan';

export const dynamic = 'force-dynamic';
// Each scanProjectResearch call: 3 fetches (Reddit/HN/IH) ~5s +
// N Haiku scoring calls × ~2s each. With 5 projects + ~30 findings
// each we're looking at ~5min worst case. 300s is the Vercel Pro
// ceiling for serverless functions; that's our headroom.
export const maxDuration = 300;

const BATCH_LIMIT = 5;
const STALE_THRESHOLD_HOURS = 24;

interface ScanSummary {
  considered: number;
  scanned: number;
  totalInserted: number;
  totalScored: number;
  skippedNoKeywords: number;
  perProject: Array<{
    projectId: string;
    inserted: number;
    scored: number;
    scanned: number;
    sources: string[];
    errors: number;
  }>;
}

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured on server' },
      { status: 503 },
    );
  }
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Active projects whose research config exists AND hasn't been
  // touched in the last 24 hours (or never). The inner join makes
  // sure we only iterate projects that opted into research at all.
  const staleCutoff = new Date(
    Date.now() - STALE_THRESHOLD_HOURS * 60 * 60 * 1000,
  );
  const candidates = await db
    .select({ project: projects, config: researchConfig })
    .from(researchConfig)
    .innerJoin(projects, eq(projects.id, researchConfig.projectId))
    .where(
      and(
        eq(projects.isActive, true),
        or(
          isNull(researchConfig.lastSyncedAt),
          lt(researchConfig.lastSyncedAt, staleCutoff),
        ),
      ),
    )
    .orderBy(researchConfig.lastSyncedAt) // oldest first (nulls treated first)
    .limit(BATCH_LIMIT);

  const summary: ScanSummary = {
    considered: candidates.length,
    scanned: 0,
    totalInserted: 0,
    totalScored: 0,
    skippedNoKeywords: 0,
    perProject: [],
  };

  for (const { project, config } of candidates) {
    try {
      const result = await scanProjectResearch(project, config);
      if (result.noKeywords) {
        summary.skippedNoKeywords += 1;
        continue;
      }
      summary.scanned += 1;
      summary.totalInserted += result.inserted;
      summary.totalScored += result.scored;
      summary.perProject.push({
        projectId: project.id,
        inserted: result.inserted,
        scored: result.scored,
        scanned: result.scanned,
        sources: result.sources,
        errors: result.errors.length,
      });
    } catch (e) {
      console.error(
        `[cron/research-scan] project=${project.id} crashed:`,
        e instanceof Error ? e.message : e,
      );
      // Don't increment scanned — we treat a thrown scan as a no-op
      // for telemetry. The project's lastSyncedAt wasn't updated
      // either (the helper does that at the end of its own work),
      // so the next cron run picks it up again.
    }
  }

  return NextResponse.json({ success: true, ...summary });
}
