// PR #69 — Sprint 7.1D: compass_tasks table for the Strategic
// Timeline (Compass deep dive #4).
//
// Run with: `npx tsx scripts/migrate-compass-tasks.ts`
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('[migrate] Creating compass_tasks…');
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS compass_tasks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id UUID NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      task_type TEXT NOT NULL,
      scheduled_for TIMESTAMP NOT NULL,
      estimated_minutes INTEGER,
      effort_level TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      completed_at TIMESTAMP,
      source_type TEXT,
      source_priority_item_id UUID,
      source_context TEXT,
      generated_draft_id UUID,
      linked_scheduled_post_id UUID,
      suggested_platform TEXT,
      suggested_content_type TEXT,
      suggested_prompt TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  console.log('[migrate]  ✓ compass_tasks');

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS compass_tasks_project_scheduled_idx
      ON compass_tasks (project_id, scheduled_for)
  `);
  console.log('[migrate]  ✓ compass_tasks_project_scheduled_idx');

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS compass_tasks_project_status_idx
      ON compass_tasks (project_id, status)
  `);
  console.log('[migrate]  ✓ compass_tasks_project_status_idx');

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS compass_tasks_source_item_idx
      ON compass_tasks (source_priority_item_id)
      WHERE source_priority_item_id IS NOT NULL
  `);
  console.log('[migrate]  ✓ compass_tasks_source_item_idx');

  console.log('[migrate] Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[migrate] Failed:', err);
  process.exit(1);
});
