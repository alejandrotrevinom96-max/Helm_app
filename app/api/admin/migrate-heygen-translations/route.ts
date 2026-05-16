// PR Sprint D-5 — one-shot migration endpoint for
// heygen_translation_jobs.
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
    return NextResponse.json({
      success: true,
      message: 'heygen_translation_jobs ready.',
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
      SELECT to_regclass('public.heygen_translation_jobs') AS exists
    `)) as unknown as Array<{ exists: string | null }>;
    return NextResponse.json({ hasTable: Boolean(rows[0]?.exists) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Status check failed' },
      { status: 500 },
    );
  }
}
