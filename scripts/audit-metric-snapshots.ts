import { loadEnvConfig } from '@next/env';

// Read-only audit. Reports:
//   1. Top duplicate (project_id, source, metric) groups — if any group
//      has count > 1, the unique constraint isn't holding.
//   2. Whether the unique constraint actually exists on the table.
//   3. The latest snapshot value per (project, source, metric) so the
//      user can sanity-check against their integration source-of-truth
//      (e.g. Supabase Auth users count).
//
// Run with: DATABASE_URL=<prod> npx tsx scripts/audit-metric-snapshots.ts
async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('• total rows in metric_snapshots:');
  const total = (await db.execute(sql`
    SELECT count(*)::int as n FROM metric_snapshots
  `)) as Array<{ n: number }>;
  console.log('  ', total[0]?.n ?? 0);

  console.log('\n• constraints on metric_snapshots:');
  const constraints = (await db.execute(sql`
    SELECT conname, pg_get_constraintdef(oid) as def
    FROM pg_constraint
    WHERE conrelid = 'metric_snapshots'::regclass
  `)) as Array<{ conname: string; def: string }>;
  for (const c of constraints) {
    console.log(`   ${c.conname}: ${c.def}`);
  }

  console.log('\n• groups with duplicates (project, source, metric, date):');
  const dupes = (await db.execute(sql`
    SELECT
      project_id,
      source,
      metric,
      date,
      count(*)::int as row_count
    FROM metric_snapshots
    GROUP BY project_id, source, metric, date
    HAVING count(*) > 1
    ORDER BY count(*) DESC
    LIMIT 20
  `)) as Array<{
    project_id: string;
    source: string;
    metric: string;
    date: string;
    row_count: number;
  }>;
  if (dupes.length === 0) {
    console.log('   (none — unique constraint is holding)');
  } else {
    for (const d of dupes) {
      console.log(
        `   ${d.project_id} / ${d.source} / ${d.metric} @ ${d.date}: ${d.row_count} rows`
      );
    }
  }

  console.log(
    '\n• latest snapshot per (project, source, metric) — what the dashboard SHOULD show:'
  );
  const latest = (await db.execute(sql`
    SELECT DISTINCT ON (ms.project_id, ms.source, ms.metric)
      p.name as project_name,
      ms.source,
      ms.metric,
      ms.value,
      ms.date,
      ms.synced_at
    FROM metric_snapshots ms
    JOIN projects p ON p.id = ms.project_id
    ORDER BY ms.project_id, ms.source, ms.metric, ms.synced_at DESC
  `)) as Array<{
    project_name: string;
    source: string;
    metric: string;
    value: string;
    date: string;
    synced_at: Date | string;
  }>;
  for (const r of latest) {
    console.log(
      `   [${r.project_name}] ${r.source}/${r.metric}: ${r.value} (synced ${r.synced_at})`
    );
  }

  console.log(
    '\n• total rows per (project, source, metric) — sums that pre-PR-18 dashboard would have shown:'
  );
  const sums = (await db.execute(sql`
    SELECT
      p.name as project_name,
      ms.source,
      ms.metric,
      sum(ms.value)::int as old_dashboard_sum,
      count(*)::int as snapshot_count
    FROM metric_snapshots ms
    JOIN projects p ON p.id = ms.project_id
    GROUP BY p.name, ms.source, ms.metric
    ORDER BY snapshot_count DESC
  `)) as Array<{
    project_name: string;
    source: string;
    metric: string;
    old_dashboard_sum: number;
    snapshot_count: number;
  }>;
  for (const r of sums) {
    console.log(
      `   [${r.project_name}] ${r.source}/${r.metric}: sum=${r.old_dashboard_sum} across ${r.snapshot_count} snapshot(s)`
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
