// PR #34 — Sprint 6.2: Landing viral preview.
//
// Creates two tables backing the landing-page "Try with your website"
// teaser:
//   - public_bible_previews: 7-day cache of {URL → AI preview}
//   - preview_rate_limits:   per-IP-hash sliding window
//
// Idempotent (IF NOT EXISTS on every CREATE). Safe to re-run.
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('• public_bible_previews …');
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS public_bible_previews (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      url_hash text NOT NULL UNIQUE,
      original_url text NOT NULL,
      preview_archetype text,
      preview_voice text,
      preview_pillars jsonb,
      preview_audience text,
      preview_one_liner text,
      generation_cost numeric(10, 6),
      visit_count integer NOT NULL DEFAULT 0,
      last_visited_at timestamp NOT NULL DEFAULT NOW(),
      created_at timestamp NOT NULL DEFAULT NOW(),
      expires_at timestamp
    )
  `);

  console.log('• indexes …');
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_pbp_hash
      ON public_bible_previews(url_hash)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_pbp_expires
      ON public_bible_previews(expires_at)
  `);

  console.log('• preview_rate_limits …');
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS preview_rate_limits (
      ip_hash text PRIMARY KEY,
      count integer NOT NULL DEFAULT 0,
      window_start timestamp NOT NULL DEFAULT NOW(),
      blocked_until timestamp
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_prl_window
      ON preview_rate_limits(window_start)
  `);

  console.log('\nVerifying public_bible_previews:');
  const cols = (await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'public_bible_previews'
    ORDER BY ordinal_position
  `)) as Array<{ column_name: string }>;
  for (const c of cols) console.log('  ', c.column_name);

  console.log('\n✓ Public bible previews schema ready');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
