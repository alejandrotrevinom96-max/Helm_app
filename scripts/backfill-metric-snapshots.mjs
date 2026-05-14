// Sprint 7.19 Round 3a — backfill metric_daily_snapshots for
// the trailing 30 days. Run once after the migration lands so
// the anomaly detector (Round 3b) has a 30-day baseline.
//
// Usage:
//   node scripts/backfill-metric-snapshots.mjs
//   node scripts/backfill-metric-snapshots.mjs --days=14
//   node scripts/backfill-metric-snapshots.mjs --url=https://trythelm.com
//
// Needs in env:
//   CRON_SECRET — the same secret the cron uses
//   (optional) BASE_URL — defaults to https://trythelm.com
//
// Behavior:
//   - For each day from N days ago up to yesterday (inclusive),
//     calls GET /api/cron/snapshot-metrics?date=YYYY-MM-DD with
//     the bearer token. Idempotent — re-runs overwrite.
//   - Slow on purpose: serialized (one date at a time), 500ms
//     sleep between calls so we don't spike the DB.
//   - Logs progress to stdout. Continues on individual day
//     failure (logs + counts) and exits non-zero at the end if
//     any day failed.

import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd());

const args = process.argv.slice(2).reduce((acc, a) => {
  const m = a.match(/^--([^=]+)=(.+)$/);
  if (m) acc[m[1]] = m[2];
  return acc;
}, {});

const days = Number(args.days ?? 30);
const baseUrl = args.url ?? process.env.BASE_URL ?? 'https://trythelm.com';
const secret = process.env.CRON_SECRET;

if (!secret) {
  console.error('CRON_SECRET missing in env');
  process.exit(1);
}
if (!Number.isFinite(days) || days < 1 || days > 365) {
  console.error('--days must be 1..365');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isoDay = (offsetDays) => {
  const d = new Date(Date.now() - offsetDays * 86400_000);
  return d.toISOString().slice(0, 10);
};

let succeeded = 0;
let failed = 0;

// Walk from oldest to newest so logs read in chronological order.
for (let offset = days; offset >= 1; offset--) {
  const date = isoDay(offset);
  const url = `${baseUrl}/api/cron/snapshot-metrics?date=${date}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[backfill] FAIL ${date} status=${res.status}`, body);
      failed++;
    } else {
      console.log(
        `[backfill] OK   ${date} projects=${body.projectsConsidered} succeeded=${body.succeeded} failed=${body.failed}`,
      );
      succeeded++;
    }
  } catch (e) {
    console.error(`[backfill] FAIL ${date} threw:`, e.message);
    failed++;
  }
  await sleep(500);
}

console.log(`\n[backfill] done: ${succeeded} OK, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
