// PR #59 — Sprint 7.0.3: research_cache table + Reddit RSS opt-in
// columns on research_config.
//
// Run with: `npx tsx scripts/migrate-reddit-rss.ts`
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('[migrate] Creating research_cache…');
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS research_cache (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      cache_key TEXT NOT NULL UNIQUE,
      cache_value JSONB NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  console.log('[migrate]  ✓ research_cache');

  // The UNIQUE on cache_key already creates an index for lookup, but
  // expires_at scans need their own index for the cleanup sweep.
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS research_cache_expires_idx
      ON research_cache (expires_at)
  `);
  console.log('[migrate]  ✓ research_cache_expires_idx');

  console.log('[migrate] Adding Reddit RSS opt-in columns to research_config…');
  await db.execute(sql`
    ALTER TABLE research_config
      ADD COLUMN IF NOT EXISTS reddit_rss_optin BOOLEAN DEFAULT FALSE NOT NULL
  `);
  console.log('[migrate]  ✓ research_config.reddit_rss_optin');
  await db.execute(sql`
    ALTER TABLE research_config
      ADD COLUMN IF NOT EXISTS reddit_rss_optin_at TIMESTAMP
  `);
  console.log('[migrate]  ✓ research_config.reddit_rss_optin_at');

  console.log('[migrate] Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[migrate] Failed:', err);
  process.exit(1);
});
