// PR #71 — Sprint 7.1E: compass_decisions table for strategic
// decision log with pre-commit alignment scoring + retrospective.
//
// Run with: `npx tsx scripts/migrate-compass-decisions.ts`
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('[migrate] Creating compass_decisions…');
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS compass_decisions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id UUID NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT,
      alignment_score INTEGER,
      alignment_reasoning TEXT,
      reversibility TEXT,
      reversal_cost_notes TEXT,
      founder_confidence INTEGER,
      status TEXT NOT NULL DEFAULT 'decided',
      decided_at TIMESTAMP NOT NULL,
      evaluated_at TIMESTAMP,
      outcome_worked BOOLEAN,
      outcome_notes TEXT,
      lessons_learned TEXT,
      ai_retrospective JSONB,
      linked_priority_item_id UUID,
      linked_timeline_task_id UUID,
      model_used TEXT DEFAULT 'claude-opus-4-7',
      generation_cost_usd NUMERIC(10, 4),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  console.log('[migrate]  ✓ compass_decisions');

  // List view sorts decisions by decidedAt DESC, so a covering
  // index on (project_id, decided_at) makes the homepage cheap
  // even with hundreds of rows.
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS compass_decisions_project_decided_idx
      ON compass_decisions (project_id, decided_at DESC)
  `);
  console.log('[migrate]  ✓ compass_decisions_project_decided_idx');

  // Status filter for "show me pending evaluations" etc.
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS compass_decisions_project_status_idx
      ON compass_decisions (project_id, status)
  `);
  console.log('[migrate]  ✓ compass_decisions_project_status_idx');

  console.log('[migrate] Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[migrate] Failed:', err);
  process.exit(1);
});
