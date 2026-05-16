// PR Sprint D-1 — one-shot browser-trigger migration for the
// voice & avatar tuning columns on projects.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';

export const maxDuration = 30;

const COLUMNS = [
  'heygen_voice_emotion',
  'heygen_voice_locale',
  'heygen_voice_speed',
  'heygen_avatar_expressiveness',
  'heygen_avatar_motion_prompt',
];

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
    return NextResponse.json({
      success: true,
      message: 'Tuning columns ready on projects.',
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
          AND column_name = ANY(${COLUMNS})
    `)) as unknown as Array<{ column_name: string }>;
    const present = rows.map((r) => r.column_name).sort();
    return NextResponse.json({
      hasAllColumns: present.length === COLUMNS.length,
      present,
      missing: COLUMNS.filter((c) => !present.includes(c)),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Status check failed' },
      { status: 500 },
    );
  }
}
