// PR #65 — Sprint 7.0.8: visualUrls jsonb arrays for carousel
// slide images on both generated_posts and scheduled_posts.
//
// Run with: `npx tsx scripts/migrate-visual-urls.ts`
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('[migrate] Adding visual_urls to generated_posts…');
  await db.execute(sql`
    ALTER TABLE generated_posts
      ADD COLUMN IF NOT EXISTS visual_urls JSONB
  `);
  console.log('[migrate]  ✓ generated_posts.visual_urls');

  console.log('[migrate] Adding visual_urls to scheduled_posts…');
  await db.execute(sql`
    ALTER TABLE scheduled_posts
      ADD COLUMN IF NOT EXISTS visual_urls JSONB
  `);
  console.log('[migrate]  ✓ scheduled_posts.visual_urls');

  console.log('[migrate] Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[migrate] Failed:', err);
  process.exit(1);
});
