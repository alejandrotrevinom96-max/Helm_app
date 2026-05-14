// PR Sprint 7.19 Round 3a — daily metric snapshot cron.
//
// Runs at 03:00 UTC. For each active project, computes a fixed
// set of "today's snapshot" metrics and UPSERTs them into
// metric_daily_snapshots. The insight engine (Round 3b) reads
// from this table to spot anomalies and generate hypotheses.
//
// Why 03:00 UTC: late enough that the prior calendar day is
// definitively closed in every timezone Helm cares about
// (Mexico/UTC-6 closed at 06:00 UTC, US East at 05:00 UTC,
// Europe at 23:00–01:00 UTC). Comfortable buffer.
//
// Auth: same CRON_SECRET pattern as /api/cron/sync-metrics.
// Refuses if the env var is unset (prevents a config drift
// from accidentally exposing the endpoint).
//
// Idempotent: re-running the same day overwrites yesterday's
// values via ON CONFLICT. Backfill script uses the same path
// with a date offset to populate 30 days of history.
import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { db } from '@/lib/db';
import {
  projects,
  generatedPosts,
  scheduledPosts,
  chatConversations,
  chatMessages,
  integrations,
  researchFindings,
  compassDecisions,
  voiceEngineAuditLog,
  metricDailySnapshots,
} from '@/lib/db/schema';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { logger } from '@/lib/observability/logger';

export const dynamic = 'force-dynamic';
// Long-running cron — give it room. Default is 10s on Vercel
// Hobby; bumping the maxDuration so we don't timeout when a
// founder has many projects.
export const maxDuration = 300;

// Output of computeOneDay() — list of metric rows for one
// project on one day. The cron unions across projects.
interface MetricRow {
  metricKey: string;
  value: number;
  dimensions?: Record<string, string> | null;
}

/**
 * Stable hash of dimensions for the UPSERT unique constraint.
 * NULL → empty string (matches the SQL COALESCE(..., '')).
 */
function dimensionsHash(d: Record<string, string> | null | undefined): string {
  if (!d || Object.keys(d).length === 0) return '';
  const sorted = Object.keys(d)
    .sort()
    .map((k) => `${k}=${d[k]}`)
    .join('|');
  return createHash('md5').update(sorted, 'utf8').digest('hex').slice(0, 12);
}

/**
 * Compute the metric snapshot rows for a single (project,
 * day-window) tuple. Window is [dayStart, dayEnd).
 *
 * All counts go through one consolidated query per project to
 * keep round-trips low. Each metric is a scalar subquery on
 * the consolidated SELECT.
 */
