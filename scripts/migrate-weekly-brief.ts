// PR #58 — Sprint 7.0.2: opt-in column for the Weekly Brief email.
//
// Defaults to FALSE — the cron must never email a user who hasn't
// flipped the toggle in Settings.
//
// Run with: `npx tsx scripts/migrate-weekly-brief.ts`
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('[migrate] Adding weekly_brief_enabled to users…');
  await db.execute(sql`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS weekly_brief_enabled BOOLEAN DEFAULT FALSE NOT NULL
  `);
  console.log('[migrate]  ✓ users.weekly_brief_enabled');

  console.log('[migrate] Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[migrate] Failed:', err);
  process.exit(1);
});
