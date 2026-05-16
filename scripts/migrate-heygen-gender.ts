// PR Sprint C — add heygen_avatar_gender + heygen_voice_gender
// to projects so the picker can auto-match voices to avatars by
// gender, and so fire.ts can refuse to render with a gender
// mismatch instead of silently producing male-avatar-female-voice
// outputs.
//
// Idempotent: ADD COLUMN IF NOT EXISTS. Safe to re-run.
//
// Run with: `npx tsx scripts/migrate-heygen-gender.ts`
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('[migrate] Adding gender columns to projects…');
  await db.execute(sql`
    ALTER TABLE projects
      ADD COLUMN IF NOT EXISTS heygen_avatar_gender text
  `);
  console.log('[migrate]   ✓ heygen_avatar_gender');
  await db.execute(sql`
    ALTER TABLE projects
      ADD COLUMN IF NOT EXISTS heygen_voice_gender text
  `);
  console.log('[migrate]   ✓ heygen_voice_gender');

  console.log('[migrate] Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[migrate] Failed:', err);
  process.exit(1);
});
