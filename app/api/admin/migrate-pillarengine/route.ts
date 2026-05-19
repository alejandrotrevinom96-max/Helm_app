// PR Sprint pillarengine — migration endpoint for the external
// blog content tables.
//
// POST /api/admin/migrate-pillarengine
//   Idempotent. Creates blog_posts_external + pillarengine_sync_state
//   + their indexes if absent. Safe to re-run. Same auth pattern as
//   the other admin migrate-* endpoints (Supabase session required).
//
// GET /api/admin/migrate-pillarengine
//   Reports whether both tables exist + whether the sync_state row
//   is seeded.
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

    // blog_posts_external — rows ingested from PillarEngine
    // (webhook or cron). Both pillarengine_id and slug are unique:
    // the former is the idempotency key for upserts, the latter
    // is the URL-routable identifier the blog uses.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS blog_posts_external (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        pillarengine_id text NOT NULL UNIQUE,
        slug text NOT NULL UNIQUE,
        title text NOT NULL,
        meta_title text,
        meta_description text,
        markdown_body text NOT NULL,
        intent text,
        approved_at timestamp,
        source text NOT NULL DEFAULT 'pillarengine',
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `);

    // Sort index for the blog index page (newest approved first
    // when the loader merges with file-based posts). Conditional
    // on a present approved_at so partial-data rows don't poison
    // the order.
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_blog_posts_external_approved_at
        ON blog_posts_external (approved_at DESC NULLS LAST)
    `);

    // pillarengine_sync_state — single-row config table tracking
    // the last successful cron run. id is a stable string so the
    // cron's upsert targets a well-known primary key.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS pillarengine_sync_state (
        id text PRIMARY KEY,
        last_sync_at timestamp,
        last_run_pages_synced integer,
        last_run_ms integer,
        last_run_error text,
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `);

    // Seed the singleton row. Upsert-shaped INSERT so a re-run
    // doesn't bump updated_at or clobber lastSyncAt.
    await db.execute(sql`
      INSERT INTO pillarengine_sync_state (id, updated_at)
      VALUES ('pillarengine', now())
      ON CONFLICT (id) DO NOTHING
    `);

    return NextResponse.json({
      success: true,
      message:
        'blog_posts_external + pillarengine_sync_state ready (with seeded singleton).',
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
      SELECT
        to_regclass('public.blog_posts_external') AS blog_table,
        to_regclass('public.pillarengine_sync_state') AS sync_table,
        (
          SELECT to_jsonb(s) FROM pillarengine_sync_state s
          WHERE s.id = 'pillarengine' LIMIT 1
        ) AS sync_row
    `)) as unknown as Array<{
      blog_table: string | null;
      sync_table: string | null;
      sync_row: unknown;
    }>;
    return NextResponse.json({
      hasBlogTable: Boolean(rows[0]?.blog_table),
      hasSyncTable: Boolean(rows[0]?.sync_table),
      syncRow: rows[0]?.sync_row ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Status check failed' },
      { status: 500 },
    );
  }
}
