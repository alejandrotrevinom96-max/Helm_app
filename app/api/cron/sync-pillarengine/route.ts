// PR Sprint pillarengine — cron pull job.
//
// GET /api/cron/sync-pillarengine  (auth: Bearer CRON_SECRET)
//
// Backup path for the real-time webhook (/api/pillarengine/webhook).
// Pulls /api/v1/pages?status=approved&since=<lastSync> from
// pillarengine.vercel.app every 6h (scheduled in vercel.json) and
// upserts each page through the same shared `upsertApprovedPage`
// helper the webhook uses, so the validation + collision rules are
// identical regardless of which path the page arrived through.
//
// Why both: the webhook gives us near-zero-latency publishing, but a
// network blip or a deploy window can swallow a single delivery. The
// cron catches those — `since=lastSync` makes the work bounded even
// if PillarEngine has hundreds of pages, and the upsert is idempotent
// so re-fetching a page the webhook already delivered just bumps
// updated_at without doing visible work.
//
// Last-sync bookkeeping lives in pillarengine_sync_state (a single-
// row config table). We update it ONLY on a fully successful run —
// a mid-batch failure leaves the timestamp alone so the next tick
// re-attempts the same window. The trade-off: a single transient
// failure replays N pages; cheaper than losing one.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { pillarengineSyncState } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import * as Sentry from '@sentry/nextjs';
import {
  upsertApprovedPage,
  type PillarengineApprovedPage,
} from '@/lib/pillarengine/ingest';

export const dynamic = 'force-dynamic';
// PillarEngine API call + N upserts. Each upsert is one DB write +
// a revalidatePath. We size for ~50 pages worst case — that's well
// under the Vercel 300s ceiling but generous.
export const maxDuration = 120;

const PILLARENGINE_API_BASE = 'https://pillarengine.vercel.app';
const SYNC_STATE_ID = 'pillarengine';
// First-run fallback: pull pages approved in the last 7 days when
// pillarengine_sync_state has no row yet. Wider would mean a giant
// first run for orgs with old PillarEngine projects; narrower would
// silently drop in-flight content. 7 days is a reasonable mid-point.
const FIRST_RUN_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

interface PillarenginePagesResponse {
  pages?: PillarengineApprovedPage[];
}

