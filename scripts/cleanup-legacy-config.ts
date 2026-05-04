import { loadEnvConfig } from '@next/env';

// One-shot cleanup: drops the legacy `config` jsonb column on waitlist_pages.
// It was the original generic { primaryColor, showCount } container; we
// replaced it with `template_config` (typed per template) in PR #4 and
// nothing in the app reads it anymore. After running this, also remove the
// `config:` line from waitlistPages in lib/db/schema.ts and commit.
//
// REQUIRES MANUAL CONFIRMATION before running. This is a destructive op
// (the column itself is dropped, not nulled). Ask the operator first.
async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('Pre-flight: counting non-null config rows…');
  const rows = (await db.execute(sql`
    SELECT count(*)::int as n FROM waitlist_pages WHERE config IS NOT NULL
  `)) as Array<{ n: number }>;
  const nonNull = rows[0]?.n ?? 0;
  console.log(`  ${nonNull} row(s) have non-null config`);
  if (nonNull > 0) {
    console.log(
      '  → values will be lost. If you need them, snapshot before continuing.'
    );
  }

  console.log('Dropping waitlist_pages.config …');
  await db.execute(sql`
    ALTER TABLE waitlist_pages DROP COLUMN IF EXISTS config
  `);

  console.log('\nVerifying:');
  const cols = (await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'waitlist_pages' AND column_name = 'config'
  `)) as Array<{ column_name: string }>;
  console.log(`  config column still exists: ${cols.length > 0 ? 'YES (failed)' : 'no'}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
