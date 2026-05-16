// PR Sprint D-2 — one-shot migration endpoint for the
// heygen_agent_sessions table.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';

export const maxDuration = 30;

export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
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
      CREATE INDEX IF NOT EXISTS idx_heygen_agent_sessions_user_project
        ON heygen_agent_sessions (user_id, project_id, created_at DESC)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_heygen_agent_sessions_heygen_id
        ON heygen_agent_sessions (heygen_session_id)
    `);
    return NextResponse.json({
      success: true,
      message: 'heygen_agent_sessions ready.',
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Migration failed' },
      { status: 500 },
    );
  }
}

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const rows = (await db.execute(sql`
      SELECT to_regclass('public.heygen_agent_sessions') AS exists
    `)) as unknown as Array<{ exists: string | null }>;
    const hasTable = Boolean(rows[0]?.exists);
    return NextResponse.json({ hasTable });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Status check failed' },
      { status: 500 },
    );
  }
}
