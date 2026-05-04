import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('• scheduled_posts.visual_url …');
  await db.execute(sql`
    ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS visual_url text
  `);

  console.log('• scheduled_posts.visual_prompt …');
  await db.execute(sql`
    ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS visual_prompt text
  `);

  console.log('• scheduled_posts.visual_type …');
  await db.execute(sql`
    ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS visual_type text
  `);

  console.log('\nVerifying:');
  const cols = (await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'scheduled_posts'
      AND column_name IN ('visual_url', 'visual_prompt', 'visual_type')
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
