// PR Sprint 7.25 Phase 11.5 — heygen_jobs.attempt_count column.
//
// The new /api/cron/heygen-worker auto-retries `status='failed'`
// rows up to MAX_HEYGEN_ATTEMPTS times for transient upstream
// errors (HeyGen 5xx, timeouts). Voice-config and not-configured
// errors don't retry — the worker checks errorKind before promoting
// failed → queued.
//
// Idempotent (`ADD COLUMN IF NOT EXISTS`) so it's safe to re-run.
//
// Run with: `DATABASE_URL=<prod_url> npx tsx scripts/add-heygen-attempt-count.ts`

import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('• heygen_jobs.attempt_count …');
  await db.execute(sql`
    ALTER TABLE heygen_jobs
    ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0
  `);

  console.log('\nVerifying:');
  const cols = (await db.execute(sql`
    SELECT column_name, data_type, column_default, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'heygen_jobs'
      AND column_name = 'attempt_count'
  `)) as Array<{
    column_name: string;
    data_type: string;
    column_default: string | null;
    is_nullable: string;
  }>;
  for (const c of cols) {
    console.log(
      `   ${c.column_name}  ${c.data_type}  default=${c.column_default ?? 'null'}  nullable=${c.is_nullable}`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
