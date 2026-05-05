import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('• projects.supabase_tables …');
  await db.execute(sql`
    ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS supabase_tables jsonb
  `);

  console.log('\nVerifying:');
  const cols = (await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'projects' AND column_name = 'supabase_tables'
  `)) as Array<{ column_name: string }>;
  console.log('  exists:', cols.length > 0);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
