// PR Sprint 7.26 — Asset-based content flow.
//
// One-shot migration endpoint. Runs the same DDL + backfill as
// scripts/migrate-content-assets.ts but from inside a Next.js
// route, so the founder can apply the schema change from a
// browser tab (or curl) without needing to wire DATABASE_URL
// locally against prod.
//
// Auth: any logged-in user can trigger it. Helm is single-tenant
// per deploy right now and the migration is fully idempotent
// (CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, backfill
// guarded by `WHERE asset_id IS NULL`), so accidental re-runs are
// no-ops. We still require auth so anonymous traffic can't poke
// the DB.
//
// Why we keep BOTH the script AND this endpoint:
//   - The script is the convention in scripts/migrate-*.ts (PR
//     history shows that's how prior schema changes shipped).
//   - The endpoint exists so the founder isn't blocked when their
//     local .env.local doesn't point at prod — a common state
//     after onboarding new env vars in Vercel without copying
//     them down.
//
// After production state has caught up, this file can be deleted
// in a follow-up PR — the script remains as the canonical
// migration record.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';

interface LegacyPost {
  id: string;
  project_id: string;
  platform: string;
  content: string;
  prompt: string | null;
  content_type: string | null;
  structured_content: unknown;
  image_url: string | null;
  visual_urls: string[] | null;
  video_url: string | null;
  variant_label: string | null;
  variant_group_id: string | null;
  created_at: Date;
}

function deriveAssetType(row: LegacyPost): string {
  const ct = row.content_type;
  if (!ct) return 'long_form_text';
  if (ct === 'ugc') return 'ugc_video';
  if (ct === 'reel') return 'reel';
  if (ct === 'carousel') return 'carousel';
  if (ct === 'photo') return 'photo';
  if (ct === 'single_image') return 'photo';
  return 'long_form_text';
}

// Bumped to 60s — backfilling several hundred rows takes a few
// seconds per batch; default 10s would timeout on bigger projects.
export const maxDuration = 60;

export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 },
      );
    }

    const steps: Array<{ step: string; ok: boolean; note?: string }> = [];

    // 1) Create the table.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS content_assets (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        asset_type text NOT NULL,
        video_url text,
        image_urls jsonb,
        base_content text NOT NULL,
        brand_analysis_snapshot jsonb,
        prompt_used text NOT NULL,
        variant_label text,
        variant_group_id uuid,
        heygen_job_id text,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `);
    steps.push({ step: 'CREATE TABLE content_assets', ok: true });

    // 2) Indexes.
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_content_assets_project
        ON content_assets (project_id, created_at DESC)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_content_assets_user
        ON content_assets (user_id, created_at DESC)
    `);
    steps.push({ step: 'CREATE INDEX content_assets', ok: true });

    // 3) New columns on generated_posts.
    await db.execute(sql`
      ALTER TABLE generated_posts
        ADD COLUMN IF NOT EXISTS asset_id uuid
          REFERENCES content_assets(id) ON DELETE CASCADE
    `);
    await db.execute(sql`
      ALTER TABLE generated_posts
        ADD COLUMN IF NOT EXISTS caption text
    `);
    await db.execute(sql`
      ALTER TABLE generated_posts
        ADD COLUMN IF NOT EXISTS hashtags jsonb
    `);
    await db.execute(sql`
      ALTER TABLE generated_posts
        ADD COLUMN IF NOT EXISTS cta_text text
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_generated_posts_asset
        ON generated_posts (asset_id)
    `);
    steps.push({
      step: 'ALTER generated_posts (asset_id + caption + hashtags + cta_text)',
      ok: true,
    });

    // 4) Backfill 1:1 content_assets for legacy rows.
    const ownersRes = (await db.execute(sql`
      SELECT id, user_id FROM projects
    `)) as unknown as { rows: Array<{ id: string; user_id: string }> };
    const ownerByProject = new Map<string, string>();
    for (const r of ownersRes.rows) {
      ownerByProject.set(r.id, r.user_id);
    }

    const legacyRes = (await db.execute(sql`
      SELECT
        id, project_id, platform, content, prompt, content_type,
        structured_content, image_url, visual_urls, video_url,
        variant_label, variant_group_id, created_at
      FROM generated_posts
      WHERE asset_id IS NULL
    `)) as unknown as { rows: LegacyPost[] };

    let backfilled = 0;
    let skipped = 0;
    for (const row of legacyRes.rows) {
      const userId = ownerByProject.get(row.project_id);
      if (!userId) {
        skipped++;
        continue;
      }
      const assetType = deriveAssetType(row);
      const imageUrls =
        assetType === 'carousel' && Array.isArray(row.visual_urls)
          ? row.visual_urls
          : row.image_url
            ? [row.image_url]
            : null;
      await db.execute(sql`
        WITH new_asset AS (
          INSERT INTO content_assets (
            user_id, project_id, asset_type, video_url, image_urls,
            base_content, prompt_used, variant_label, variant_group_id,
            created_at
          ) VALUES (
            ${userId},
            ${row.project_id},
            ${assetType},
            ${row.video_url},
            ${imageUrls ? JSON.stringify(imageUrls) : null}::jsonb,
            ${row.content},
            ${row.prompt ?? ''},
            ${row.variant_label},
            ${row.variant_group_id},
            ${row.created_at}
          )
          RETURNING id
        )
        UPDATE generated_posts
          SET asset_id = (SELECT id FROM new_asset)
          WHERE id = ${row.id}
      `);
      backfilled++;
    }
    steps.push({
      step: 'Backfill content_assets 1:1',
      ok: true,
      note: `backfilled=${backfilled}, skipped=${skipped}, total_pending=${legacyRes.rows.length}`,
    });

    return NextResponse.json({
      success: true,
      message:
        'Migration applied. Library + generate-asset should work now.',
      steps,
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

// GET surfaces a status snapshot so the founder can verify the
// migration ran without hitting the POST again. Useful for a quick
// "did it work?" check from a browser tab.
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 },
      );
    }
    const tableRes = (await db.execute(sql`
      SELECT to_regclass('public.content_assets') AS exists
    `)) as unknown as { rows: Array<{ exists: string | null }> };
    const hasTable = Boolean(tableRes.rows[0]?.exists);
    const colRes = (await db.execute(sql`
      SELECT column_name FROM information_schema.columns
        WHERE table_name = 'generated_posts'
          AND column_name IN ('asset_id', 'caption', 'hashtags', 'cta_text')
    `)) as unknown as { rows: Array<{ column_name: string }> };
    const cols = colRes.rows.map((r) => r.column_name);
    const countRes = hasTable
      ? ((await db.execute(sql`
          SELECT COUNT(*)::int AS n FROM content_assets
        `)) as unknown as { rows: Array<{ n: number }> })
      : { rows: [{ n: 0 }] };
    const pendingRes = (await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM generated_posts WHERE asset_id IS NULL
    `).catch(() => ({ rows: [{ n: -1 }] }))) as unknown as {
      rows: Array<{ n: number }>;
    };
    return NextResponse.json({
      hasTable,
      newColumns: cols.sort(),
      assetCount: countRes.rows[0]?.n ?? 0,
      pendingBackfill: pendingRes.rows[0]?.n ?? null,
      migrationApplied:
        hasTable &&
        cols.includes('asset_id') &&
        cols.includes('caption') &&
        cols.includes('hashtags') &&
        cols.includes('cta_text'),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Status check failed' },
      { status: 500 },
    );
  }
}
