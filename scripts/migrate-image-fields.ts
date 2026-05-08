// PR #43 — Sprint 6.7.1: one-time migration adding image_url +
// image_prompt to generated_posts so visuals persist past page
// reload (founder reported them disappearing when Liking a draft
// without clicking "Use this draft" first).
//
// Same workaround as scripts/migrate-voting-fields.ts: drizzle-kit
// db:push parses CHECK constraints incorrectly on this Postgres
// version, so we ALTER directly via the runtime client. ADD
// COLUMN IF NOT EXISTS keeps re-runs safe.
//
// Run with: `npx tsx scripts/migrate-image-fields.ts`
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('[migrate] Adding image columns to generated_posts…');
  await db.execute(sql`
    ALTER TABLE generated_posts
      ADD COLUMN IF NOT EXISTS image_url TEXT
  `);
  console.log('[migrate]  ✓ image_url');
  await db.execute(sql`
    ALTER TABLE generated_posts
      ADD COLUMN IF NOT EXISTS image_prompt TEXT
  `);
  console.log('[migrate]  ✓ image_prompt');
  console.log('[migrate] Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[migrate] Failed:', err);
  process.exit(1);
});
