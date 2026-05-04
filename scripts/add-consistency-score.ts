import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('• scheduled_posts.consistency_score …');
  await db.execute(sql`
    ALTER TABLE scheduled_posts
    ADD COLUMN IF NOT EXISTS consistency_score integer
  `);

  console.log('• scheduled_posts.score_breakdown …');
  await db.execute(sql`
    ALTER TABLE scheduled_posts
    ADD COLUMN IF NOT EXISTS score_breakdown jsonb
  `);

  console.log('\nVerifying:');
  const cols = (await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'scheduled_posts'
      AND column_name IN ('consistency_score', 'score_breakdown')
    ORDER BY column_name
  `)) as Array<{ column_name: string }>;
  for (const c of cols) console.log('  ', c.column_name);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
