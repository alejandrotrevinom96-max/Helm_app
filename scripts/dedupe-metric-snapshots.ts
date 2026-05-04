import { loadEnvConfig } from '@next/env';

// Two-phase migration:
// 1. Collapse existing duplicate rows into the most recently synced one
//    per (project_id, source, metric, date). The keep rule is "highest
//    synced_at wins" — that's the value the user saw on their last sync.
// 2. Add a UNIQUE constraint so future inserts can use ON CONFLICT DO
//    UPDATE to upsert instead of accumulating duplicates.
//
// Idempotent: re-running on a clean table is a no-op.
async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('• inspecting metric_snapshots …');
  const before = (await db.execute(sql`
    SELECT count(*)::int as n FROM metric_snapshots
  `)) as Array<{ n: number }>;
  console.log('  rows before:', before[0]?.n ?? 0);

  console.log('• dedupe duplicates …');
  await db.execute(sql`
    DELETE FROM metric_snapshots
    WHERE id NOT IN (
      SELECT DISTINCT ON (project_id, source, metric, date) id
      FROM metric_snapshots
      ORDER BY project_id, source, metric, date, synced_at DESC
    )
  `);

  const after = (await db.execute(sql`
    SELECT count(*)::int as n FROM metric_snapshots
  `)) as Array<{ n: number }>;
  console.log('  rows after dedupe:', after[0]?.n ?? 0);

  console.log('• adding unique constraint metric_snapshots_unique …');
  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'metric_snapshots_unique'
      ) THEN
        ALTER TABLE metric_snapshots
        ADD CONSTRAINT metric_snapshots_unique
        UNIQUE (project_id, source, metric, date);
      END IF;
    END $$;
  `);

  const constraint = (await db.execute(sql`
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'metric_snapshots'::regclass AND conname = 'metric_snapshots_unique'
  `)) as Array<{ conname: string }>;
  console.log('  constraint exists:', constraint.length > 0);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
