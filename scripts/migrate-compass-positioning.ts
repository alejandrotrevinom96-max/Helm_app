// PR #67 — Sprint 7.1A: competitors + positioning_benchmarks tables
// for the Compass deep-dive #1 (Positioning Benchmark).
//
// Run with: `npx tsx scripts/migrate-compass-positioning.ts`
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('[migrate] Creating competitors…');
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS competitors (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id UUID NOT NULL,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      type TEXT,
      detected_by TEXT NOT NULL DEFAULT 'ai',
      confidence_score INTEGER,
      approved_by_user BOOLEAN NOT NULL DEFAULT FALSE,
      scraped_at TIMESTAMP,
      headline TEXT,
      value_prop TEXT,
      target_audience TEXT,
      pricing_visible JSONB,
      platform_presence JSONB,
      content_angles JSONB,
      positioning_summary TEXT,
      where_they_win TEXT,
      where_they_lose TEXT,
      scrape_status TEXT NOT NULL DEFAULT 'pending',
      scrape_error TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT competitors_project_url_uk UNIQUE (project_id, url)
    )
  `);
  console.log('[migrate]  ✓ competitors');
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS competitors_project_status_idx
      ON competitors (project_id, scrape_status)
  `);
  console.log('[migrate]  ✓ competitors_project_status_idx');

  console.log('[migrate] Creating positioning_benchmarks…');
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS positioning_benchmarks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id UUID NOT NULL,
      market_gap TEXT,
      unique_positioning TEXT,
      opportunities_accionable JSONB,
      defensive_weaknesses JSONB,
      comparison_dimensions JSONB,
      competitors_analyzed INTEGER,
      model_used TEXT DEFAULT 'claude-opus-4-7',
      generation_cost_usd NUMERIC(10, 4),
      expires_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  console.log('[migrate]  ✓ positioning_benchmarks');
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS positioning_benchmarks_project_created_idx
      ON positioning_benchmarks (project_id, created_at DESC)
  `);
  console.log('[migrate]  ✓ positioning_benchmarks_project_created_idx');

  console.log('[migrate] Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[migrate] Failed:', err);
  process.exit(1);
});
