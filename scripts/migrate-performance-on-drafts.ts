// PR #51 — Sprint 6.8.2: performance fields on generated_posts.
//
// Adds the same 4-column shape that scheduled_posts already
// carries (rating, note, metrics, ratedAt) so a single
// /api/marketing/posts/[id]/performance endpoint can write to
// either table without case-by-case schema drift.
//
// Same idempotent-ALTER pattern as the previous migrations
// (drizzle-kit db:push parses CHECK constraints poorly on this
// Postgres version, so we go through the runtime client).
//
// Run: `npx tsx scripts/migrate-performance-on-drafts.ts`
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('[migrate] Adding performance columns to generated_posts…');
  await db.execute(sql`
    ALTER TABLE generated_posts
      ADD COLUMN IF NOT EXISTS performance_rating TEXT
  `);
  console.log('[migrate]  ✓ performance_rating');
  await db.execute(sql`
    ALTER TABLE generated_posts
      ADD COLUMN IF NOT EXISTS performance_note TEXT
  `);
  console.log('[migrate]  ✓ performance_note');
  await db.execute(sql`
    ALTER TABLE generated_posts
      ADD COLUMN IF NOT EXISTS performance_metrics JSONB
  `);
  console.log('[migrate]  ✓ performance_metrics');
  await db.execute(sql`
    ALTER TABLE generated_posts
      ADD COLUMN IF NOT EXISTS performance_rated_at TIMESTAMP
  `);
  console.log('[migrate]  ✓ performance_rated_at');
  console.log('[migrate] Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[migrate] Failed:', err);
  process.exit(1);
});
