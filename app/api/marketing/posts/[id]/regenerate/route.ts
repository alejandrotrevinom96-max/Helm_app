// PR Sprint D-8 Phase 3 — per-post caption regeneration.
//
// POST /api/marketing/posts/[id]/regenerate
//   Body: { direction?: string }
//
// Drives the "🔄 Regenerate this one" affordance in the Library
// AssetCard's per-platform accordion. Reuses
// lib/photo-agent/copyGenerator.regenerateOne() — same Opus call,
// same brand-bible-cached system prompt, same per-platform
// briefs.
//
// Only drafts can be regenerated. Scheduled / published rows are
// frozen; the founder must clone-and-edit if they want a new
// take on an already-out-the-door post.
//
// Ownership: enforced via projects.userId (same pattern as the
// rest of /api/marketing/library/[id]).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  generatedPosts,
  projects,
  contentAssets,
} from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { checkRateLimit } from '@/lib/rate-limit';
import { regenerateOne } from '@/lib/photo-agent/copyGenerator';
import type { BrandBible } from '@/lib/types/brand';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  // 30 regens / hour / user — generous for an iteration session,
  // tight enough to catch a runaway script.
  const limit = checkRateLimit(`post-regen:${user.id}`, 30, 60 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
        hint: `Try again in ${Math.ceil(limit.resetMs / 60000)} minutes.`,
      },
      { status: 429 },
    );
  }

  let body: { direction?: string };
  try {
    body = (await request.json().catch(() => ({}))) as { direction?: string };
  } catch {
    body = {};
  }
  const direction =
    typeof body.direction === 'string' && body.direction.trim().length > 0
      ? body.direction.trim().slice(0, 500)
      : null;

  // Ownership-join + fetch the post + its asset (for concept +
  // brand snapshot). LEFT JOIN on content_assets so legacy posts
  // (no asset) still resolve — we just won't have a brand
  // snapshot to feed the regen and the agent falls back to the
  // project's current bible.
  const [row] = await db
    .select({
      post: generatedPosts,
      project: projects,
      asset: contentAssets,
    })
    .from(generatedPosts)
    .innerJoin(projects, eq(projects.id, generatedPosts.projectId))
    .leftJoin(contentAssets, eq(contentAssets.id, generatedPosts.assetId))
    .where(
      and(eq(generatedPosts.id, id), eq(projects.userId, user.id)),
    )
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (row.post.status !== 'draft') {
    return NextResponse.json(
      {
        error:
          'Only drafts can be regenerated. Clone this post first if you want a fresh take.',
      },
      { status: 409 },
    );
  }

  // Brand bible — prefer the asset's snapshot (the bible that
  // was live when this asset was created) so iterations stay
  // consistent with the original brief. Fall back to the
  // project's current bible if the asset has none (legacy row).
  const bible: BrandBible | null =
    (row.asset?.brandAnalysisSnapshot as BrandBible | null) ??
    (row.project.brandContext as BrandBible | null) ??
    null;

  // Concept — asset's baseContent is the canonical seed. Fall
  // back to the post's own content when no asset is attached.
  const concept = row.asset?.baseContent ?? row.post.content;

  const fresh = await regenerateOne({
    brandBible: bible,
    concept,
    // No separate visual description here — the concept stands in
    // for both. The copy generator's prompt frames it as the
    // image being captioned.
    visualDescription: concept,
    platform: row.post.platform,
    previousText: row.post.caption ?? row.post.content,
    founderDirection: direction,
  });

  if (!fresh) {
    return NextResponse.json(
      { error: 'Regeneration returned no copy' },
      { status: 502 },
    );
  }

  // Update both content + caption + hashtags + ctaText so legacy
  // consumers (Calendar drag-drop, etc.) and new consumers (per-
  // platform accordion) see the fresh text. Hashtags + ctaText
  // are jsonb / text columns that already exist on generated_posts
  // post Sprint 7.26.
  const [updated] = await db
    .update(generatedPosts)
    .set({
      content: fresh.text,
      caption: fresh.text,
      hashtags: fresh.hashtags,
      ctaText: fresh.ctaText,
    })
    .where(eq(generatedPosts.id, id))
    .returning();

  return NextResponse.json({
    success: true,
    post: {
      id: updated.id,
      platform: updated.platform,
      content: updated.content,
      caption: updated.caption,
      hashtags: updated.hashtags,
      ctaText: updated.ctaText,
    },
  });
}
