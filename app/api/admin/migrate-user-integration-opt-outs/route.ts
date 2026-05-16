// PR Sprint B-finish — one-shot migration endpoint for the
// user_integration_opt_outs table. Same idempotent SQL as
// scripts/migrate-user-integration-opt-outs.ts; this exists for
// the case where the founder doesn't have prod DATABASE_URL
// wired into their local .env.local and wants to apply the
// migration from a browser tab.
//
// POST → applies the migration. GET → returns table existence
// snapshot. Auth required.

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
      CREATE TABLE IF NOT EXISTS user_integration_opt_outs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider text NOT NULL,
        opted_out_at timestamp NOT NULL DEFAULT now(),
        CONSTRAINT user_integration_opt_outs_user_provider_unique
          UNIQUE (user_id, provider)
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_user_integration_opt_outs_user
        ON user_integration_opt_outs (user_id)
    `);

    return NextResponse.json({
      success: true,
      message: 'Migration applied. X disconnect flow is now usable.',
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : 'Migration failed',
        stack: e instanceof Error ? e.stack : undefined,
      },
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
      SELECT to_regclass('public.user_integration_opt_outs') AS exists
    `)) as unknown as Array<{ exists: string | null }>;
    const hasTable = Boolean(rows[0]?.exists);
    let optOutCount = 0;
    if (hasTable) {
      const countRows = (await db.execute(sql`
        SELECT COUNT(*)::int AS n FROM user_integration_opt_outs
      `)) as unknown as Array<{ n: number }>;
      optOutCount = countRows[0]?.n ?? 0;
    }
    return NextResponse.json({
      hasTable,
      optOutCount,
      migrationApplied: hasTable,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Status check failed' },
      { status: 500 },
    );
  }
}
