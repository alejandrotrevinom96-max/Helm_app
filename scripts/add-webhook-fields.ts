import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('• users.webhook_url …');
  await db.execute(sql`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS webhook_url text
  `);

  console.log('• users.webhook_secret …');
  await db.execute(sql`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS webhook_secret text
  `);

  console.log('\nVerifying:');
  const cols = (await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'users' AND column_name IN ('webhook_url', 'webhook_secret')
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
