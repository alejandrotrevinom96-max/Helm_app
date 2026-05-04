import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('• users.onboarding_step …');
  await db.execute(sql`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS onboarding_step integer DEFAULT 0 NOT NULL
  `);

  console.log('• users.onboarding_completed_at …');
  await db.execute(sql`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamp
  `);

  // Backfill: anyone who already had hasCompletedOnboarding=true is clearly
  // past the wizard, so mark step=99 to suppress it.
  console.log('• backfilling existing users …');
  const r = (await db.execute(sql`
    UPDATE users
    SET onboarding_step = 99,
        onboarding_completed_at = COALESCE(onboarding_completed_at, now())
    WHERE has_completed_onboarding = true AND onboarding_step = 0
  `)) as unknown as { count: number };
  console.log('  rows updated:', r.count ?? '?');

  console.log('\nVerifying:');
  const cols = (await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'users' AND column_name IN ('onboarding_step', 'onboarding_completed_at')
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
