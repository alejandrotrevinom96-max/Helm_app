// PR #68 — Sprint 7.1B: priority_matrices + priority_items for the
// Compass Priority Matrix deep dive.
//
// Run with: `npx tsx scripts/migrate-priority-matrix.ts`
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('[migrate] Creating priority_matrices…');
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS priority_matrices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id UUID NOT NULL,
      sources_used JSONB,
      total_items INTEGER,
      items_do_now INTEGER,
      items_scheduled INTEGER,
      items_fillers INTEGER,
      items_avoid INTEGER,
      model_used TEXT DEFAULT 'claude-opus-4-7',
      generation_cost_usd NUMERIC(10, 4),
      expires_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  console.log('[migrate]  ✓ priority_matrices');
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS priority_matrices_project_created_idx
      ON priority_matrices (project_id, created_at DESC)
  `);
  console.log('[migrate]  ✓ priority_matrices_project_created_idx');

  console.log('[migrate] Creating priority_items…');
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS priority_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      matrix_id UUID NOT NULL REFERENCES priority_matrices(id) ON DELETE CASCADE,
      project_id UUID NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      impact_score INTEGER NOT NULL,
      effort_score INTEGER NOT NULL,
      quadrant TEXT NOT NULL,
      source_type TEXT,
      source_context TEXT,
      suggested_action TEXT,
      suggested_content_type TEXT,
      suggested_platform TEXT,
      user_status TEXT NOT NULL DEFAULT 'pending',
      user_override_quadrant TEXT,
      reasoning TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  console.log('[migrate]  ✓ priority_items');
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS priority_items_matrix_quadrant_idx
      ON priority_items (matrix_id, quadrant)
  `);
  console.log('[migrate]  ✓ priority_items_matrix_quadrant_idx');
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS priority_items_project_status_idx
      ON priority_items (project_id, user_status)
  `);
  console.log('[migrate]  ✓ priority_items_project_status_idx');

  console.log('[migrate] Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[migrate] Failed:', err);
  process.exit(1);
});
