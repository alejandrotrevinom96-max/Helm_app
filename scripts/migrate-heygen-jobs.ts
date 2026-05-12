// PR #76 — Sprint 7.3: HeyGen video generation queue table.
// See lib/db/schema.ts for the heygenJobs comment.
//
// Run with: `npx tsx scripts/migrate-heygen-jobs.ts`
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('[migrate] Creating heygen_jobs…');
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS heygen_jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      draft_id UUID NOT NULL REFERENCES generated_posts(id) ON DELETE CASCADE,
      project_id UUID NOT NULL,
      user_id UUID NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      script_text TEXT NOT NULL,
      avatar_id TEXT,
      voice_id TEXT,
      video_url TEXT,
      thumbnail_url TEXT,
      duration_seconds INTEGER,
      heygen_job_id TEXT,
      heygen_status TEXT,
      error_message TEXT,
      error_kind TEXT,
      requested_at TIMESTAMP NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMP,
      completed_at TIMESTAMP
    )
  `);
  console.log('[migrate]  ✓ heygen_jobs');

  // Hot path 1: "what are this project's videos?" — Library UI
  // hits this when rendering badges.
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS heygen_jobs_project_requested_idx
      ON heygen_jobs (project_id, requested_at DESC)
  `);
  console.log('[migrate]  ✓ heygen_jobs_project_requested_idx');

  // Hot path 2: the worker (when it ships) scans for queued or
  // processing rows. Partial index keeps it tiny.
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS heygen_jobs_active_idx
      ON heygen_jobs (status, requested_at ASC)
      WHERE status IN ('queued', 'processing')
  `);
  console.log('[migrate]  ✓ heygen_jobs_active_idx');

  console.log('[migrate] Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[migrate] Failed:', err);
  process.exit(1);
});
