// PR #26 — Sprint 3: Auto-Generate Brand Bible (Helm v2.0 wedge).
//
// Creates brand_bible_sources, the multi-source feed that powers the
// auto-generated brand bible. Idempotent (uses IF NOT EXISTS for both
// table and indexes). Safe to re-run.
//
// NOTE: The plan referenced a brand_bibles table — it doesn't exist
// in our schema. The bible itself lives in projects.brand_context
// (jsonb). Apply-generated writes back into that column. Nothing else
// needs migrating.
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('• brand_bible_sources …');
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS brand_bible_sources (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source_type text NOT NULL,
      source_url text,
      source_external_id text,
      source_handle text,
      status text NOT NULL DEFAULT 'pending',
      analysis_result jsonb,
      access_token text,
      token_expires_at timestamp,
      last_analyzed_at timestamp,
      error_message text,
      created_at timestamp NOT NULL DEFAULT NOW(),
      updated_at timestamp NOT NULL DEFAULT NOW()
    )
  `);

  console.log('• indexes …');
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_brand_bible_sources_project
      ON brand_bible_sources(project_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_brand_bible_sources_user
      ON brand_bible_sources(user_id)
  `);

  console.log('\nVerifying brand_bible_sources columns:');
  const cols = (await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'brand_bible_sources'
    ORDER BY ordinal_position
  `)) as Array<{ column_name: string }>;
  for (const c of cols) console.log('  ', c.column_name);

  console.log('\n✓ Brand bible sources table ready');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
