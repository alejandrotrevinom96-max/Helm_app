// PR #72 — Sprint 7.2A hotfix: brand_analysis_jobs idempotency
// tracker. See lib/db/schema.ts for the table comment.
//
// Run with: `npx tsx scripts/migrate-brand-analysis-jobs.ts`
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('[migrate] Creating brand_analysis_jobs…');
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS brand_analysis_jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id UUID NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      error_kind TEXT,
      error_message TEXT,
      started_at TIMESTAMP NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMP
    )
  `);
  console.log('[migrate]  ✓ brand_analysis_jobs');

  // Partial index — fast lookup of "is there a running job for this
  // project right now?" without scanning historical rows. The hotpath
  // is `WHERE project_id = ? AND status = 'running'` which the
  // partial index serves in O(log n).
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS brand_analysis_jobs_project_running_idx
      ON brand_analysis_jobs (project_id, started_at DESC)
      WHERE status = 'running'
  `);
  console.log('[migrate]  ✓ brand_analysis_jobs_project_running_idx');

  console.log('[migrate] Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[migrate] Failed:', err);
  process.exit(1);
});
