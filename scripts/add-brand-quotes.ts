import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('• brand_quotes table …');
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS brand_quotes (
      id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content text NOT NULL,
      source text,
      context text,
      tags text[],
      usage_count integer DEFAULT 0 NOT NULL,
      last_used_at timestamp,
      created_at timestamp DEFAULT now() NOT NULL,
      updated_at timestamp DEFAULT now() NOT NULL
    )
  `);

  console.log('• brand_quotes_project_idx …');
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS brand_quotes_project_idx
    ON brand_quotes(project_id)
  `);

  console.log('\nVerifying:');
  const cols = (await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'brand_quotes'
    ORDER BY ordinal_position
  `)) as Array<{ column_name: string }>;
  for (const c of cols) console.log('  ', c.column_name);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
