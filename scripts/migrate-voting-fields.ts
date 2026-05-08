// PR #42 — Sprint 6.7: one-time migration adding the voting
// columns to generated_posts.
//
// drizzle-kit's `db:push` failed with a TypeError parsing
// existing CHECK constraints (known bug in 0.18.x with newer
// Postgres versions). We sidestep it by issuing the three
// ALTER TABLE statements directly through the same Drizzle
// runtime client our app uses.
//
// Run with: `npx tsx scripts/migrate-voting-fields.ts`
//
// Idempotent — uses ADD COLUMN IF NOT EXISTS so re-running is
// safe. Drop this file once we've upgraded drizzle-kit to a
// version that handles the parse correctly.
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('[migrate] Adding voting columns to generated_posts…');
  await db.execute(sql`
    ALTER TABLE generated_posts
      ADD COLUMN IF NOT EXISTS user_vote TEXT
  `);
  console.log('[migrate]  ✓ user_vote');
  await db.execute(sql`
    ALTER TABLE generated_posts
      ADD COLUMN IF NOT EXISTS voted_at TIMESTAMP
  `);
  console.log('[migrate]  ✓ voted_at');
  await db.execute(sql`
    ALTER TABLE generated_posts
      ADD COLUMN IF NOT EXISTS visible_in_library BOOLEAN DEFAULT TRUE NOT NULL
  `);
  console.log('[migrate]  ✓ visible_in_library');
  console.log('[migrate] Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[migrate] Failed:', err);
  process.exit(1);
});
