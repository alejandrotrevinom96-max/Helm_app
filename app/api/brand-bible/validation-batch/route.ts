// PR #27 — Sprint 4: Image validation loop.
//
// POST /api/brand-bible/validation-batch
//   - Reads projects.brand_context (jsonb BrandBible) for the active
//     project, validates it has enough signal to render meaningful
//     images, then sequentially generates 12 fal.ai images and
//     persists them as a batch. Returns the inserted rows + total
//     cost so the UI can show "Generated 12 images. $0.60 total."
//
// GET /api/brand-bible/validation-batch?projectId=…[&batchId=…]
//   - Returns rows (most recent batch first). When batchId is
//     supplied, scoped to that batch only.
//
// CRITICAL: bible lives in projects.brand_context, NOT a separate
// brand_bibles table. The plan's reference to "brandBibles" was a
// misread of the schema. We adapt by reading the jsonb and treating
// it as BrandBible.
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  brandImageValidations,
  projects,
} from '@/lib/db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import {
  generateValidationBatch,
} from '@/lib/brand-bible/generate-validation-images';
import type { BrandBible } from '@/lib/types/brand';

// PR #28 — Sprint 4.1.
// Pre-PR-28 this was 300s (which Vercel Hobby silently caps to 60).
// The real fix is parallel chunks in the engine — 12 images now
// finish in ~20-30s wall time. We keep maxDuration at 60 (the
// universal ceiling) and depend on the chunked engine to stay
// inside it. force-dynamic prevents any unintended caching of
// generation responses.
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

function bibleHasEnoughSignal(bible: BrandBible | null): boolean {
  if (!bible) return false;
  const hasArchetype = !!bible.archetype?.primary;
  const hasAudience =
    !!bible.audience?.primary?.description &&
    bible.audience.primary.description.trim().length > 0;
  const hasPillars = (bible.pillars ?? []).length > 0;
  // Need at least 2 of 3 — voice alone isn't enough to differentiate
  // images, archetype + audience or pillars gives a real prompt.
  return [hasArchetype, hasAudience, hasPillars].filter(Boolean).length >= 2;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { projectId } = body as { projectId?: string };
  if (!projectId) {
    return NextResponse.json(
      { error: 'projectId required' },
      { status: 400 }
    );
  }

  if (!process.env.FAL_API_KEY) {
    return NextResponse.json(
      {
        error:
          'fal.ai is not configured on the server. Visual generation is unavailable.',
      },
      { status: 503 }
    );
  }

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const bible = (project.brandContext as BrandBible | null) ?? null;
  if (!bibleHasEnoughSignal(bible)) {
    return NextResponse.json(
      {
        error:
          'Brand bible needs more signal before rendering images. Apply an auto-generated bible (Sprint 3) or fill in archetype, audience, and at least one pillar manually.',
      },
      { status: 400 }
    );
  }

  // randomUUID lives in node:crypto since Node 19 (and is exposed on
  // globalThis in Node 18+). Avoids the uuid npm dep the plan
  // referenced — fewer deps, no polyfill needed on Vercel.
  const batchId = crypto.randomUUID();

  let results;
  try {
    results = await generateValidationBatch(bible!, project.name);
  } catch (e) {
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : 'Generation failed',
      },
      { status: 500 }
    );
  }

  if (results.length === 0) {
    return NextResponse.json(
      {
        success: false,
        error: 'fal.ai returned 0 images. Try again in a moment.',
      },
      { status: 500 }
    );
  }

  const inserted = await db
    .insert(brandImageValidations)
    .values(
      results.map((r) => ({
        userId: user.id,
        projectId,
        batchId,
        contextType: r.context.id,
        contextLabel: r.context.label,
        contextDimensions: r.context.dimensions,
        prompt: r.prompt,
        imageUrl: r.url,
        // numeric() column expects a string in drizzle.
        generationCost: r.cost.toFixed(4),
      }))
    )
    .returning();

  const totalCost = results.reduce((sum, r) => sum + r.cost, 0);
  // PR #28 — surface partial-batch state to the UI so it can show a
  // "X of Y generated" message instead of silently presenting a short
  // grid. The frontend can also offer a one-click retry that only
  // re-fires the failed contexts (future PR).
  const expectedCount = 12;
  const partial = results.length < expectedCount;

  return NextResponse.json({
    success: true,
    batchId,
    images: inserted,
    totalCost,
    // Legacy field names kept for back-compat with PR #27 callers.
    requested: expectedCount,
    succeeded: results.length,
    // New PR #28 fields the UI consumes.
    expectedCount,
    generatedCount: results.length,
    partial,
  });
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('projectId');
  const batchId = searchParams.get('batchId');

  if (!projectId) {
    return NextResponse.json(
      { error: 'projectId required' },
      { status: 400 }
    );
  }

  // Confirm project ownership before returning images. (The
  // images table also has user_id — defense in depth.)
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const filters = [
    eq(brandImageValidations.projectId, projectId),
    eq(brandImageValidations.userId, user.id),
  ];
  if (batchId) {
    filters.push(eq(brandImageValidations.batchId, batchId));
  }

  const images = await db
    .select()
    .from(brandImageValidations)
    .where(and(...filters))
    .orderBy(desc(brandImageValidations.createdAt));

  return NextResponse.json({ images });
}
