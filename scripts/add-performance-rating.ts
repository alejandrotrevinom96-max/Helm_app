import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('• scheduled_posts.performance_rating …');
  await db.execute(sql`
    ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS performance_rating text
  `);

  console.log('• scheduled_posts.performance_note …');
  await db.execute(sql`
    ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS performance_note text
  `);

  console.log('• scheduled_posts.rated_at …');
  await db.execute(sql`
    ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS rated_at timestamp
  `);

  console.log('\nVerifying:');
  const cols = (await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'scheduled_posts'
      AND column_name IN ('performance_rating', 'performance_note', 'rated_at')
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
