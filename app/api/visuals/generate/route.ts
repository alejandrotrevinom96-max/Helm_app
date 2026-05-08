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
    } = body as {
      projectId?: string;
      platform?: string;
      postContent?: string;
      style?: ImageStyle;
      aspectRatio?: AspectRatio;
      draftId?: string;
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

    const result = await generateVisual({
      platform: platform as
        | 'instagram'
        | 'facebook'
        | 'linkedin'
        | 'threads'
        | 'reddit',
      postContent: sanitizePromptInput(postContent),
      brandBible: (project.brandContext as BrandBible | null) ?? null,
      style,
      aspectRatio,
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
    const tempPostId = `temp-${Date.now()}`;
    const uploaded = await uploadVisualFromUrl(
      result.url,
      user.id,
      tempPostId
    ).catch(() => null);

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
