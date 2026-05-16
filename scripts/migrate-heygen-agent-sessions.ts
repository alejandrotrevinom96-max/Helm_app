// PR Sprint D-2 — create heygen_agent_sessions table for the
// HeyGen V3 Video Agent chat-mode flow (/marketing/studio).
//
// Idempotent: CREATE TABLE IF NOT EXISTS + safe ADD COLUMN for
// any future schema bumps.
//
// Run with: `npx tsx scripts/migrate-heygen-agent-sessions.ts`
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('[migrate] Creating heygen_agent_sessions…');
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS heygen_agent_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      heygen_session_id text NOT NULL,
      status text NOT NULL DEFAULT 'thinking',
      prompt text NOT NULL,
      title text,
      style_id text,
      avatar_id text,
      voice_id text,
      orientation text,
      messages jsonb,
      last_resources jsonb,
      final_video_id text,
      final_video_url text,
      final_video_thumbnail_url text,
      final_video_captioned_url text,
      final_video_subtitle_url text,
      final_video_duration_sec numeric(7,2),
      error_message text,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now(),
      completed_at timestamp
    )
  `);
  console.log('[migrate]   ✓ heygen_agent_sessions');

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_heygen_agent_sessions_user_project
      ON heygen_agent_sessions (user_id, project_id, created_at DESC)
  `);
  console.log('[migrate]   ✓ idx_heygen_agent_sessions_user_project');

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_heygen_agent_sessions_heygen_id
      ON heygen_agent_sessions (heygen_session_id)
  `);
  console.log('[migrate]   ✓ idx_heygen_agent_sessions_heygen_id');

  console.log('[migrate] Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[migrate] Failed:', err);
  process.exit(1);
});
