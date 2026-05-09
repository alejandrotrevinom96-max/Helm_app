// PR #49 — Sprint 6.8: voice_fingerprint columns on projects.
// Same workaround pattern as Sprint 6.7.1 / 6.7.2 migrations:
// drizzle-kit's db:push parses CHECK constraints poorly, so we
// ALTER directly through the runtime client. Idempotent via ADD
// COLUMN IF NOT EXISTS.
//
// Run: `npx tsx scripts/migrate-voice-fingerprint.ts`
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('[migrate] Adding voice_fingerprint columns to projects…');
  await db.execute(sql`
    ALTER TABLE projects
      ADD COLUMN IF NOT EXISTS voice_fingerprint JSONB
  `);
  console.log('[migrate]  ✓ voice_fingerprint');
  await db.execute(sql`
    ALTER TABLE projects
      ADD COLUMN IF NOT EXISTS voice_fingerprint_updated_at TIMESTAMP
  `);
  console.log('[migrate]  ✓ voice_fingerprint_updated_at');
  console.log('[migrate] Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[migrate] Failed:', err);
  process.exit(1);
});
