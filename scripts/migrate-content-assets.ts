// PR Sprint 7.26 — Asset-based content flow.
//
// Adds the content_assets table + the new per-platform-variant
// columns on generated_posts (asset_id / caption / hashtags /
// cta_text), then backfills 1 content_asset per existing
// generated_post (1:1) so legacy rows still group correctly under
// the new asset-based Library + Calendar.
//
// Idempotent: ADD COLUMN IF NOT EXISTS + CREATE TABLE IF NOT
// EXISTS + a WHERE asset_id IS NULL guard on the backfill. Safe to
// re-run.
//
// Why a runtime ALTER + JS backfill (vs. drizzle-kit migrations):
// the repo's existing migration scripts (image fields, voting
// fields, voice fingerprint, etc.) all use this pattern because
// drizzle-kit db:push misparses CHECK constraints on this Postgres
// version. The Sprint convention is `npx tsx scripts/migrate-*.ts`
// for any schema change; we follow it.
//
// Run with: `npx tsx scripts/migrate-content-assets.ts`
import { loadEnvConfig } from '@next/env';

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

// Map legacy contentType / isReel / etc. → new assetType. We
// preserve as much semantic intent as we can; rows with no
// contentType fall back to 'long_form_text' which is the most
// permissive bucket (LinkedIn/X/Reddit/Threads accept it).
function deriveAssetType(row: LegacyPost): string {
  const ct = row.content_type;
  if (!ct) return 'long_form_text';
  if (ct === 'ugc') return 'ugc_video';
  if (ct === 'reel') return 'reel';
  if (ct === 'carousel') return 'carousel';
  if (ct === 'photo') return 'photo';
  if (ct === 'single_image') return 'photo';
  // text_post / self_post / community_post / thread / single_tweet —
  // all the long-form / pure-text variants collapse to long_form_text.
  return 'long_form_text';
}

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('[migrate] 1/4 Creating content_assets table…');
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
  console.log('[migrate]   ✓ content_assets');

  console.log('[migrate] 2/4 Adding indexes on content_assets…');
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_content_assets_project
      ON content_assets (project_id, created_at DESC)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_content_assets_user
      ON content_assets (user_id, created_at DESC)
  `);
  console.log('[migrate]   ✓ idx_content_assets_project + idx_content_assets_user');

  console.log('[migrate] 3/4 Extending generated_posts…');
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
  console.log('[migrate]   ✓ asset_id / caption / hashtags / cta_text + index');

  // Pull the user_id for each project up front — content_assets
  // requires it but generated_posts doesn't have it directly.
  console.log('[migrate] 4/4 Backfilling 1:1 content_assets…');
  const projectOwners = (await db.execute(sql`
    SELECT id, user_id FROM projects
  `)) as unknown as { rows: Array<{ id: string; user_id: string }> };
  const ownerByProject = new Map<string, string>();
  for (const row of projectOwners.rows) {
    ownerByProject.set(row.id, row.user_id);
  }

  const legacyRowsRes = (await db.execute(sql`
    SELECT
      id, project_id, platform, content, prompt, content_type,
      structured_content, image_url, visual_urls, video_url,
      variant_label, variant_group_id, created_at
    FROM generated_posts
    WHERE asset_id IS NULL
  `)) as unknown as { rows: LegacyPost[] };

  console.log(`[migrate]   ${legacyRowsRes.rows.length} legacy rows to backfill`);

  let backfilled = 0;
  for (const row of legacyRowsRes.rows) {
    const userId = ownerByProject.get(row.project_id);
    if (!userId) {
      console.warn(
        `[migrate]   ! skip ${row.id}: project ${row.project_id} has no owner`,
      );
      continue;
    }
    const assetType = deriveAssetType(row);
    // Build imageUrls jsonb conservatively:
    //   - carousel rows kept their slides in visual_urls (PR #65).
    //   - everything else used image_url for the single cover image.
    const imageUrls =
      assetType === 'carousel' && Array.isArray(row.visual_urls)
        ? row.visual_urls
        : row.image_url
          ? [row.image_url]
          : null;
    // INSERT … RETURNING id then UPDATE the legacy row to point
    // back. We do the two writes in a single statement via CTE so
    // there's no half-migrated state if the script is interrupted.
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
    if (backfilled % 25 === 0) {
      console.log(`[migrate]   …${backfilled}/${legacyRowsRes.rows.length}`);
    }
  }

  console.log(`[migrate]   ✓ backfilled ${backfilled} assets`);
  console.log('[migrate] Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[migrate] Failed:', err);
  process.exit(1);
});
