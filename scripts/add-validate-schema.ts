import { loadEnvConfig } from '@next/env';

// Same idempotent pattern as the previous schema scripts.
async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('• waitlist_pages.template …');
  await db.execute(sql`
    ALTER TABLE waitlist_pages
    ADD COLUMN IF NOT EXISTS template text DEFAULT 'minimal'
  `);

  console.log('• waitlist_pages.template_config …');
  await db.execute(sql`
    ALTER TABLE waitlist_pages
    ADD COLUMN IF NOT EXISTS template_config jsonb DEFAULT '{}'::jsonb
  `);

  console.log('• waitlist_responses table …');
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS waitlist_responses (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      waitlist_page_id uuid NOT NULL REFERENCES waitlist_pages(id) ON DELETE CASCADE,
      email text,
      responses jsonb DEFAULT '{}'::jsonb,
      ip_hash text,
      user_agent text,
      created_at timestamp NOT NULL DEFAULT now()
    )
  `);

  console.log('• index on waitlist_responses(waitlist_page_id) …');
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS waitlist_responses_page_idx
    ON waitlist_responses(waitlist_page_id)
  `);

  console.log('\nVerifying:');
  const cols = (await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'waitlist_pages'
      AND column_name IN ('template', 'template_config')
    ORDER BY column_name
  `)) as Array<{ column_name: string }>;
  console.log('  waitlist_pages new columns:', cols.map((c) => c.column_name));

  const tables = (await db.execute(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_name = 'waitlist_responses'
  `)) as Array<{ table_name: string }>;
  console.log('  waitlist_responses exists:', tables.length > 0);

  const indexes = (await db.execute(sql`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'waitlist_responses'
  `)) as Array<{ indexname: string }>;
  console.log('  indexes:', indexes.map((i) => i.indexname));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
