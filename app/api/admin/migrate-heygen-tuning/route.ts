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
    // PR Sprint D-1 hotfix — `sql\`ANY(${COLUMNS})\`` expanded the JS
    // array into a 5-tuple of params (`ANY(($1,$2,$3,$4,$5))`),
    // which is invalid Postgres syntax. ANY() needs a single
    // array-typed param.
    //
    // We build the Postgres array literal as a single string
    // (`'{a,b,c}'`) and let `::text[]` cast it server-side. This
    // sends ONE bound parameter — not five — exactly the shape
    // ANY() expects. Drizzle's `sql` template would otherwise
    // spread the JS array into N comma-separated placeholders.
    //
    // Safe to inline COLUMNS into the literal because the values
    // are hard-coded constants at the top of this file, never
    // user input.
    const columnNames = `{${COLUMNS.join(',')}}`;
    const rows = (await db.execute(sql`
      SELECT column_name FROM information_schema.columns
        WHERE table_name = 'projects'
          AND column_name = ANY(${columnNames}::text[])
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
