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
import { uploadVisualFromUrl } from '@/lib/visuals/storage';
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
    return `${slot} (COVER). Bold hero composition that stops scroll. THIS SLIDE'S MESSAGE: "${title}". ${body}`;
  }
  if (role === 'cta') {
    return `${slot} (CTA). Clean composition framing a clear action. THIS SLIDE'S MESSAGE: "${title}". ${body}`;
  }
  return `${slot} (VALUE). Editorial composition. THIS SLIDE'S CONCEPT: "${title}". ${body}`;
}

// PR Sprint 7.25 Phase 9 — derive a per-slide painPoint so each
// slide's image illustrates ITS OWN concept, not the carousel's
// shared pain. The IR pipeline's subject extractor treats
// painPoint as the primary lever; before this fix every slide
// shared the same pain string, so the extractor produced eight
// near-identical "tired founder at laptop" frames. Now: the
// slide title + body define the slide's narrow pain, with the
// carousel-level pain kept as background context.
function buildSlidePainPoint(
  slide: Slide,
  carouselPainPoint: string | undefined,
): string | undefined {
  const slideText = [slide.title, slide.body].filter(Boolean).join(' — ');
  if (!slideText && !carouselPainPoint) return undefined;
  if (!slideText) return carouselPainPoint;
  if (!carouselPainPoint) return slideText.slice(0, 300);
  // Slide-level pain is the primary signal; carousel-level pain is
  // appended so the extractor still feels the overall arc when the
  // slide line is short ("Built Helm." → would otherwise produce a
  // weak generic image).
  return `${slideText} (carousel about: ${carouselPainPoint})`.slice(0, 400);
}

// PR Sprint 7.25 Phase 11.9 — top-level try/catch so any throw
// inside the slide loop (Flux SDK panic, fal CDN timeout, Supabase
// storage failure, IR pipeline bug, DB transient) returns a JSON
// payload instead of bubbling up to Vercel's default plain-text
// "An error occurred" page. The client did `await res.json()`
// without inspecting content-type, so a plain-text error surfaced
// as `Unexpected token 'A', 'An error o'... is not valid JSON` —
// useless for the founder, useless for debugging. Now: any
// unhandled error renders as `{ error, hint }` with a 500 and the
// real message goes to Vercel logs.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    return await handle(request, params);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[generate-slides] unhandled error:', message, e);
    // Friendly mapping — same vocabulary the /api/visuals/generate
    // route uses so the UI shows consistent copy across surfaces.
    const lower = message.toLowerCase();
    let userMessage = 'Slide generation hit an unexpected error.';
    if (lower.includes('timeout') || lower.includes('timed out')) {
      userMessage =
        'Slide generation took too long. Try again — Flux occasionally lags.';
    } else if (lower.includes('rate limit') || lower.includes('429')) {
      userMessage =
        'Too many image requests this hour. Wait a minute and retry.';
    } else if (
      lower.includes('content policy') ||
      lower.includes('safety') ||
      lower.includes('nsfw')
    ) {
      userMessage =
        'One of the slide prompts tripped Flux’s safety filter. Try rephrasing the draft.';
    }
    return NextResponse.json(
      {
        success: false,
        error: userMessage,
        hint: 'Hit "↻ Regenerate" to try again.',
        debug:
          process.env.NODE_ENV === 'development' ? message : undefined,
      },
      { status: 500 },
    );
  }
}

