// PR #23 — Sprint 2.2: Library funcional.
//
// Adds:
//   - scheduled_posts.metrics_{impressions,likes,comments,shares} (int, nullable)
//     so the founder can manually log metrics from the Library detail modal.
//   - generated_posts.cloned_from_id (uuid, nullable, no FK because the
//     reference can point to either generated_posts OR scheduled_posts).
//
// Idempotent: every ALTER uses IF NOT EXISTS so re-running is safe.
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('• scheduled_posts.metrics_impressions …');
  await db.execute(sql`
    ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS metrics_impressions integer
  `);

  console.log('• scheduled_posts.metrics_likes …');
  await db.execute(sql`
    ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS metrics_likes integer
  `);

  console.log('• scheduled_posts.metrics_comments …');
  await db.execute(sql`
    ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS metrics_comments integer
  `);

  console.log('• scheduled_posts.metrics_shares …');
  await db.execute(sql`
    ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS metrics_shares integer
  `);

  console.log('• generated_posts.cloned_from_id …');
  await db.execute(sql`
    ALTER TABLE generated_posts ADD COLUMN IF NOT EXISTS cloned_from_id uuid
  `);

  console.log('\nVerifying scheduled_posts:');
  const sCols = (await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'scheduled_posts'
      AND column_name IN (
        'metrics_impressions', 'metrics_likes',
        'metrics_comments', 'metrics_shares'
      )
    ORDER BY column_name
  `)) as Array<{ column_name: string }>;
  for (const c of sCols) console.log('  ', c.column_name);

  console.log('\nVerifying generated_posts:');
  const gCols = (await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'generated_posts'
      AND column_name = 'cloned_from_id'
  `)) as Array<{ column_name: string }>;
  for (const c of gCols) console.log('  ', c.column_name);

  console.log('\n✓ Library fields ready');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
