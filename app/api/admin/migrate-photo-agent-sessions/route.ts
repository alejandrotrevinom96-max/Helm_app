// PR Sprint D-8 Phase 2 — migration endpoint for photo_agent_sessions.
//
// POST /api/admin/migrate-photo-agent-sessions
//   Idempotent CREATE TABLE IF NOT EXISTS + index. Same pattern as
//   the other admin migrate endpoints. Safe to re-run.
//
// GET /api/admin/migrate-photo-agent-sessions
//   Reports whether the table exists.
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
    return NextResponse.json({
      success: true,
      message: 'photo_agent_sessions ready.',
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
      SELECT to_regclass('public.photo_agent_sessions') AS exists
    `)) as unknown as Array<{ exists: string | null }>;
    return NextResponse.json({ hasTable: Boolean(rows[0]?.exists) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Status check failed' },
      { status: 500 },
    );
  }
}