async function handle(
  request: Request,
  params: Promise<{ id: string }>,
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

  // Cache short-circuit — if every slide on this draft already has a
  // persisted URL, return them instead of re-charging Flux. The
  // client now auto-fires this endpoint on mount (PR Sprint 7.25
  // Phase 8); without the cache, every Library visit would trigger
  // a fresh ~$0.30 carousel regeneration. The Library / scheduler
  // already trust visualUrls as the canonical source of truth, so
  // re-emitting them here is the right answer for a re-mount.
  //
  // To force a fresh generation (the "↻ Regenerate" button) the
  // client passes `?regenerate=1` — we honor that and skip the
  // cache.
  const url = new URL(request.url);
  const forceRegen = url.searchParams.get('regenerate') === '1';
  if (!forceRegen) {
    const cached = (row.post.visualUrls as unknown) as
      | (string | null)[]
      | null;
    if (
      Array.isArray(cached) &&
      cached.length > 0 &&
      cached.every((u): u is string => typeof u === 'string' && u.length > 0)
    ) {
      return NextResponse.json({
        success: true,
        slidesGenerated: cached.length,
        slidesRequested: cached.length,
        failures: [],
        visualUrls: cached,
        persisted: true,
        estimatedCostUsd: 0,
        cached: true,
      });
    }
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
    | 'reddit'
    // PR #88 — Sprint 7.12: TikTok carousels route through the
    // same slide-generation flow with the lib defaulting to
    // portrait (9:16) when platform === 'tiktok'.
    | 'tiktok';
  const style: ImageStyle =
    bible?.visual?.imageStyle ?? 'editorial';

  // PR Sprint 7.24 — Prompt 2. Carry the draft's original painPoint
  // through to generateVisual so the IR pipeline activates instead
  // of falling back to the legacy prompt builder. The draft's
  // `prompt` field captured what the founder asked for at
  // generation time; that IS the painPoint the cover image and
  // every slide are illustrating. Same painPoint shared across all
  // slides in the carousel.
  const draftPainPoint =
    typeof row.post.prompt === 'string' && row.post.prompt.trim().length > 0
      ? row.post.prompt.trim()
      : undefined;

  // Sequential — keeps Flux's rate-limit happy and gives us
  // mid-batch failure observability. 6-8 images in 30-60s is fine.
  const successes: { slideIndex: number; url: string; prompt: string }[] = [];
  const failures: { slideIndex: number; reason: string }[] = [];
  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    const hint = buildSlidePromptHint(slide, i, slides.length);
    // PR Sprint 7.25 Phase 11.9 — per-slide try/catch. Before
    // this, a single Flux throw (timeout, content-policy hit,
    // fal SDK panic) blew up the entire batch — the founder lost
    // ALL 8 slides instead of 1. Now: each slide's failure is
    // isolated. We push to `failures[]` (already the existing
    // pattern for null results) and continue to the next slide.
    // The bundle's final response still flags the batch as failed
    // unless EVERY slide landed, but at least the founder sees
    // which slide tripped + the others render normally.
    let result: Awaited<ReturnType<typeof generateVisual>> | null = null;
    try {
      result = await generateVisual({
        platform,
        postContent: hint,
        brandBible: bible,
        style,
        aspectRatio: 'square', // IG carousels = 1:1
        // PR Sprint 7.24 — IR pipeline inputs. With these set, each
        // slide goes through subject-extraction + brand-visual-
        // language + platform-aesthetics composition instead of the
        // lighter legacy template.
        // PR Sprint 7.25 Phase 9 — per-slide painPoint instead of
        // the shared carousel painPoint, so the IR subject extractor
        // produces a different visual concept per slide. See
        // buildSlidePainPoint for the merge strategy.
        painPoint: buildSlidePainPoint(slide, draftPainPoint),
        contentType: 'carousel',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[generate-slides] slide ${i + 1} threw:`,
        msg.slice(0, 300),
      );
      failures.push({
        slideIndex: i,
        reason: `slide ${i + 1} threw: ${msg.slice(0, 200)}`,
      });
      continue;
    }
    if (!result?.url) {
      failures.push({
        slideIndex: i,
        reason: 'fal.ai returned no image',
      });
      continue;
    }
    // PR Sprint 7.13 (BUG 3) — rehost each slide image to
    // Supabase Storage immediately. fal.ai's CDN URLs are
    // signed with a ~1-hour TTL; persisting the raw URL meant
    // every carousel scheduled more than an hour ahead lost
    // its images by the time the publisher cron picked it up.
    // We persist the Supabase URL when rehost succeeds and
    // fall back to the fal.ai URL on failure (still fresh
    // during the current session, surfaced in failures[] for
    // diagnostics).
    // PR Sprint 7.25 Phase 11.9 — also wrap the rehost in
    // try/catch so a Supabase Storage panic doesn't kill the
    // batch. If rehost throws, fall back to the fal.ai URL with
    // its 1-hour TTL (better than losing the whole slide).
    let permanentUrl: string;
    try {
      const uploaded = await uploadVisualFromUrl(
        result.url,
        user.id,
        `${id}-slide-${i}`,
      );
      permanentUrl = uploaded?.publicUrl ?? result.url;
      if (!uploaded) {
        failures.push({
          slideIndex: i,
          reason:
            'rehost to Supabase failed; using transient fal.ai URL (will expire ~1h)',
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[generate-slides] rehost slide ${i + 1} threw:`,
        msg.slice(0, 300),
      );
      permanentUrl = result.url;
      failures.push({
        slideIndex: i,
        reason: `rehost threw: ${msg.slice(0, 150)} — using transient fal.ai URL`,
      });
    }
    successes.push({
      slideIndex: i,
      url: permanentUrl,
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
