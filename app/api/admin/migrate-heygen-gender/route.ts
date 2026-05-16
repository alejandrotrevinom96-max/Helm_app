// PR Sprint C — one-shot browser-trigger migration for the
// heygen_avatar_gender + heygen_voice_gender columns on projects.
// Same idempotent SQL as scripts/migrate-heygen-gender.ts.

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
      ALTER TABLE projects
        ADD COLUMN IF NOT EXISTS heygen_avatar_gender text
    `);
    await db.execute(sql`
      ALTER TABLE projects
        ADD COLUMN IF NOT EXISTS heygen_voice_gender text
    `);
    return NextResponse.json({
      success: true,
      message: 'Gender columns ready on projects.',
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
      SELECT column_name FROM information_schema.columns
        WHERE table_name = 'projects'
          AND column_name IN ('heygen_avatar_gender', 'heygen_voice_gender')
    `)) as unknown as Array<{ column_name: string }>;
    const cols = rows.map((r) => r.column_name).sort();
    return NextResponse.json({
      hasGenderColumns: cols.length === 2,
      columns: cols,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Status check failed' },
      { status: 500 },
    );
  }
}
