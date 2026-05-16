// PR Sprint D-5 — create heygen_translation_jobs table.
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('[migrate] Creating heygen_translation_jobs…');
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS heygen_translation_jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      source_job_id uuid NOT NULL REFERENCES heygen_jobs(id) ON DELETE CASCADE,
      heygen_translation_id text NOT NULL,
      target_language text NOT NULL,
      mode text NOT NULL DEFAULT 'speed',
      status text NOT NULL DEFAULT 'pending',
      result_video_url text,
      result_caption_url text,
      duration_sec numeric(7,2),
      error_message text,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now(),
      completed_at timestamp
    )
  `);
  console.log('[migrate]   ✓ heygen_translation_jobs');

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_heygen_translation_source_job
      ON heygen_translation_jobs (source_job_id, created_at DESC)
  `);
  console.log('[migrate]   ✓ idx_heygen_translation_source_job');

  console.log('[migrate] Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[migrate] Failed:', err);
  process.exit(1);
});
