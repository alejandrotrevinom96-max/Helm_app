import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { generatedPosts, projects } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import {
  generateVisual,
  type AspectRatio,
} from '@/lib/visuals/generate';
import { uploadVisualFromUrl } from '@/lib/visuals/storage';
import { checkRateLimit } from '@/lib/rate-limit';
import type { BrandBible, ImageStyle } from '@/lib/types/brand';

// Vercel: image gen takes ~8s typically; 60s is enough headroom for slow
// fal.ai responses without paying for the full 300s Pro budget.
export const maxDuration = 60;

const VALID_PLATFORMS = new Set([
  'instagram',
  'facebook',
  'linkedin',
  'threads',
  'reddit',
  // PR #88 — Sprint 7.12: TikTok image generation for Single
  // Photo + Carousel content types. The visuals lib defaults
  // tiktok to 'portrait' aspect (9:16) because that's TikTok's
  // native vertical format.
  'tiktok',
]);
const VALID_ASPECT: Set<AspectRatio> = new Set<AspectRatio>([
  'square',
  'portrait',
  'landscape',
]);

// Strip characters that fal.ai's content policy / prompt parser have
// historically choked on (in production, the symptom was the route
// returning Vercel's HTML error page, which the client tried to JSON-
// parse → "Unexpected token 'A', 'An error o'..."). Trailing question
// marks and currency-prefix tokens are the most common culprits.
function sanitizePromptInput(raw: string): string {
  return raw
    .replace(/[?]+(\s|$)/g, '$1') // ? followed by space or EOL → drop the ?
    .replace(/[$€£¥](\d)/g, '$1') // "$30" → "30"
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1000);
}

