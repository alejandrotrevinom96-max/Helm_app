// PR Sprint 7.26 — Asset-based content flow.
//
// POST /api/ai/generate-asset
//   Body: { projectId, assetType, platforms[], prompt, variantLabel? }
//   Auth: user must own projectId.
//
// One call produces:
//   - 1 content_asset row (the shared media + base content).
//   - N generated_posts rows (one caption per requested platform,
//     each linked back via asset_id).
//   - For ugc_video / reel: a heygen_jobs row tied to the first
//     post (the heygen-worker cron renders the video; all N posts
//     share the same upstream render via the asset).
//   - For photo: fire-and-forget POST to /api/visuals/generate
//     using the first post's id, so the asset gets a cover image
//     without blocking the response.
//   - For carousel / long_form_text: no extra media call (carousel
//     uses the existing generate-slides flow accessible from the
//     library detail card; long_form_text has no media).
//
// Why we generate captions in parallel: Anthropic prompt caching
// means the second + Nth calls re-use the cached system prompt,
// so wall-clock time stays close to a single-call duration.
//
// Failure modes:
//   - Base content generation fails → return 502 + error.
//   - Some captions fail → return 200 with a `partialErrors` array
//     listing the platforms that didn't make it; the founder can
//     re-run from the failed-only list.
//   - HeyGen queue insert fails → return 200 (the asset + captions
//     are still valid; the founder can re-queue from settings).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  projects,
  contentAssets,
  generatedPosts,
  heygenJobs,
} from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import {
  anthropic,
  MODELS,
  cachedSystem,
  LANGUAGE_INSTRUCTION_AUDIENCE,
} from '@/lib/ai/claude';
import {
  ASSET_TYPES,
  PLATFORM_RULES,
  PLATFORM_TONE_RULES,
  type AssetType,
  type Platform,
} from '@/lib/marketing/platform-rules';
import type { BrandBible } from '@/lib/types/brand';

// Vercel: Anthropic Haiku is fast (~5-8s for typical caption
// length), but with N parallel calls we want some headroom. 60s
// gives plenty without paying for Pro-tier max.
export const maxDuration = 60;

interface RequestBody {
  projectId?: string;
  assetType?: string;
  platforms?: string[];
  prompt?: string;
  variantLabel?: 'A' | 'B' | null;
  variantGroupId?: string;
}

interface CaptionResult {
  platform: Platform;
  caption: string;
  hashtags: string[];
  cta: string | null;
}

// Direction copy fed to Haiku for the SHARED base-content step.
// Tells the model what shape the asset's core text should take
// based on the asset type — script for video, body for text,
// concept-seed for visual assets that Flux will later render.
function baseContentInstructions(type: AssetType): string {
  if (type === 'ugc_video' || type === 'reel') {
    return [
      'Write a 30-second talking-head SCRIPT.',
      'Open with a hook line in the first 3 seconds.',
      'Body delivers exactly ONE insight.',
      'End with a one-line CTA.',
      'Plain prose, no stage directions or camera notes.',
      'Total target: 70-90 words.',
    ].join(' ');
  }
  if (type === 'carousel') {
    return [
      'Write a CAROUSEL CONCEPT — 5 to 8 slides.',
      'Format: "Slide 1: <text>", "Slide 2: <text>", … one per line.',
      'Slide 1 is the hook. Last slide is the CTA.',
      'Each slide stands alone if scrolled past.',
      'Per-slide text max 25 words.',
    ].join(' ');
  }
  if (type === 'photo') {
    return [
      'Write a VISUAL CONCEPT for a single photo, in 2 short paragraphs:',
      '(1) scene description Flux can render,',
      '(2) why this image supports the message.',
      'Concrete imagery; avoid abstract metaphors.',
    ].join(' ');
  }
  // long_form_text
  return [
    'Write a LONG-FORM POST body — 4 to 8 paragraphs.',
    'Open with a hook. Body delivers a complete argument.',
    'Close with a question, CTA, or single-sentence summary.',
    'No platform-specific formatting — that gets adapted later.',
  ].join(' ');
}

