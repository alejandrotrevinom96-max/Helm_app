import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('• waitlist_pages.survey_analysis …');
  await db.execute(sql`
    ALTER TABLE waitlist_pages
    ADD COLUMN IF NOT EXISTS survey_analysis jsonb
  `);

  console.log('\nVerifying:');
  const cols = (await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'waitlist_pages' AND column_name = 'survey_analysis'
  `)) as Array<{ column_name: string }>;
  console.log('  survey_analysis exists:', cols.length > 0);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