export async function GET(request: Request) {
  const t0 = Date.now();
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured on server' },
      { status: 503 },
    );
  }
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.PILLARENGINE_API_KEY;
  if (!apiKey) {
    Sentry.captureMessage('pillarengine_cron_api_key_missing', {
      level: 'error',
      tags: { area: 'pillarengine', kind: 'env-misconfigured' },
    });
    return NextResponse.json(
      { error: 'PILLARENGINE_API_KEY not configured on server' },
      { status: 503 },
    );
  }

  // 1. Read lastSync (or seed default if missing).
  const sinceIso = await readLastSyncIso();

  // 2. Fetch the approved-page window from PillarEngine.
  const url = `${PILLARENGINE_API_BASE}/api/v1/pages?status=approved&since=${encodeURIComponent(sinceIso)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      // Cron job — never cache. Always pull fresh.
      cache: 'no-store',
    });
  } catch (err) {
    await recordSyncError(err, Date.now() - t0);
    return NextResponse.json(
      {
        error: 'PillarEngine API unreachable',
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }

  if (!res.ok) {
    const bodySnippet = await res.text().catch(() => '');
    Sentry.captureMessage('pillarengine_cron_api_error', {
      level: 'error',
      tags: { area: 'pillarengine', kind: 'api-error' },
      extra: {
        status: res.status,
        bodySnippet: bodySnippet.slice(0, 800),
        sinceIso,
      },
    });
    await recordSyncError(
      new Error(`PillarEngine API returned ${res.status}`),
      Date.now() - t0,
    );
    return NextResponse.json(
      { error: 'PillarEngine API error', status: res.status },
      { status: 502 },
    );
  }

  let payload: PillarenginePagesResponse;
  try {
    payload = (await res.json()) as PillarenginePagesResponse;
  } catch (err) {
    await recordSyncError(err, Date.now() - t0);
    return NextResponse.json(
      { error: 'PillarEngine API returned invalid JSON' },
      { status: 502 },
    );
  }

  const pages = Array.isArray(payload.pages) ? payload.pages : [];

  // 3. Upsert each page. We continue on per-page errors so a single
  // bad page doesn't block the rest — the worst case is one row
  // skipped per cron, the webhook will retry it on the next
  // PillarEngine edit anyway.
  let createdCount = 0;
  let updatedCount = 0;
  const failures: Array<{ slug?: string; error: string }> = [];
  for (const page of pages) {
    const result = await upsertApprovedPage(page);
    if (!result.ok) {
      failures.push({ slug: page.slug, error: result.error });
      continue;
    }
    if (result.action === 'created') createdCount += 1;
    else updatedCount += 1;
  }

  const elapsedMs = Date.now() - t0;

  // 4. Bookkeeping. Only bump lastSyncAt when we had zero hard
  // failures — partial failures replay on the next tick. Drift here
  // is preferable to losing a page.
  const allOk = failures.length === 0;
  await persistSyncState({
    lastSyncAt: allOk ? new Date() : null,
    pagesSynced: createdCount + updatedCount,
    elapsedMs,
    lastError: failures.length > 0 ? JSON.stringify(failures).slice(0, 1000) : null,
  });

  Sentry.captureMessage('pillarengine_cron_completed', {
    level: failures.length > 0 ? 'warning' : 'info',
    tags: { area: 'pillarengine', kind: 'cron-completed' },
    extra: {
      sinceIso,
      pagesFetched: pages.length,
      created: createdCount,
      updated: updatedCount,
      failures: failures.length,
      elapsedMs,
    },
  });

  return NextResponse.json({
    ok: allOk,
    sinceIso,
    pagesFetched: pages.length,
    created: createdCount,
    updated: updatedCount,
    failures,
    elapsedMs,
  });
}

async function readLastSyncIso(): Promise<string> {
  try {
    const rows = await db
      .select()
      .from(pillarengineSyncState)
      .where(eq(pillarengineSyncState.id, SYNC_STATE_ID))
      .limit(1);
    const lastSyncAt = rows[0]?.lastSyncAt;
    if (lastSyncAt instanceof Date && !isNaN(lastSyncAt.getTime())) {
      return lastSyncAt.toISOString();
    }
  } catch (err) {
    Sentry.captureException(err, {
      tags: { area: 'pillarengine', kind: 'sync-state-read-failed' },
    });
  }
  // Default to ~7 days ago. Wider than a typical cron interval so a
  // missed run or two doesn't leave a coverage hole.
  return new Date(Date.now() - FIRST_RUN_LOOKBACK_MS).toISOString();
}

async function persistSyncState(args: {
  lastSyncAt: Date | null;
  pagesSynced: number;
  elapsedMs: number;
  lastError: string | null;
}) {
  try {
    // Upsert keyed by id so a fresh DB (no migrate-pillarengine
    // run yet) still gets a row written. ON CONFLICT updates the
    // mutable fields; lastSyncAt only updates when args.lastSyncAt
    // is non-null (a failed run preserves the previous successful
    // timestamp so the next tick replays the same window).
    await db
      .insert(pillarengineSyncState)
      .values({
        id: SYNC_STATE_ID,
        lastSyncAt: args.lastSyncAt,
        lastRunPagesSynced: args.pagesSynced,
        lastRunMs: args.elapsedMs,
        lastRunError: args.lastError,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: pillarengineSyncState.id,
        set: {
          // Don't clobber lastSyncAt with null on a failed run.
          lastSyncAt: args.lastSyncAt
            ? args.lastSyncAt
            : sql`${pillarengineSyncState.lastSyncAt}`,
          lastRunPagesSynced: args.pagesSynced,
          lastRunMs: args.elapsedMs,
          lastRunError: args.lastError,
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    // Non-fatal — the next tick will see whatever lastSyncAt was
    // there before. We log but don't propagate; the actual ingest
    // for this run already succeeded by the time we get here.
    Sentry.captureException(err, {
      tags: { area: 'pillarengine', kind: 'sync-state-write-failed' },
    });
  }
}

async function recordSyncError(err: unknown, elapsedMs: number) {
  try {
    await db
      .insert(pillarengineSyncState)
      .values({
        id: SYNC_STATE_ID,
        lastRunPagesSynced: 0,
        lastRunMs: elapsedMs,
        lastRunError: (err instanceof Error ? err.message : String(err)).slice(
          0,
          500,
        ),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: pillarengineSyncState.id,
        set: {
          lastRunPagesSynced: 0,
          lastRunMs: elapsedMs,
          lastRunError: (err instanceof Error
            ? err.message
            : String(err)
          ).slice(0, 500),
          updatedAt: new Date(),
        },
      });
  } catch {
    /* swallow — we're already in an error path */
  }
}