async function computeOneDay(
  projectId: string,
  dayStart: Date,
  dayEnd: Date,
): Promise<MetricRow[]> {
  const dayStartIso = dayStart.toISOString();
  const dayEndIso = dayEnd.toISOString();

  // Single SQL round-trip — 14 scalar subqueries. Postgres
  // pipelines them; same pattern as the admin overview fix.
  // Date params go as ISO strings to avoid the Drizzle/postgres-
  // js Date-serialization bug bitten before.
  const rows = (await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM generated_posts WHERE project_id = ${projectId}) AS drafts_total,
      (SELECT COUNT(*) FROM generated_posts WHERE project_id = ${projectId} AND created_at >= ${dayStartIso}::timestamp AND created_at < ${dayEndIso}::timestamp) AS drafts_created,
      (SELECT COUNT(*) FROM scheduled_posts WHERE project_id = ${projectId}) AS scheduled_total,
      (SELECT COUNT(*) FROM scheduled_posts WHERE project_id = ${projectId} AND status = 'scheduled') AS scheduled_pending,
      (SELECT COUNT(*) FROM scheduled_posts WHERE project_id = ${projectId} AND status = 'posted') AS published_total,
      (SELECT COUNT(*) FROM scheduled_posts WHERE project_id = ${projectId} AND posted_at >= ${dayStartIso}::timestamp AND posted_at < ${dayEndIso}::timestamp) AS published_today,
      (SELECT COUNT(*) FROM chat_conversations WHERE project_id = ${projectId}) AS chat_conversations_total,
      (SELECT COUNT(*) FROM chat_conversations WHERE project_id = ${projectId} AND status = 'active') AS chat_conversations_active,
      (SELECT COUNT(*) FROM chat_conversations WHERE project_id = ${projectId} AND mode = 'agent') AS chat_conversations_agent,
      (SELECT COUNT(*) FROM chat_messages cm JOIN chat_conversations cc ON cc.id = cm.conversation_id WHERE cc.project_id = ${projectId} AND cm.created_at >= ${dayStartIso}::timestamp AND cm.created_at < ${dayEndIso}::timestamp) AS chat_messages_today,
      (SELECT COUNT(*) FROM research_findings WHERE project_id = ${projectId}) AS research_findings_total,
      (SELECT COUNT(*) FROM research_findings WHERE project_id = ${projectId} AND found_at >= ${dayStartIso}::timestamp AND found_at < ${dayEndIso}::timestamp) AS research_findings_today,
      (SELECT COUNT(*) FROM compass_decisions WHERE project_id = ${projectId}) AS compass_decisions_total,
      (SELECT COUNT(*) FROM voice_engine_audit_log v JOIN client_contexts c ON c.id = v.client_context_id WHERE c.project_id = ${projectId} AND v.created_at >= ${dayStartIso}::timestamp AND v.created_at < ${dayEndIso}::timestamp) AS voice_audit_today
  `)) as unknown as Array<Record<string, string | number>>;

  const r = rows[0];
  if (!r) return [];

  // Normalize stringified bigints (postgres-js default for
  // COUNT) into JS numbers. Anything we can't parse falls back
  // to 0 — the metric row is still written so downstream code
  // sees a deterministic shape.
  const n = (v: unknown) => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const x = Number(v);
      return Number.isFinite(x) ? x : 0;
    }
    return 0;
  };

  // Per-platform integration count is a cheap aggregate worth
  // capturing for the insight engine ("did the founder
  // disconnect Meta yesterday?"). One extra query, grouped.
  const integrationRows = (await db
    .select({
      provider: integrations.provider,
      c: sql<string>`COUNT(*)`,
    })
    .from(integrations)
    .where(
      and(
        eq(
          integrations.userId,
          // Project doesn't directly link to userId here; we
          // fetch by joining via the project row. Cheap because
          // we're already keyed on projectId.
          sql`(SELECT user_id FROM projects WHERE id = ${projectId})`,
        ),
      ),
    )
    .groupBy(integrations.provider)) as unknown as Array<{
    provider: string;
    c: string;
  }>;

  const out: MetricRow[] = [
    { metricKey: 'posts.drafts.total', value: n(r.drafts_total) },
    { metricKey: 'posts.drafts.created_today', value: n(r.drafts_created) },
    { metricKey: 'posts.scheduled.total', value: n(r.scheduled_total) },
    { metricKey: 'posts.scheduled.pending', value: n(r.scheduled_pending) },
    { metricKey: 'posts.published.total', value: n(r.published_total) },
    { metricKey: 'posts.published.today', value: n(r.published_today) },
    {
      metricKey: 'chat.conversations.total',
      value: n(r.chat_conversations_total),
    },
    {
      metricKey: 'chat.conversations.active',
      value: n(r.chat_conversations_active),
    },
    {
      metricKey: 'chat.conversations.agent',
      value: n(r.chat_conversations_agent),
    },
    { metricKey: 'chat.messages.today', value: n(r.chat_messages_today) },
    { metricKey: 'research.findings.total', value: n(r.research_findings_total) },
    { metricKey: 'research.findings.today', value: n(r.research_findings_today) },
    { metricKey: 'compass.decisions.total', value: n(r.compass_decisions_total) },
    { metricKey: 'voice_engine.audit_events.today', value: n(r.voice_audit_today) },
  ];

  for (const ir of integrationRows) {
    out.push({
      metricKey: 'integrations.count',
      value: n(ir.c),
      dimensions: { provider: ir.provider },
    });
  }

  return out;
}

/**
 * UPSERT the metric rows for one (project, day) into
 * metric_daily_snapshots. Conflict resolution on the unique
 * (project, day, metric, dimensions_hash) index — overwrites
 * `value` so re-running the same day is idempotent.
 */
async function persistSnapshots(
  projectId: string,
  day: Date,
  rows: MetricRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const snapshotDateIso = day.toISOString().slice(0, 10);

  // Insert each row with ON CONFLICT update. Drizzle's
  // onConflictDoUpdate handles this cleanly. We insert in a
  // single batch to keep round-trips low.
  await db
    .insert(metricDailySnapshots)
    .values(
      rows.map((row) => ({
        projectId,
        snapshotDate: snapshotDateIso,
        metricKey: row.metricKey,
        value: row.value.toString(), // numeric() takes a string
        dimensions: row.dimensions ?? null,
        dimensionsHash: dimensionsHash(row.dimensions ?? null) || null,
      })),
    )
    .onConflictDoUpdate({
      target: [
        metricDailySnapshots.projectId,
        metricDailySnapshots.snapshotDate,
        metricDailySnapshots.metricKey,
        metricDailySnapshots.dimensionsHash,
      ],
      set: { value: sql`EXCLUDED.value`, createdAt: sql`now()` },
    });
}

/**
 * Snapshot every active project for a given day.
 * If `dateOverride` is set (used by the backfill script), uses
 * that day instead of "yesterday".
 */
async function snapshotAllProjects(dateOverride?: Date) {
  const targetDay = dateOverride ?? yesterdayUtc();
  const dayStart = startOfDayUtc(targetDay);
  const dayEnd = startOfDayUtc(new Date(dayStart.getTime() + 86400_000));

  const allProjects = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.isActive, true));

  let succeeded = 0;
  let failed = 0;
  for (const p of allProjects) {
    try {
      const rows = await computeOneDay(p.id, dayStart, dayEnd);
      await persistSnapshots(p.id, dayStart, rows);
      succeeded++;
    } catch (e) {
      failed++;
      logger.error('cron/snapshot-metrics', 'project snapshot failed', {
        projectId: p.id,
        snapshotDate: dayStart.toISOString().slice(0, 10),
        error: e,
      });
    }
  }
  return {
    snapshotDate: dayStart.toISOString().slice(0, 10),
    projectsConsidered: allProjects.length,
    succeeded,
    failed,
  };
}

function startOfDayUtc(d: Date): Date {
  const c = new Date(d.getTime());
  c.setUTCHours(0, 0, 0, 0);
  return c;
}
function yesterdayUtc(): Date {
  return new Date(Date.now() - 86400_000);
}

// ============================================================
// HTTP handler
// ============================================================

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

  // Optional ?date=YYYY-MM-DD override for one-off re-runs.
  // Used by the backfill script via the same auth path.
  const url = new URL(request.url);
  const dateParam = url.searchParams.get('date');
  let dateOverride: Date | undefined;
  if (dateParam) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return NextResponse.json(
        { error: 'Invalid date param (expected YYYY-MM-DD)' },
        { status: 400 },
      );
    }
    dateOverride = new Date(`${dateParam}T00:00:00Z`);
  }

  try {
    const summary = await snapshotAllProjects(dateOverride);
    logger.info('cron/snapshot-metrics', 'snapshot run complete', summary);
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    logger.error('cron/snapshot-metrics', 'snapshot run crashed', {
      error: e,
    });
    return NextResponse.json(
      { error: 'Snapshot run failed' },
      { status: 500 },
    );
  }
}

// Note: the backfill script (scripts/backfill-metric-snapshots.mjs)
// hits this endpoint via HTTP with ?date= overrides rather than
// importing snapshotAllProjects directly. Keeps a single auth +
// observability path through CRON_SECRET.
