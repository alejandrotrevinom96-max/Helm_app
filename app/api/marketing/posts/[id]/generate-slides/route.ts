// PR #65 — Sprint 7.0.8: generate one Flux Pro image per slide in a
// Carousel structured draft.
//
// The structured-drafts pipeline (Sprint 7.0.4) returns slides as
// {title, body, role}. Instagram needs an actual JPEG/PNG per slide
// before /media_publish can create a carousel container — so this
// endpoint loops the slide list, calls `generateVisual()` per slide
// with a brand-aware prompt, and persists the URLs in
// `generatedPosts.visualUrls`.
//
// Cost: 1024×1024 Flux Pro v1.1 ≈ $0.05/image. A 6-slide carousel
// runs ~$0.30. The UI shows the cost upfront so the founder confirms
// before kicking off.
//
// Rate-limit: 5 carousels/hr per user (~$1.50 ceiling). Per-slide
// failures are non-fatal — we persist what succeeds and surface the
// errors to the client.
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { generatedPosts, projects } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { generateVisual } from '@/lib/visuals/generate';
import type { BrandBible, ImageStyle } from '@/lib/types/brand';

export const maxDuration = 120; // 6-8 sequential Flux calls

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Slide {
  title?: string;
  body?: string;
  role?: string;
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function extractSlides(structured: unknown): Slide[] {
  if (!structured || typeof structured !== 'object') return [];
  const slides = (structured as { slides?: unknown }).slides;
  if (!Array.isArray(slides)) return [];
  return slides
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s) => ({
      title: asString(s.title),
      body: asString(s.body),
      role: asString(s.role),
    }));
}

function buildSlidePromptHint(
  slide: Slide,
  index: number,
  total: number,
): string {
  const role = slide.role || (index === 0 ? 'cover' : 'value');
  const slot = `Slide ${index + 1} of ${total}`;
  const title = slide.title || '';
  const body = slide.body || '';
  if (role === 'cover') {
    return `${slot} (COVER). Bold hero composition that stops scroll. Headline message: "${title}". ${body}`;
  }
  if (role === 'cta') {
    return `${slot} (CTA). Clean composition that frames a clear action. Action message: "${title}". ${body}`;
  }
  return `${slot} (VALUE). Editorial composition. Concept: "${title}". Supporting context: ${body}`;
}

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
    return NextResponse.json({ error: 'Invalid draft id' }, { status: 400 });
  }

  // 5 carousels per hour per user. Slide loop is ~$0.30 per call so
  // this caps spend at ~$1.50/hr/user worst case.
  const limit = checkRateLimit(
    `generate-slides:${user.id}`,
    5,
    60 * 60 * 1000,
  );
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
        hint: `Try again in ${Math.ceil(limit.resetMs / 60000)} minutes.`,
      },
      { status: 429 },
    );
  }

  // Pull draft + parent project (ownership join).
  const [row] = await db
    .select({ post: generatedPosts, project: projects })
    .from(generatedPosts)
    .innerJoin(projects, eq(projects.id, generatedPosts.projectId))
    .where(and(eq(generatedPosts.id, id), eq(projects.userId, user.id)))
    .limit(1);
  if (!row) {
    return NextResponse.json(
      { error: 'Draft not found or forbidden' },
      { status: 403 },
    );
  }

  if (row.post.contentType !== 'carousel') {
    return NextResponse.json(
      { error: 'Slide generation is only for carousel drafts' },
      { status: 400 },
    );
  }

  const slides = extractSlides(row.post.structuredContent);
  if (slides.length === 0) {
    return NextResponse.json(
      {
        error: 'No slides in structured content. Re-generate the draft first.',
      },
      { status: 400 },
    );
  }
  if (slides.length > 8) {
    return NextResponse.json(
      {
        error: 'Instagram allows max 8 carousel slides.',
        hint: 'Re-generate with fewer slides.',
      },
      { status: 400 },
    );
  }

  const bible = (row.project.brandContext as BrandBible | null) ?? null;
  const platform = (row.post.platform ?? 'instagram') as
    | 'instagram'
    | 'facebook'
    | 'linkedin'
    | 'threads'
    | 'reddit';
  const style: ImageStyle =
    bible?.visual?.imageStyle ?? 'editorial';

  // Sequential — keeps Flux's rate-limit happy and gives us
  // mid-batch failure observability. 6-8 images in 30-60s is fine.
  const successes: { slideIndex: number; url: string; prompt: string }[] = [];
  const failures: { slideIndex: number; reason: string }[] = [];
  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    const hint = buildSlidePromptHint(slide, i, slides.length);
    // Feed the slide hint to generateVisual via the postContent
    // field — that's already the surface the existing prompt
    // builder reads + integrates with the brand bible.
    const result = await generateVisual({
      platform,
      postContent: hint,
      brandBible: bible,
      style,
      aspectRatio: 'square', // IG carousels = 1:1
    });
    if (!result?.url) {
      failures.push({
        slideIndex: i,
        reason: 'fal.ai returned no image',
      });
      continue;
    }
    successes.push({
      slideIndex: i,
      url: result.url,
      prompt: result.prompt,
    });
  }

  if (successes.length === 0) {
    return NextResponse.json(
      {
        error: 'All slide generations failed',
        failures,
        hint: 'Check FAL_API_KEY env var or try again.',
      },
      { status: 502 },
    );
  }

  // Build the URL array in slide-index order. Slots where
  // generation failed get null — the publisher will refuse to
  // publish a carousel with gaps, but storing them lets the UI
  // show which slides need retry.
  const ordered: (string | null)[] = new Array(slides.length).fill(null);
  for (const s of successes) {
    ordered[s.slideIndex] = s.url;
  }
  // Only persist when EVERY slide has an image — partial carousels
  // can't be published. UI will surface the failures so the founder
  // can retry; we don't half-stamp the column.
  const allPresent = ordered.every((u): u is string => typeof u === 'string');
  if (allPresent) {
    await db
      .update(generatedPosts)
      .set({ visualUrls: ordered as string[] })
      .where(eq(generatedPosts.id, id));
  }

  return NextResponse.json({
    success: true,
    slidesGenerated: successes.length,
    slidesRequested: slides.length,
    failures,
    visualUrls: ordered,
    persisted: allPresent,
    estimatedCostUsd: Number((successes.length * 0.05).toFixed(2)),
  });
}
