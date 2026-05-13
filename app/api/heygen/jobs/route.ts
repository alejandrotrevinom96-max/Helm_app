// PR #86 — Sprint 7.10: HeyGen job CRUD.
//
//   POST /api/heygen/jobs       — create a queued job for a draft
//   GET  /api/heygen/jobs?...   — look up latest job for a draft
//
// The library modal flow:
//   1. Modal opens for a reel / ugc draft → GET ?draftId=… returns
//      the latest job (or null).
//   2. Founder hits "Generate video" → POST { draftId } creates a
//      queued row. The client immediately follows with POST
//      /api/heygen/generate-video { jobId } to fire HeyGen.
//
// We extract the script text from the draft's structuredContent
// (Sprint 7.0.5 introduced the `script` shape for reels / ugc).
// If the column is empty we fall back to the raw `content`, which
// keeps legacy drafts (pre-7.0.5) workable.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  generatedPosts,
  heygenJobs,
  projects,
} from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VIDEO_CONTENT_TYPES = new Set(['reel', 'ugc']);

function pickScript(
  structured: unknown,
  fallback: string,
): string {
  if (
    structured &&
    typeof structured === 'object' &&
    !Array.isArray(structured)
  ) {
    const s = structured as Record<string, unknown>;
    // Reel + UGC structured drafts both expose either { script } or
    // { caption } at the top level depending on which template the
    // generator picked.
    if (typeof s.script === 'string' && s.script.trim().length > 0) {
      return s.script.trim();
    }
    if (typeof s.caption === 'string' && s.caption.trim().length > 0) {
      return s.caption.trim();
    }
    if (typeof s.content === 'string' && s.content.trim().length > 0) {
      return s.content.trim();
    }
  }
  return fallback;
}

function serializeJob(job: typeof heygenJobs.$inferSelect) {
  return {
    id: job.id,
    status: job.status,
    videoUrl: job.videoUrl,
    thumbnailUrl: job.thumbnailUrl,
    durationSeconds: job.durationSeconds,
    errorMessage: job.errorMessage,
    errorKind: job.errorKind,
    requestedAt: job.requestedAt,
    processedAt: job.processedAt,
    completedAt: job.completedAt,
  };
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { draftId?: unknown };
  try {
    body = (await request.json()) as { draftId?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (typeof body.draftId !== 'string' || !UUID_RE.test(body.draftId)) {
    return NextResponse.json({ error: 'Invalid draftId' }, { status: 400 });
  }

  // Ownership-join — generated_posts has no userId column directly,
  // so we verify via projects.userId.
  const [joined] = await db
    .select({ draft: generatedPosts })
    .from(generatedPosts)
    .innerJoin(projects, eq(projects.id, generatedPosts.projectId))
    .where(
      and(
        eq(generatedPosts.id, body.draftId),
        eq(projects.userId, user.id),
      ),
    )
    .limit(1);
  if (!joined) {
    return NextResponse.json(
      { error: 'Draft not found or forbidden' },
      { status: 404 },
    );
  }
  const draft = joined.draft;

  if (
    !draft.contentType ||
    !VIDEO_CONTENT_TYPES.has(draft.contentType)
  ) {
    return NextResponse.json(
      {
        error:
          'HeyGen generation is only available for Reel or UGC drafts.',
        errorKind: 'wrong_content_type',
      },
      { status: 400 },
    );
  }

  // If there's already a non-terminal job for this draft, return it
  // rather than enqueueing a duplicate (avoids accidental double-
  // fires from a fast-clicking founder).
  const [existing] = await db
    .select()
    .from(heygenJobs)
    .where(eq(heygenJobs.draftId, draft.id))
    .orderBy(desc(heygenJobs.requestedAt))
    .limit(1);

  if (
    existing &&
    (existing.status === 'queued' ||
      existing.status === 'processing' ||
      existing.status === 'completed')
  ) {
    return NextResponse.json({
      job: serializeJob(existing),
      reused: true,
    });
  }

  const scriptText = pickScript(draft.structuredContent, draft.content);
  if (!scriptText || scriptText.length === 0) {
    return NextResponse.json(
      {
        error: 'Draft has no script text to render.',
        errorKind: 'empty_script',
      },
      { status: 400 },
    );
  }

  const [inserted] = await db
    .insert(heygenJobs)
    .values({
      draftId: draft.id,
      projectId: draft.projectId,
      userId: user.id,
      status: 'queued',
      scriptText,
    })
    .returning();

  return NextResponse.json({ job: serializeJob(inserted), reused: false });
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const draftId = url.searchParams.get('draftId');
  if (!draftId || !UUID_RE.test(draftId)) {
    return NextResponse.json({ error: 'Invalid draftId' }, { status: 400 });
  }

  // Ownership-join again — same shape as POST.
  const [joined] = await db
    .select({ draftId: generatedPosts.id })
    .from(generatedPosts)
    .innerJoin(projects, eq(projects.id, generatedPosts.projectId))
    .where(
      and(eq(generatedPosts.id, draftId), eq(projects.userId, user.id)),
    )
    .limit(1);
  if (!joined) {
    return NextResponse.json({ job: null }, { status: 200 });
  }

  const [latest] = await db
    .select()
    .from(heygenJobs)
    .where(eq(heygenJobs.draftId, draftId))
    .orderBy(desc(heygenJobs.requestedAt))
    .limit(1);

  return NextResponse.json({ job: latest ? serializeJob(latest) : null });
}
