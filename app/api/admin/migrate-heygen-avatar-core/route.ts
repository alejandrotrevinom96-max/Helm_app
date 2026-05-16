// PR Sprint C fix — one-shot browser-trigger migration for the
// HeyGen avatar/voice CORE columns on projects. These were
// declared in schema.ts back at PR #86 (heygenAvatarType /
// heygenAvatarId / heygenPhotoUrl / heygenVoiceId) and Sprint C
// (heygenAvatarGender / heygenVoiceGender) but the corresponding
// ALTER TABLE migration never made it into prod. Without these
// columns, Drizzle's `db.select().from(projects)` generates SQL
// that references undefined columns → every dashboard layout
// load + every cron tick 500s.
//
// Idempotent: ADD COLUMN IF NOT EXISTS is safe to run repeatedly.
// Same defensive pattern as migrate-heygen-tuning + migrate-
// heygen-gender (which only covered the 2 newest of these).
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';

export const maxDuration = 30;

const COLUMNS = [
  'heygen_avatar_type',
  'heygen_avatar_id',
  'heygen_photo_url',
  'heygen_voice_id',
  'heygen_avatar_gender',
  'heygen_voice_gender',
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

    // All six are nullable text columns (heygen_avatar_type has a
    // 'stock' default so existing rows pick up the safe path
    // automatically). Each ALTER fires separately so a partial
    // failure (e.g. one column already exists in a weird state)
    // doesn't abort the others.
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

    return NextResponse.json({
      success: true,
      message: 'HeyGen avatar/voice core columns ready on projects.',
      columns: COLUMNS,
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
    // Same Postgres-array-literal pattern as migrate-heygen-tuning
    // GET: build the `{a,b,c}` string once + cast with ::text[] so
    // Drizzle binds it as ONE parameter, not N spread placeholders.
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
