// PR #62 — Sprint 7.0.5: brand_analysis table for Smart Auto-configure.
//
// Run with: `npx tsx scripts/migrate-brand-analysis.ts`
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('[migrate] Creating brand_analysis…');
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS brand_analysis (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id UUID NOT NULL,
      niche TEXT NOT NULL,
      sub_niches JSONB,
      audience_layers JSONB,
      competitor_gap TEXT,
      specificity_recommended TEXT,
      specificity_reasoning TEXT,
      search_keywords JSONB,
      suggested_sources JSONB,
      tone_guidance JSONB,
      competitor_angles JSONB,
      generated_by TEXT DEFAULT 'claude-opus-4-7',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMP
    )
  `);
  console.log('[migrate]  ✓ brand_analysis');

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS brand_analysis_project_expires_idx
      ON brand_analysis (project_id, expires_at DESC NULLS LAST)
  `);
  console.log('[migrate]  ✓ brand_analysis_project_expires_idx');

  console.log('[migrate] Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[migrate] Failed:', err);
  process.exit(1);
});
