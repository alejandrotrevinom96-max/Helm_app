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
import {
  generatedPosts,
  projects,
  // PR Sprint 7.26 — Asset-based content flow. When the draft
  // being filled with slides belongs to an asset group, we mirror
  // visualUrls onto content_assets.image_urls so every platform
  // variant of the asset can render the same carousel.
  contentAssets,
} from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { generateVisual } from '@/lib/visuals/generate';
import { uploadVisualFromUrl } from '@/lib/visuals/storage';
import type { BrandBible, ImageStyle } from '@/lib/types/brand';

// PR Sprint 7.25 Phase 11.11 — bumped to Vercel Pro's 300s ceiling
// because the pre-fix 120s budget couldn't fit 8 sequential slides
// in worst case (Haiku subject extraction ~3s + Flux ~12s +
// Supabase rehost ~2s = ~17s × 8 = 136s, blowing the 120s limit
// and triggering Vercel's plaintext "An error occurred" page).
// With concurrent chunking below the actual wall time is much
// shorter, but 300s gives breathing room when fal is throttling.
export const maxDuration = 300;

// Concurrency cap for parallel slide generation. 4 in-flight is
// enough to cut total time from ~140s sequential to ~35s on an
// 8-slide carousel while staying friendly with fal.ai's rate
// limits. Bumping past 4 occasionally triggers fal's per-second
// quota and increases the chance of mid-batch throttling.
const SLIDE_CONCURRENCY = 4;

// PR Sprint 7.25 Phase 11.14 — explicit per-slide timeout. The
// founder was still hitting Vercel's "An error occurred"
// plaintext page even after parallel chunking + 300s
// maxDuration. Symptom: fal.subscribe() hangs indefinitely when
// fal.ai's worker queue is congested — the SDK has no built-in
// timeout, so a stuck call ties up the lambda until Vercel
// force-kills it (and then returns plain text BEFORE our
// try/catch can return JSON). 75s per slide is generous
// (typical Flux completion is 8-15s, p99 ~30s); anything past
// 75s is almost certainly hung. We Promise.race against an
// AbortController so the timeout actually frees the lambda
// instead of just resolving our promise while the underlying
// fetch keeps holding the event loop.
const SLIDE_TIMEOUT_MS = 75_000;

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`));
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

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

  // PR Sprint 7.25 Phase 11.11 — chunked-parallel slide generation.
  // Pre-fix: 8 slides × ~17s (IR + Flux + rehost) = ~140s sequential,
  // blew past the 120s Vercel ceiling, killed the lambda mid-batch,
  // Vercel returned its plaintext "An error occurred" page. Now: we
  // process SLIDE_CONCURRENCY (=4) slides at a time. Each slide's
  // pipeline stays sequential within itself (extract → generate →
  // rehost) but multiple slides run in parallel. Total wall time
  // drops to ~35-40s for an 8-slide carousel, well inside the
  // 300s ceiling. fal.ai's per-second rate limit handles 4
  // in-flight comfortably.
  //
  // Per-slide try/catch logic moved into `processSlide` so the
  // chunked promise array can use Promise.allSettled. We still
  // categorize failures the same way — slot index + reason — and
  // populate the same successes / failures arrays as the original
  // sequential version.
  const successes: { slideIndex: number; url: string; prompt: string }[] = [];
  const failures: { slideIndex: number; reason: string }[] = [];

  const processSlide = async (i: number): Promise<void> => {
    const slide = slides[i];
    const hint = buildSlidePromptHint(slide, i, slides.length);
    let result: Awaited<ReturnType<typeof generateVisual>> | null = null;
    try {
      // PR Sprint 7.25 Phase 11.14 — wrapped in withTimeout so a
      // hung fal.subscribe call can't drag the whole batch over
      // Vercel's lambda ceiling. fal occasionally hangs when its
      // worker queue is congested; without this the lambda would
      // wait 300s, get force-killed, and return Vercel's
      // plaintext error page (founder saw "Server didn't respond
      // with JSON" repeatedly even with 300s budget).
      result = await withTimeout(
        generateVisual({
          platform,
          postContent: hint,
          brandBible: bible,
          style,
          aspectRatio: 'square', // IG carousels = 1:1
          // PR Sprint 7.24 IR inputs; PR Sprint 7.25 Phase 9 per-
          // slide painPoint for varied subject extraction.
          painPoint: buildSlidePainPoint(slide, draftPainPoint),
          contentType: 'carousel',
        }),
        SLIDE_TIMEOUT_MS,
        `slide ${i + 1} generateVisual`,
      );
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
      return;
    }
    if (!result?.url) {
      failures.push({
        slideIndex: i,
        reason: 'fal.ai returned no image',
      });
      return;
    }
    // Rehost to Supabase Storage. fal.ai CDN URLs are signed with
    // a ~1-hour TTL; persisting the raw URL meant carousels
    // scheduled past 1h lost their images by publish time. We
    // persist the Supabase URL when rehost succeeds and fall back
    // to the fal.ai URL on failure (still fresh during the
    // current session). Inner try/catch so a Supabase Storage
    // panic doesn't kill the slide.
    let permanentUrl: string;
    try {
      // PR Sprint 7.25 Phase 11.14 — same timeout protection as
      // the generateVisual call above. Supabase Storage upload
      // shouldn't normally hang but defense-in-depth.
      const uploaded = await withTimeout(
        uploadVisualFromUrl(result.url, user.id, `${id}-slide-${i}`),
        30_000,
        `slide ${i + 1} rehost`,
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
  };

  // Run slides in chunks of SLIDE_CONCURRENCY. Promise.allSettled
  // so a single slide rejecting (it shouldn't — processSlide is
  // exhaustively try/catch'd) never aborts the chunk.
  for (let i = 0; i < slides.length; i += SLIDE_CONCURRENCY) {
    const chunk = slides
      .slice(i, i + SLIDE_CONCURRENCY)
      .map((_, j) => i + j);
    await Promise.allSettled(chunk.map((idx) => processSlide(idx)));
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
    const [persisted] = await db
      .update(generatedPosts)
      .set({ visualUrls: ordered as string[] })
      .where(eq(generatedPosts.id, id))
      .returning({ assetId: generatedPosts.assetId });

    // PR Sprint 7.26 — Asset-based content flow. Mirror the
    // ordered slide URLs onto content_assets.image_urls. The
    // library API hydrates visualUrls from the asset when present,
    // so this is what makes a multi-platform carousel render the
    // same slides across LinkedIn + IG + FB without re-rendering.
    if (persisted?.assetId) {
      try {
        await db
          .update(contentAssets)
          .set({ imageUrls: ordered as string[] })
          .where(eq(contentAssets.id, persisted.assetId));
      } catch (err) {
        console.warn(
          '[generate-slides] failed to mirror visualUrls to asset (non-fatal):',
          err instanceof Error ? err.message : err,
        );
      }
    }
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
