import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('• waitlist_responses.template_config_snapshot …');
  await db.execute(sql`
    ALTER TABLE waitlist_responses
    ADD COLUMN IF NOT EXISTS template_config_snapshot jsonb
  `);

  console.log('• waitlist_responses.template_version …');
  await db.execute(sql`
    ALTER TABLE waitlist_responses
    ADD COLUMN IF NOT EXISTS template_version integer DEFAULT 1 NOT NULL
  `);

  console.log('• waitlist_pages.template_version …');
  await db.execute(sql`
    ALTER TABLE waitlist_pages
    ADD COLUMN IF NOT EXISTS template_version integer DEFAULT 1 NOT NULL
  `);

  console.log('\nVerifying:');
  const cols = (await db.execute(sql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE (table_name = 'waitlist_responses' AND column_name IN ('template_config_snapshot', 'template_version'))
       OR (table_name = 'waitlist_pages' AND column_name = 'template_version')
    ORDER BY table_name, column_name
  `)) as Array<{ table_name: string; column_name: string }>;
  for (const c of cols) console.log(`   ${c.table_name}.${c.column_name}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
