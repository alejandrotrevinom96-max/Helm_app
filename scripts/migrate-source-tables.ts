// PR #56 — Sprint 7.0: one-time migration creating the
// source_directory and project_sources tables that back the
// Research Auto-Discovery flow.
//
// Same rationale as PR #42's migrate-voting-fields: drizzle-kit
// `db:push` chokes on our existing CHECK constraints, so we issue
// the DDL directly through the same runtime client the app uses.
//
// Run with: `npx tsx scripts/migrate-source-tables.ts`
//
// Idempotent — every statement uses IF NOT EXISTS so re-running is
// safe. The unique constraint on (platform, identifier) protects
// us from inserting r/SaaS twice when two founders discover it
// independently.
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('[migrate] Creating source_directory…');
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS source_directory (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      platform TEXT NOT NULL,
      identifier TEXT NOT NULL,
      display_name TEXT NOT NULL,
      url TEXT NOT NULL,
      member_count INTEGER,
      activity_level TEXT,
      language TEXT,
      description TEXT,
      metadata JSONB,
      discovered_at TIMESTAMP NOT NULL DEFAULT NOW(),
      last_verified TIMESTAMP,
      CONSTRAINT source_directory_platform_ident_uk UNIQUE (platform, identifier)
    )
  `);
  console.log('[migrate]  ✓ source_directory');

  console.log('[migrate] Creating project_sources…');
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS project_sources (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id UUID NOT NULL,
      source_id UUID NOT NULL REFERENCES source_directory(id),
      status TEXT NOT NULL,
      connected_at TIMESTAMP,
      last_scanned_at TIMESTAMP,
      scan_count INTEGER DEFAULT 0,
      signal_score INTEGER DEFAULT 50,
      findings_count INTEGER DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  console.log('[migrate]  ✓ project_sources');

  // Useful indexes — the dashboard hits these constantly. Putting
  // them in the same migration keeps the next deploy from racing
  // a slow CREATE INDEX against incoming traffic.
  console.log('[migrate] Adding indexes…');
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS project_sources_project_idx
      ON project_sources (project_id, status)
  `);
  console.log('[migrate]  ✓ project_sources_project_idx');
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS project_sources_user_idx
      ON project_sources (user_id)
  `);
  console.log('[migrate]  ✓ project_sources_user_idx');
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS source_directory_platform_idx
      ON source_directory (platform)
  `);
  console.log('[migrate]  ✓ source_directory_platform_idx');

  console.log('[migrate] Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[migrate] Failed:', err);
  process.exit(1);
});
