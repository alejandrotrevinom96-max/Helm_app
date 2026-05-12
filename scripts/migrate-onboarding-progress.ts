// PR #74 — Sprint 7.2B: onboarding_progress table for the 5-step
// wizard. See lib/db/schema.ts for the table comment.
//
// Run with: `npx tsx scripts/migrate-onboarding-progress.ts`
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('[migrate] Creating onboarding_progress…');
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS onboarding_progress (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL UNIQUE,
      current_step TEXT NOT NULL DEFAULT 'welcome',
      welcome_at TIMESTAMP,
      project_at TIMESTAMP,
      brand_at TIMESTAMP,
      research_at TIMESTAMP,
      first_content_at TIMESTAMP,
      completed_at TIMESTAMP,
      primary_project_id UUID,
      first_draft_id UUID,
      skipped_steps JSONB DEFAULT '[]'::jsonb,
      brand_answers JSONB,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  console.log('[migrate]  ✓ onboarding_progress');

  // userId is unique-indexed via the UNIQUE constraint on the
  // column. No additional secondary index needed — every query
  // path is "row for this user", which the unique index serves.

  console.log('[migrate] Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[migrate] Failed:', err);
  process.exit(1);
});
