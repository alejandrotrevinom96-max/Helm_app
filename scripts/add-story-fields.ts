// PR #30 — Sprint 5.2: Instagram Stories auto-posting.
//
// Adds the is_story flag (drafts + scheduled) and story_expires_at
// timestamp (scheduled only — drafts have no expiration concept).
//
// Plus a partial index on story_expires_at for fast "expired stories"
// scans the UI uses to fade old story permalinks.
//
// Idempotent — IF NOT EXISTS on every column + index. Safe to re-run.
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('• scheduled_posts.is_story / story_expires_at …');
  await db.execute(sql`
    ALTER TABLE scheduled_posts
    ADD COLUMN IF NOT EXISTS is_story boolean NOT NULL DEFAULT false
  `);
  await db.execute(sql`
    ALTER TABLE scheduled_posts
    ADD COLUMN IF NOT EXISTS story_expires_at timestamp
  `);

  console.log('• generated_posts.is_story …');
  await db.execute(sql`
    ALTER TABLE generated_posts
    ADD COLUMN IF NOT EXISTS is_story boolean NOT NULL DEFAULT false
  `);

  console.log('• partial index for active vs expired stories …');
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_sp_story_active
      ON scheduled_posts(story_expires_at)
      WHERE is_story = true
  `);

  console.log('\nVerifying scheduled_posts new columns:');
  const spCols = (await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'scheduled_posts'
      AND column_name IN ('is_story', 'story_expires_at')
    ORDER BY column_name
  `)) as Array<{ column_name: string }>;
  for (const c of spCols) console.log('  ', c.column_name);

  console.log('\nVerifying generated_posts new columns:');
  const gpCols = (await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'generated_posts'
      AND column_name = 'is_story'
  `)) as Array<{ column_name: string }>;
  for (const c of gpCols) console.log('  ', c.column_name);

  console.log('\n✓ Story fields ready');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
