// PR Sprint B-finish — user_integration_opt_outs table for the
// per-user soft-disconnect flow on deploy-wide integrations (X /
// Twitter currently).
//
// Idempotent: CREATE TABLE IF NOT EXISTS + the unique constraint
// is part of the CREATE. Safe to re-run.
//
// Run with: `npx tsx scripts/migrate-user-integration-opt-outs.ts`
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('[migrate] Creating user_integration_opt_outs…');
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS user_integration_opt_outs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider text NOT NULL,
      opted_out_at timestamp NOT NULL DEFAULT now(),
      CONSTRAINT user_integration_opt_outs_user_provider_unique
        UNIQUE (user_id, provider)
    )
  `);
  console.log('[migrate]   ✓ user_integration_opt_outs');

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_user_integration_opt_outs_user
      ON user_integration_opt_outs (user_id)
  `);
  console.log('[migrate]   ✓ idx_user_integration_opt_outs_user');

  console.log('[migrate] Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[migrate] Failed:', err);
  process.exit(1);
});