// Serialize the brand bible for the cached prompt prefix. We keep
// only the fields that materially shape voice — identity / industry /
// audience / pillars / voice dimensions — so the cached prefix
// stays compact + reusable across the N caption adaptations in a
// single generate run.
function brandSummary(bb: BrandBible | null): string {
  if (!bb) return '(no brand bible yet — write in a neutral, professional voice)';
  const parts: string[] = [];
  if (bb.identity?.name) parts.push(`Brand: ${bb.identity.name}`);
  if (bb.identity?.industry) parts.push(`Industry: ${bb.identity.industry}`);
  if (bb.identity?.tagline) parts.push(`Tagline: ${bb.identity.tagline}`);
  if (bb.audience?.primary?.description) {
    parts.push(`Audience: ${bb.audience.primary.description}`);
  }
  if (Array.isArray(bb.pillars) && bb.pillars.length > 0) {
    const names = bb.pillars
      .map((p) => p?.name)
      .filter(Boolean)
      .join(', ');
    if (names) parts.push(`Pillars: ${names}`);
  }
  if (bb.voice) {
    // Translate the 5 numeric dimensions into a short word-list
    // (formal/casual, serious/playful, etc.) so the LLM can read it
    // without having to interpret raw 0-10 scales. Each axis becomes
    // a single label using its low/high extremes.
    const v = bb.voice;
    const traits: string[] = [];
    traits.push(v.formal >= 6 ? 'formal' : v.formal <= 4 ? 'casual' : 'neutral');
    traits.push(v.serious >= 6 ? 'serious' : v.serious <= 4 ? 'playful' : 'balanced');
    traits.push(v.bold >= 6 ? 'bold' : v.bold <= 4 ? 'reserved' : 'measured');
    traits.push(
      v.innovative >= 6
        ? 'innovative'
        : v.innovative <= 4
          ? 'traditional'
          : 'modern',
    );
    traits.push(
      v.approachable >= 6
        ? 'welcoming'
        : v.approachable <= 4
          ? 'exclusive'
          : 'professional',
    );
    parts.push(`Voice: ${traits.join(', ')}`);
  }
  return parts.length > 0
    ? parts.join('\n')
    : '(brand bible present but mostly empty — write in a neutral, professional voice)';
}

function textFromMessage(
  content: Array<{ type: string; text?: string }>,
): string {
  return content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text?: string }).text ?? '')
    .join('')
    .trim();
}

// PR Sprint 7.26 — Asset-based content flow.
//
// Parse Claude's "Slide 1: ...\nSlide 2: ..." carousel output into
// the shape /api/marketing/posts/[id]/generate-slides consumes
// (`structuredContent.slides` — array of {title, body, role}).
//
// Roles are derived from position:
//   - Slide 0           → 'cover' (the hook)
//   - Last slide        → 'cta'
//   - Everything else   → 'value'
// The slide-gen endpoint uses these roles to bias each Flux
// prompt (bold hero composition for cover, clean composition for
// cta, editorial for value).
interface ParsedSlide {
  title: string;
  body: string;
  role: 'cover' | 'value' | 'cta';
}

function parseCarouselSlides(baseContent: string): ParsedSlide[] {
  const lines = baseContent
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const slides: Array<{ title: string; body: string }> = [];
  for (const line of lines) {
    // Match "Slide 1: text", "Slide 1 — text", "Slide 1. text",
    // case-insensitive. Anything that doesn't match the pattern is
    // treated as a continuation of the previous slide's body.
    const m = line.match(/^slide\s+\d+\s*[:\-—.]\s*(.+)$/i);
    if (m) {
      slides.push({ title: m[1].trim().slice(0, 80), body: m[1].trim() });
    } else if (slides.length > 0) {
      const last = slides[slides.length - 1];
      last.body = `${last.body} ${line}`.slice(0, 400);
    }
  }
  // Defensive fallback: if Claude returned something we couldn't
  // parse at all, return a single slide so the carousel still
  // renders one image instead of zero.
  if (slides.length === 0) {
    slides.push({
      title: baseContent.slice(0, 80),
      body: baseContent.slice(0, 400),
    });
  }
  return slides.map((s, i, arr) => ({
    title: s.title,
    body: s.body,
    role:
      i === 0
        ? ('cover' as const)
        : i === arr.length - 1
          ? ('cta' as const)
          : ('value' as const),
  }));
}

