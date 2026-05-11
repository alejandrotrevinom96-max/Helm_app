// PR #63 — Sprint 7.0.6: contentType + structuredContent on
// scheduled_posts so the Sprint 7.0.5 Calendar/Library badge work
// has data to display.
//
// Run with: `npx tsx scripts/migrate-scheduled-content-type.ts`
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log(
    '[migrate] Adding contentType + structuredContent to scheduled_posts…',
  );
  await db.execute(sql`
    ALTER TABLE scheduled_posts
      ADD COLUMN IF NOT EXISTS content_type TEXT
  `);
  console.log('[migrate]  ✓ scheduled_posts.content_type');
  await db.execute(sql`
    ALTER TABLE scheduled_posts
      ADD COLUMN IF NOT EXISTS structured_content JSONB
  `);
  console.log('[migrate]  ✓ scheduled_posts.structured_content');

  console.log('[migrate] Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[migrate] Failed:', err);
  process.exit(1);
});
