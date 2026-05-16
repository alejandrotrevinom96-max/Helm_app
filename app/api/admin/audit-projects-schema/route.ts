// PR Sprint C fix — schema-drift audit for the `projects` table.
//
// GET /api/admin/audit-projects-schema
//   Returns the diff between what lib/db/schema.ts declares for
//   `projects` and what actually exists in the prod DB. Use this
//   to detect missing columns BEFORE they take down the dashboard.
//
// Why this exists: we got bitten twice in 24h by columns added to
// schema.ts in code (PR #86 + Sprint C + Sprint D-1) without a
// corresponding ALTER TABLE migration shipping with the deploy.
// Drizzle's `db.select().from(projects)` then generates SQL that
// references columns Postgres doesn't have, and every dashboard
// load + cron tick 500s. This endpoint surfaces drift loudly so
// the next missed migration is a one-line fix instead of a fire.
//
// Process going forward: any PR that adds a column to schema.ts
// MUST ship with a matching /api/admin/migrate-* endpoint in the
// same PR. CI should grep for `text(` / `numeric(` / `jsonb(`
// inside the projects table block and warn if no matching admin
// route was modified. (Future hook — not blocking right now.)
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { getTableColumns, sql } from 'drizzle-orm';

export const maxDuration = 30;

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Dynamic introspection — Drizzle's getTableColumns returns
    // every column the schema declares with its actual DB name
    // (the snake_case string, not the camelCase JS key). No
    // hardcoding 30 column names; this stays correct as the
    // schema evolves.
    const declared = Object.values(getTableColumns(projects))
      .map((c) => c.name)
      .sort();

    // What Postgres actually has on `projects`. information_schema
    // is the canonical source — works on any Postgres incl. our
    // Supabase managed instance.
    const rows = (await db.execute(sql`
      SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'projects'
    `)) as unknown as Array<{ column_name: string }>;
    const actual = rows.map((r) => r.column_name).sort();

    const actualSet = new Set(actual);
    const declaredSet = new Set(declared);

    // Drift in two directions:
    //   missing: declared in schema.ts but not in DB → Drizzle
    //            will generate SQL that 500s. CRITICAL — fix
    //            with an ALTER TABLE.
    //   extra:   exists in DB but not in schema.ts → harmless
    //            for SELECTs (Drizzle won't ask for them) but
    //            indicates the schema file is behind.
    const missing = declared.filter((c) => !actualSet.has(c));
    const extra = actual.filter((c) => !declaredSet.has(c));

    return NextResponse.json({
      table: 'projects',
      declaredCount: declared.length,
      actualCount: actual.length,
      isInSync: missing.length === 0 && extra.length === 0,
      missing,
      extra,
      // Convenience flag for the recovery flow — if missing is
      // non-empty the dashboard layout is currently broken.
      criticalDrift: missing.length > 0,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Audit failed' },
      { status: 500 },
    );
  }
}