// Lightweight hashtag extractor — pulls #word tokens out of the
// caption, dedupes, and strips them from the visible body so the
// hashtags column stays canonical and the caption column reads
// clean. Platforms that hide hashtags below the fold (IG) get
// them appended at render time.
function splitCaptionAndHashtags(raw: string): {
  caption: string;
  hashtags: string[];
} {
  const tags = new Set<string>();
  const trimmed = raw.replace(/#[\p{L}\p{N}_]+/gu, (m) => {
    tags.add(m.toLowerCase());
    return '';
  });
  return {
    caption: trimmed.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim(),
    hashtags: Array.from(tags),
  };
}

async function generateBaseContent(args: {
  assetType: AssetType;
  prompt: string;
  brand: string;
}): Promise<string> {
  const systemText = [
    'You generate the CORE content for a multi-platform marketing',
    'asset. The same core content gets adapted to N platforms in a',
    'later step — your job here is the source text, NOT a per-network',
    'caption.',
    '',
    'BRAND CONTEXT (treat as authoritative):',
    args.brand,
    '',
    'TASK:',
    baseContentInstructions(args.assetType),
    '',
    LANGUAGE_INSTRUCTION_AUDIENCE,
  ].join('\n');

  const resp = await anthropic.messages.create({
    model: MODELS.HAIKU,
    max_tokens: 1024,
    system: cachedSystem(systemText),
    messages: [
      {
        role: 'user',
        content: `The founder wants content about:\n\n${args.prompt}`,
      },
    ],
  });
  return textFromMessage(
    resp.content as Array<{ type: string; text?: string }>,
  );
}

async function adaptCaptionForPlatform(args: {
  platform: Platform;
  baseContent: string;
  assetType: AssetType;
  brand: string;
}): Promise<CaptionResult> {
  const systemText = [
    'You ADAPT a piece of base content into a platform-specific',
    'caption. Keep the message; change the SHAPE.',
    '',
    'BRAND CONTEXT (treat as authoritative):',
    args.brand,
    '',
    `PLATFORM RULES for ${args.platform}:`,
    PLATFORM_TONE_RULES[args.platform],
    '',
    'OUTPUT FORMAT: plain text. Hashtags inline at the natural spot',
    'for the platform (end-of-caption for IG/TikTok, none for FB/X/',
    'Reddit unless the rule says otherwise). No quotes around the',
    'output, no preamble.',
    '',
    LANGUAGE_INSTRUCTION_AUDIENCE,
  ].join('\n');

  const resp = await anthropic.messages.create({
    model: MODELS.HAIKU,
    max_tokens: 600,
    system: cachedSystem(systemText),
    messages: [
      {
        role: 'user',
        content: [
          `Asset type: ${args.assetType}`,
          '',
          'BASE CONTENT to adapt:',
          args.baseContent,
        ].join('\n'),
      },
    ],
  });
  const raw = textFromMessage(
    resp.content as Array<{ type: string; text?: string }>,
  );
  const { caption, hashtags } = splitCaptionAndHashtags(raw);
  return {
    platform: args.platform,
    caption,
    hashtags,
    cta: null, // CTA is embedded in caption text for now; future PR can split
  };
}