export async function POST(request: Request) {
  // Top-level try/catch ensures we ALWAYS return JSON. Pre-PR-20 an
  // uncaught throw (fal SDK panic, storage timeout, etc.) bubbled to
  // Next's default error page, which is HTML — and the client then
  // crashed trying to parse it as JSON. The user-facing symptom was
  // "Unexpected token 'A', 'An error o'... is not valid JSON".
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Rate limit: 30 visuals per hour per user. At $0.05/image that caps
    // accidental generation runs at $1.50/hr — enough to catch loops without
    // blocking normal use.
    const limit = checkRateLimit(`visual:${user.id}`, 30, 60 * 60 * 1000);
    if (!limit.allowed) {
      return NextResponse.json(
        {
          error: 'Rate limit exceeded',
          hint: `Try again in ${Math.ceil(limit.resetMs / 60000)} minutes.`,
          cost_protection: true,
        },
        { status: 429 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const {
      projectId,
      platform,
      postContent,
      style,
      aspectRatio,
      // PR #43 — Sprint 6.7.1: when the client passes the
      // generated_posts.id of the draft this visual belongs to,
      // we persist the resulting URL + prompt back onto that
      // row. Optional so legacy callers (and any non-draft
      // visual flow) keep working.
      draftId,
      // PR Sprint 7.24 — Prompt 2. The IR visual pipeline
      // (lib/voice-engine/visuals/) needs painPoint + contentType
      // to fire — without them generateVisual silently falls back
      // to the lighter legacy prompt. Accept them on the request
      // body; when missing, we hydrate from the draft row below
      // (so existing UI callers that only know about postContent
      // still benefit when a draftId is provided).
      painPoint: bodyPainPoint,
      contentType: bodyContentType,
    } = body as {
      projectId?: string;
      platform?: string;
      postContent?: string;
      style?: ImageStyle;
      aspectRatio?: AspectRatio;
      draftId?: string;
      painPoint?: string;
      contentType?: 'photo' | 'carousel' | 'ugc' | string;
    };

    if (!projectId || !platform || !postContent) {
      return NextResponse.json(
        { error: 'projectId, platform, postContent required' },
        { status: 400 }
      );
    }
    if (!VALID_PLATFORMS.has(platform)) {
      return NextResponse.json({ error: 'Invalid platform' }, { status: 400 });
    }
    if (aspectRatio && !VALID_ASPECT.has(aspectRatio)) {
      return NextResponse.json(
        { error: 'Invalid aspectRatio' },
        { status: 400 }
      );
    }

    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
      .limit(1);
    if (!project)
      return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (!process.env.FAL_API_KEY) {
      return NextResponse.json(
        {
          error: 'Image generation not configured',
          hint: 'FAL_API_KEY env var is missing. Configure it in Vercel dashboard.',
        },
        { status: 503 }
      );
    }

    // PR Sprint 7.24 — Prompt 2. Hydrate IR-pipeline inputs from
    // the draft row when the client passed a draftId. The IR
    // pipeline (Sprint 7.19) produces a measurably richer Flux
    // prompt (subject extraction + brand visual language + platform
    // aesthetics + colors) than the legacy template, but it only
    // fires when painPoint AND contentType are both present.
    //
    // Resolution order:
    //   1. Use request body's painPoint/contentType if explicitly
    //      passed by the client (lets the carousel slide endpoint
    //      pass per-slide context that overrides the draft-row
    //      defaults).
    //   2. Otherwise, when draftId is provided, look up the draft's
    //      `prompt` (= original user painPoint at generation time)
    //      and `contentType` from generatedPosts.
    //   3. Otherwise, leave undefined → generateVisual falls back to
    //      the legacy path. Still uses the brand bible, just less
    //      aggressively.
    let painPoint: string | undefined = bodyPainPoint?.trim() || undefined;
    let resolvedContentType: 'photo' | 'carousel' | 'ugc' | undefined;
    const isValidContentType = (
      v: string | undefined,
    ): v is 'photo' | 'carousel' | 'ugc' =>
      v === 'photo' || v === 'carousel' || v === 'ugc';
    if (isValidContentType(bodyContentType)) {
      resolvedContentType = bodyContentType;
    }

    if ((!painPoint || !resolvedContentType) && draftId) {
      try {
        const [draft] = await db
          .select({
            prompt: generatedPosts.prompt,
            contentType: generatedPosts.contentType,
          })
          .from(generatedPosts)
          .where(eq(generatedPosts.id, draftId))
          .limit(1);
        if (draft) {
          if (!painPoint && draft.prompt) painPoint = draft.prompt;
          if (!resolvedContentType) {
            // Map the granular DB content_type to the IR pipeline's
            // 3-bucket taxonomy. Anything that lands on photo or
            // carousel uses Flux; ugc is mostly for HeyGen but the
            // IR pipeline accepts it too for the rare UGC photo
            // covers + thumbnails.
            const dbType = draft.contentType ?? '';
            if (dbType === 'photo' || dbType === 'single_image') {
              resolvedContentType = 'photo';
            } else if (dbType === 'carousel') {
              resolvedContentType = 'carousel';
            } else if (dbType === 'ugc' || dbType === 'reel') {
              resolvedContentType = 'ugc';
            }
          }
        }
      } catch (err) {
        console.warn(
          '[visuals/generate] draft hydration for IR inputs failed (non-fatal):',
          err instanceof Error ? err.message : err,
        );
      }
    }

    const result = await generateVisual({
      platform: platform as
        | 'instagram'
        | 'facebook'
        | 'linkedin'
        | 'threads'
        | 'reddit'
        | 'tiktok',
      postContent: sanitizePromptInput(postContent),
      brandBible: (project.brandContext as BrandBible | null) ?? null,
      style,
      aspectRatio,
      // IR pipeline inputs. Both must be non-empty for the rich
      // pipeline to fire — generateVisual falls back to legacy if
      // either is missing.
      painPoint,
      contentType: resolvedContentType,
    });

    if (!result) {
      return NextResponse.json(
        {
          error: 'Visual generation failed',
          hint: 'fal.ai returned no result. The prompt may have been rejected by safety filters, or contain characters fal.ai struggles with (special punctuation, currency symbols). Try rephrasing without ? or $ symbols.',
        },
        { status: 502 }
      );
    }

    // Re-host the image so it survives past fal.ai's CDN TTL. If the bucket
    // isn't configured yet, we fall back to fal's URL — at least the user
    // sees the image during this session. Storage failures don't block the
    // response — we still return the fal URL.
    //
    // PR Sprint 7.13 hotfix v2 (BUG 3B) — the silent .catch(() => null)
    // hid the real cause every time the bucket wasn't configured or
    // the service role couldn't write. Now we log the actual error
    // message so the founder (and ops) can see WHY persistence
    // failed in Vercel logs. We also log when uploadVisualFromUrl
    // returns null (bucket missing / RLS denied — the lib logs
    // internally too but this gives us a single grep point).
    const tempPostId = `temp-${Date.now()}`;
    const uploaded = await uploadVisualFromUrl(
      result.url,
      user.id,
      tempPostId,
    ).catch((err: unknown) => {
      console.error(
        '[visuals/generate] Storage upload threw:',
        err instanceof Error ? err.message : String(err),
      );
      return null;
    });

    if (!uploaded) {
      console.warn(
        '[visuals/generate] Falling back to transient fal.ai URL — image will 404 after ~1 hour. Check the helm-visuals bucket exists in Supabase and the service role has insert permissions.',
      );
    }

    const finalUrl = uploaded?.publicUrl ?? result.url;

    // PR #43 — Sprint 6.7.1: persist the visual onto the draft
    // row when the client asked us to. Ownership is verified
    // through the project ownership check above (the project
    // row was already fetched by the project-bound visual gen
    // helper); we additionally constrain by projectId so a
    // forged draftId from a different project can't be written.
    if (draftId) {
      try {
        await db
          .update(generatedPosts)
          .set({
            imageUrl: finalUrl,
            imagePrompt: result.prompt,
          })
          .where(
            and(
              eq(generatedPosts.id, draftId),
              eq(generatedPosts.projectId, projectId)
            )
          );
        // PR #46 — Sprint 6.7.4: invalidate Library + Calendar
        // server caches now that this draft has a persisted
        // image. Without this, prefetched RSC payloads in those
        // routes would still report visualUrl=null until the
        // 30s router cache TTL expires.
        revalidatePath('/marketing/library');
        revalidatePath('/marketing/calendar');
        revalidatePath('/marketing/generate');
      } catch (persistErr) {
        // Persistence failure shouldn't fail the whole request
        // — the user already has the visual in client memory.
        // Log + carry on; refresh might lose the visual but
        // the live session still has it.
        console.error(
          '[VISUALS GENERATE] failed to persist on draft:',
          persistErr
        );
      }
    }

    return NextResponse.json({
      ok: true,
      visual: {
        url: finalUrl,
        prompt: result.prompt,
        width: result.width,
        height: result.height,
        cost: result.costEstimate,
        provider: result.provider,
        persisted: !!uploaded,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[VISUALS GENERATE] unexpected error:', message);

    // Map common backend errors to user-friendly messages so the toast
    // says something actionable instead of the raw stack trace.
    let userMessage = 'Image generation failed. Please try again.';
    const lower = message.toLowerCase();
    if (lower.includes('rate limit') || lower.includes('429')) {
      userMessage = 'Too many requests. Please wait a minute and retry.';
    } else if (lower.includes('timeout')) {
      userMessage =
        'Image generation took too long. Try a shorter or simpler prompt.';
    } else if (
      lower.includes('content policy') ||
      lower.includes('safety') ||
      lower.includes('nsfw')
    ) {
      userMessage =
        'Prompt was rejected by image safety filters. Try rephrasing.';
    } else if (lower.includes('invalid') || lower.includes('400')) {
      userMessage =
        'Prompt format issue. Avoid special characters like ? or $ if possible.';
    }

    return NextResponse.json(
      {
        error: userMessage,
        debug:
          process.env.NODE_ENV === 'development' ? message : undefined,
      },
      { status: 500 }
    );
  }
}
