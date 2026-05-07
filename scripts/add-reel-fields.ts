// PR #32 — Sprint 5.3: Instagram Reels.
//
// Adds Reel-specific columns to scheduled_posts (where the publishing
// lifecycle lives) plus minimal flags on generated_posts so the
// "post as Reel" intent travels with the draft.
//
// Indexes:
//   - idx_sp_reel_polling: partial index used by the poll-reels cron
//     to fetch only is_reel rows that are mid-processing — orders of
//     magnitude faster than scanning the whole scheduled_posts table.
//
// Idempotent: every ADD COLUMN uses IF NOT EXISTS. Safe to re-run.
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  const scheduledColumns: Array<[string, string]> = [
    ['is_reel', 'boolean NOT NULL DEFAULT false'],
    ['video_url', 'text'],
    ['video_duration_seconds', 'integer'],
    ['video_size_bytes', 'bigint'],
    ['video_aspect_ratio', 'numeric(5,4)'],
    ['reel_processing_status', 'text'],
    ['reel_processing_error', 'text'],
    ['reel_polling_attempts', 'integer NOT NULL DEFAULT 0'],
    ['reel_polling_next_at', 'timestamp'],
  ];

  console.log('• scheduled_posts reel columns …');
  for (const [col, type] of scheduledColumns) {
    await db.execute(
      sql.raw(
        `ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS ${col} ${type}`
      )
    );
    console.log(`    ${col}`);
  }

  console.log('\n• generated_posts.is_reel / video_url …');
  await db.execute(sql`
    ALTER TABLE generated_posts
    ADD COLUMN IF NOT EXISTS is_reel boolean NOT NULL DEFAULT false
  `);
  await db.execute(sql`
    ALTER TABLE generated_posts
    ADD COLUMN IF NOT EXISTS video_url text
  `);

  console.log('\n• poll-reels partial index …');
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_sp_reel_polling
      ON scheduled_posts(reel_polling_next_at, reel_processing_status)
      WHERE is_reel = true AND reel_processing_status = 'meta_processing'
  `);

  console.log('\nVerifying scheduled_posts reel columns:');
  const spCols = (await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'scheduled_posts'
      AND column_name IN (
        'is_reel', 'video_url', 'video_duration_seconds',
        'video_size_bytes', 'video_aspect_ratio',
        'reel_processing_status', 'reel_processing_error',
        'reel_polling_attempts', 'reel_polling_next_at'
      )
    ORDER BY column_name
  `)) as Array<{ column_name: string }>;
  for (const c of spCols) console.log('  ', c.column_name);

  console.log('\nVerifying generated_posts reel columns:');
  const gpCols = (await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'generated_posts'
      AND column_name IN ('is_reel', 'video_url')
    ORDER BY column_name
  `)) as Array<{ column_name: string }>;
  for (const c of gpCols) console.log('  ', c.column_name);

  console.log('\n✓ Reel fields ready');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