export async function POST(request: Request) {
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

    const body = (await request.json().catch(() => ({}))) as RequestBody;
    const projectId = body.projectId;
    const assetTypeRaw = body.assetType;
    const platforms = body.platforms ?? [];
    const prompt = (body.prompt ?? '').trim();
    if (!projectId || !assetTypeRaw || !platforms.length || !prompt) {
      return NextResponse.json(
        {
          error:
            'Missing fields. Required: projectId, assetType, platforms[], prompt.',
        },
        { status: 400 },
      );
    }
    if (!(ASSET_TYPES as readonly string[]).includes(assetTypeRaw)) {
      return NextResponse.json(
        { error: `Unknown asset type: ${assetTypeRaw}` },
        { status: 400 },
      );
    }
    const assetType = assetTypeRaw as AssetType;
    const allowed = new Set<Platform>(PLATFORM_RULES[assetType]);
    const requested = platforms as Platform[];
    const valid = requested.filter((p) => allowed.has(p));
    const invalid = requested.filter((p) => !allowed.has(p));
    if (valid.length === 0) {
      return NextResponse.json(
        {
          error: `No valid platforms for ${assetType}. Allowed: ${[...allowed].join(', ')}`,
        },
        { status: 400 },
      );
    }

    // Ownership: load project + scope-check.
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
      .limit(1);
    if (!project) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const brand = brandSummary(
      (project.brandContext as BrandBible | null) ?? null,
    );

    // Step 1 — generate the shared base content.
    let baseContent: string;
    try {
      baseContent = await generateBaseContent({
        assetType,
        prompt,
        brand,
      });
    } catch (e) {
      return NextResponse.json(
        {
          error:
            e instanceof Error
              ? `Base content generation failed: ${e.message}`
              : 'Base content generation failed',
        },
        { status: 502 },
      );
    }
    if (!baseContent) {
      return NextResponse.json(
        { error: 'AI returned empty base content' },
        { status: 502 },
      );
    }

    // Step 2 — insert the asset row.
    const [asset] = await db
      .insert(contentAssets)
      .values({
        userId: user.id,
        projectId,
        assetType,
        baseContent,
        promptUsed: prompt,
        brandAnalysisSnapshot:
          (project.brandContext as unknown) ?? null,
        variantLabel: body.variantLabel ?? null,
        variantGroupId: body.variantGroupId ?? null,
      })
      .returning({ id: contentAssets.id });
    if (!asset) {
      return NextResponse.json(
        { error: 'Failed to persist content asset' },
        { status: 500 },
      );
    }

    // Step 3 — adapt the caption per platform in parallel.
    const settled = await Promise.allSettled(
      valid.map((p) =>
        adaptCaptionForPlatform({
          platform: p,
          baseContent,
          assetType,
          brand,
        }),
      ),
    );

    const partialErrors: Array<{ platform: Platform; error: string }> = [];
    const captionResults: CaptionResult[] = [];
    settled.forEach((r, idx) => {
      const platform = valid[idx];
      if (r.status === 'fulfilled') {
        captionResults.push(r.value);
      } else {
        partialErrors.push({
          platform,
          error:
            r.reason instanceof Error
              ? r.reason.message
              : String(r.reason),
        });
      }
    });

    if (captionResults.length === 0) {
      // No captions came back — surface the failure rather than
      // returning an empty-posts success.
      return NextResponse.json(
        {
          error: 'All caption adaptations failed',
          partialErrors,
        },
        { status: 502 },
      );
    }

    // Step 4 — persist one generated_posts row per platform.
    // For ugc_video / reel: contentType='ugc' (legacy compatibility)
    // so the existing reel/UGC card chrome still renders. For
    // carousel: contentType='carousel'. For photo: 'photo'. For
    // long_form_text: 'text_post'.
    const legacyContentType: string =
      assetType === 'ugc_video'
        ? 'ugc'
        : assetType === 'reel'
          ? 'reel'
          : assetType === 'carousel'
            ? 'carousel'
            : assetType === 'photo'
              ? 'photo'
              : 'text_post';
    // PR Sprint 7.26 — Asset-based content flow.
    // For carousels we ALSO parse the baseContent into the slides
    // shape /api/marketing/posts/[id]/generate-slides consumes
    // (structuredContent.slides). Without this, the auto-fire
    // below finds zero slides and renders nothing.
    const parsedSlides =
      assetType === 'carousel' ? parseCarouselSlides(baseContent) : null;
    const structuredContent =
      assetType === 'carousel'
        ? { assetType, baseContent, slides: parsedSlides }
        : { assetType, baseContent };

    const inserted = await db
      .insert(generatedPosts)
      .values(
        captionResults.map((c) => ({
          projectId,
          assetId: asset.id,
          platform: c.platform,
          // `content` carries the same caption text for backward
          // compat with every existing reader (library API,
          // calendar, etc.). The new caption / hashtags / cta_text
          // columns hold the split form for the new flow.
          content: c.caption,
          caption: c.caption,
          hashtags: c.hashtags,
          ctaText: c.cta,
          prompt,
          contentType: legacyContentType,
          // Per-asset-type structured shape — carousel rows carry
          // the parsed slides[] so the slide-gen endpoint can run
          // against them; other types carry the assetType +
          // baseContent for the modal preview.
          structuredContent,
          variantLabel:
            body.variantLabel === 'A' || body.variantLabel === 'B'
              ? body.variantLabel
              : null,
          variantGroupId: body.variantGroupId ?? null,
          // isReel piggybacks for video assets so the existing
          // reel chrome (badges, processing tint) keeps working.
          isReel: assetType === 'reel' || assetType === 'ugc_video',
          // PR #43 — videoUrl flows through later (heygen-worker
          // writes to asset.videoUrl; the library route joins via
          // asset_id to surface the URL on this row).
          videoUrl: null,
          imageUrl: null,
        })),
      )
      .returning({
        id: generatedPosts.id,
        platform: generatedPosts.platform,
        caption: generatedPosts.caption,
      });

    // Step 5 — kick off media generation for video assets via the
    // heygen worker. We queue ONE job tied to the first inserted
    // draft; when it completes, the asset's videoUrl populates and
    // all N posts share the render via asset_id.
    if (
      (assetType === 'ugc_video' || assetType === 'reel') &&
      inserted.length > 0
    ) {
      try {
        const first = inserted[0];
        await db.insert(heygenJobs).values({
          draftId: first.id,
          projectId,
          userId: user.id,
          status: 'queued',
          scriptText: baseContent,
          avatarId: project.heygenAvatarId,
          voiceId: project.heygenVoiceId,
        });
      } catch (err) {
        // Non-fatal — the founder can re-queue from the library
        // detail card if it didn't land.
        console.warn(
          '[generate-asset] heygen queue insert failed (non-fatal):',
          err instanceof Error ? err.message : err,
        );
      }
    }

    // Step 6 — for photo assets, fire-and-forget visuals/generate
    // against the first inserted draft id. The visuals/generate
    // endpoint writes imageUrl back to the draft AND mirrors it
    // onto content_assets.image_urls (PR Sprint 7.26) so every
    // platform variant in the asset group surfaces the image via
    // the library's leftJoin on contentAssets.
    if (assetType === 'photo' && inserted.length > 0) {
      const first = inserted[0];
      const origin = new URL(request.url).origin;
      void fetch(`${origin}/api/visuals/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: request.headers.get('cookie') ?? '',
        },
        body: JSON.stringify({
          projectId,
          platform: first.platform,
          postContent: baseContent,
          draftId: first.id,
          painPoint: prompt,
          contentType: 'photo',
        }),
      }).catch(() => {
        /* fire-and-forget — visible in Library on next refresh */
      });
    }

    // Step 7 — for carousel assets, fire-and-forget the slide
    // generator. parseCarouselSlides() above already populated
    // structuredContent.slides on each draft, so the slide
    // endpoint can hydrate per-slide painPoint/role without
    // additional context. Generating against the FIRST draft is
    // enough — generate-slides also mirrors visualUrls onto
    // content_assets.image_urls so the rest of the group hydrates
    // through the library leftJoin.
    if (assetType === 'carousel' && inserted.length > 0) {
      const first = inserted[0];
      const origin = new URL(request.url).origin;
      void fetch(`${origin}/api/marketing/posts/${first.id}/generate-slides`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: request.headers.get('cookie') ?? '',
        },
        body: JSON.stringify({
          // The endpoint pulls slides from the row's
          // structuredContent — no extra body fields required.
          painPoint: prompt,
        }),
      }).catch(() => {
        /* fire-and-forget — visible in Library on next refresh */
      });
    }

    return NextResponse.json({
      success: true,
      asset: { id: asset.id, assetType, baseContent },
      posts: inserted.map((r, i) => ({
        id: r.id,
        platform: r.platform,
        caption: captionResults[i]?.caption ?? r.caption ?? '',
      })),
      partialErrors: partialErrors.length > 0 ? partialErrors : undefined,
      ignoredPlatforms: invalid.length > 0 ? invalid : undefined,
    });
  } catch (e) {
    // Last-resort top-level handler so we ALWAYS return JSON —
    // saves the client from "Unexpected token 'A', 'An error o'…"
    // when an unhandled throw bubbles to Next's HTML error page.
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : 'Generation failed',
      },
      { status: 500 },
    );
  }
}
