// PR #70 — Sprint 7.1C: compass_blind_spots table for strategic
// detection across 6 fixed frameworks.
//
// Run with: `npx tsx scripts/migrate-blind-spots.ts`
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('[migrate] Creating compass_blind_spots…');
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS compass_blind_spots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id UUID NOT NULL,
      framework TEXT NOT NULL,
      detected BOOLEAN NOT NULL,
      severity TEXT,
      confidence_score INTEGER,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      evidence JSONB,
      recommendation TEXT,
      suggested_actions JSONB,
      inputs_analyzed JSONB,
      user_status TEXT NOT NULL DEFAULT 'open',
      user_notes TEXT,
      model_used TEXT DEFAULT 'claude-opus-4-7',
      generation_cost_usd NUMERIC(10, 4),
      expires_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  console.log('[migrate]  ✓ compass_blind_spots');

  // Sort buckets: detected items first, then by confidence within
  // each. Severity is text so we sort it in code (critical > high
  // > medium > low), but the index supports the project+detected
  // primary filter cheaply.
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS compass_blind_spots_project_detected_idx
      ON compass_blind_spots (project_id, detected, confidence_score DESC)
  `);
  console.log('[migrate]  ✓ compass_blind_spots_project_detected_idx');

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS compass_blind_spots_project_status_idx
      ON compass_blind_spots (project_id, user_status)
  `);
  console.log('[migrate]  ✓ compass_blind_spots_project_status_idx');

  console.log('[migrate] Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[migrate] Failed:', err);
  process.exit(1);
});
