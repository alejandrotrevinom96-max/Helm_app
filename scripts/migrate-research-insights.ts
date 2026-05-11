// PR #57 — Sprint 7.0.1: research_insights table + sourceId
// column on research_findings.
//
// Same direct-DDL pattern as migrate-source-tables: drizzle-kit
// `db:push` still chokes on our CHECK constraints, so we issue the
// statements through the runtime client.
//
// Run with: `npx tsx scripts/migrate-research-insights.ts`
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('[migrate] Creating research_insights…');
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS research_insights (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id UUID NOT NULL,
      pain_points JSONB,
      summary TEXT,
      skipped_reason TEXT,
      sources_used JSONB,
      week_starting TIMESTAMP,
      brief_sent BOOLEAN DEFAULT FALSE,
      brief_sent_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  console.log('[migrate]  ✓ research_insights');

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS research_insights_project_week_idx
      ON research_insights (project_id, week_starting DESC)
  `);
  console.log('[migrate]  ✓ research_insights_project_week_idx');

  console.log('[migrate] Adding source_id to research_findings…');
  await db.execute(sql`
    ALTER TABLE research_findings
      ADD COLUMN IF NOT EXISTS source_id UUID REFERENCES source_directory(id)
  `);
  console.log('[migrate]  ✓ research_findings.source_id');

  console.log('[migrate] Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[migrate] Failed:', err);
  process.exit(1);
});
