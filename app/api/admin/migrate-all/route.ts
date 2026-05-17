// PR Sprint D-6 — one-shot meta-migration. Runs every idempotent
// heygen migration in the right order + returns a single summary.
//
// POST /api/admin/migrate-all
//   → calls each migrate-heygen-* POST in sequence using the same
//     authenticated Supabase session.
//
// Why this exists: after Sprint C / D-1 we had 5 separate
// /api/admin/migrate-heygen-* endpoints. Recovering prod after a
// schema-drift incident required pasting 6 fetches into DevTools
// console. This endpoint collapses that into one call:
//
//   await fetch('/api/admin/migrate-all', { method: 'POST' })
//     .then(r => r.json())
//
// Every individual migration is ALREADY idempotent
// (CREATE/ALTER … IF NOT EXISTS), so running this multiple times
// is safe. We just inline the SQL here rather than HTTP-call the
// sibling endpoints — saves the auth round-trip overhead and
// keeps the work inside a single Lambda invocation.
//
// On error: continue running the remaining steps + report which
// one failed. A single broken migration shouldn't block the
// others — partial schema fix > no schema fix.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';

export const maxDuration = 60;

interface StepResult {
  step: string;
  ok: boolean;
  message: string;
}

async function runStep(
  step: string,
  fn: () => Promise<void>,
): Promise<StepResult> {
  try {
    await fn();
    return { step, ok: true, message: 'applied' };
  } catch (e) {
    return {
      step,
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results: StepResult[] = [];

  // 1. heygen avatar/voice CORE columns (PR #86 + Sprint C Fix 1)
  results.push(
    await runStep('heygen-avatar-core', async () => {
      await db.execute(sql`
        ALTER TABLE projects
          ADD COLUMN IF NOT EXISTS heygen_avatar_type text DEFAULT 'stock'
      `);
      await db.execute(sql`
        ALTER TABLE projects
          ADD COLUMN IF NOT EXISTS heygen_avatar_id text
      `);
      await db.execute(sql`
        ALTER TABLE projects
          ADD COLUMN IF NOT EXISTS heygen_photo_url text
      `);
      await db.execute(sql`
        ALTER TABLE projects
          ADD COLUMN IF NOT EXISTS heygen_voice_id text
      `);
      await db.execute(sql`
        ALTER TABLE projects
          ADD COLUMN IF NOT EXISTS heygen_avatar_gender text
      `);
      await db.execute(sql`
        ALTER TABLE projects
          ADD COLUMN IF NOT EXISTS heygen_voice_gender text
      `);
    }),
  );

  // 2. heygen tuning columns (Sprint D-1)
  results.push(
    await runStep('heygen-tuning', async () => {
      await db.execute(sql`
        ALTER TABLE projects
          ADD COLUMN IF NOT EXISTS heygen_voice_emotion text
      `);
      await db.execute(sql`
        ALTER TABLE projects
          ADD COLUMN IF NOT EXISTS heygen_voice_locale text
      `);
      await db.execute(sql`
        ALTER TABLE projects
          ADD COLUMN IF NOT EXISTS heygen_voice_speed numeric(3,2)
      `);
      await db.execute(sql`
        ALTER TABLE projects
          ADD COLUMN IF NOT EXISTS heygen_avatar_expressiveness text
      `);
      await db.execute(sql`
        ALTER TABLE projects
          ADD COLUMN IF NOT EXISTS heygen_avatar_motion_prompt text
      `);
    }),
  );

  // 3. heygen_agent_sessions table (Sprint D-2 — Studio chat-mode)
  results.push(
    await runStep('heygen-agent-sessions', async () => {
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
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_heygen_agent_session_project
          ON heygen_agent_sessions (project_id, created_at DESC)
      `);
    }),
  );

  // 4. heygen_lipsync_jobs table (Sprint D-4)
  results.push(
    await runStep('heygen-lipsync', async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS heygen_lipsync_jobs (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          source_job_id uuid NOT NULL REFERENCES heygen_jobs(id) ON DELETE CASCADE,
          heygen_lipsync_id text NOT NULL,
          mode text NOT NULL DEFAULT 'speed',
          edited_script text NOT NULL,
          status text NOT NULL DEFAULT 'pending',
          result_video_url text,
          result_caption_url text,
          duration_sec numeric(7,2),
          error_message text,
          created_at timestamp NOT NULL DEFAULT now(),
          updated_at timestamp NOT NULL DEFAULT now(),
          completed_at timestamp
        )
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_heygen_lipsync_source_job
          ON heygen_lipsync_jobs (source_job_id, created_at DESC)
      `);
    }),
  );

  // 5. heygen_translation_jobs table (Sprint D-5)
  results.push(
    await runStep('heygen-translations', async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS heygen_translation_jobs (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          source_job_id uuid NOT NULL REFERENCES heygen_jobs(id) ON DELETE CASCADE,
          heygen_translation_id text NOT NULL,
          target_language text NOT NULL,
          mode text NOT NULL DEFAULT 'speed',
          status text NOT NULL DEFAULT 'pending',
          result_video_url text,
          result_caption_url text,
          duration_sec numeric(7,2),
          error_message text,
          created_at timestamp NOT NULL DEFAULT now(),
          updated_at timestamp NOT NULL DEFAULT now(),
          completed_at timestamp
        )
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_heygen_translation_source_job
          ON heygen_translation_jobs (source_job_id, created_at DESC)
      `);
    }),
  );

  // 6. photo_agent_sessions table (Sprint D-8 Phase 2).
  //
  // Was missing from the original migrate-all. Without this step
  // a DB reset would leave the Photo Studio chat-agent dead until
  // someone manually called /api/admin/migrate-photo-agent-sessions
  // — symptom: "Create failed (500)" on the first session POST.
  results.push(
    await runStep('photo-agent-sessions', async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS photo_agent_sessions (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          prompt text NOT NULL,
          pain_point_id text,
          brand_snapshot jsonb,
          state text NOT NULL DEFAULT 'understanding',
          asset_type text,
          uploaded_asset_url text,
          concept text,
          visual_url text,
          visual_width integer,
          visual_height integer,
          platforms jsonb,
          copies jsonb,
          messages jsonb,
          content_asset_id uuid REFERENCES content_assets(id) ON DELETE SET NULL,
          error_message text,
          created_at timestamp NOT NULL DEFAULT now(),
          updated_at timestamp NOT NULL DEFAULT now(),
          completed_at timestamp
        )
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_photo_agent_session_project
          ON photo_agent_sessions (project_id, created_at DESC)
      `);
    }),
  );

  const allOk = results.every((r) => r.ok);
  return NextResponse.json(
    {
      success: allOk,
      results,
      hint: allOk
        ? 'All migrations applied. Reload the dashboard.'
        : 'Some migrations failed — see `results` for the specific error. Safe to retry.',
    },
    { status: allOk ? 200 : 207 },
  );
}
