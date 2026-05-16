// PR Sprint D-1 — add voice & avatar tuning columns to projects
// so the founder can override emotion, locale, speed,
// expressiveness, and motion prompt per project.
//
// Idempotent: ADD COLUMN IF NOT EXISTS. Safe to re-run.
//
// Run with: `npx tsx scripts/migrate-heygen-tuning.ts`
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('[migrate] Adding HeyGen tuning columns to projects…');
  await db.execute(sql`
    ALTER TABLE projects
      ADD COLUMN IF NOT EXISTS heygen_voice_emotion text
  `);
  console.log('[migrate]   ✓ heygen_voice_emotion');
  await db.execute(sql`
    ALTER TABLE projects
      ADD COLUMN IF NOT EXISTS heygen_voice_locale text
  `);
  console.log('[migrate]   ✓ heygen_voice_locale');
  await db.execute(sql`
    ALTER TABLE projects
      ADD COLUMN IF NOT EXISTS heygen_voice_speed numeric(3,2)
  `);
  console.log('[migrate]   ✓ heygen_voice_speed');
  await db.execute(sql`
    ALTER TABLE projects
      ADD COLUMN IF NOT EXISTS heygen_avatar_expressiveness text
  `);
  console.log('[migrate]   ✓ heygen_avatar_expressiveness');
  await db.execute(sql`
    ALTER TABLE projects
      ADD COLUMN IF NOT EXISTS heygen_avatar_motion_prompt text
  `);
  console.log('[migrate]   ✓ heygen_avatar_motion_prompt');

  console.log('[migrate] Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[migrate] Failed:', err);
  process.exit(1);
});
