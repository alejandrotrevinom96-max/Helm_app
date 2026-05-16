// PR Sprint 7.26 — Asset-based content flow.
// PR Sprint 7.28 — Routed through the canonical voice engine
// (buildAdaptivePrompt + appendUgcSchemaToPrompt + dynamic
// CLIENT CONTEXT block + HUMANIZE_RULES + PLATFORM_TONE) so
// every Haiku call site inside this endpoint inherits the same
// prompt engineering as /api/ai/generate-structured (Sprint 7.16
// + 7.22 + 7.24).
//
// POST /api/ai/generate-asset
//   Body: {
//     projectId, assetType, platforms[], prompt,
//     variantLabel?, variantGroupId?,
//     baseContentOverride?,         // founder-picked script (spoken text)
//     baseUgcBundleOverride?,       // optional full UGCBundle JSON
//   }
//   Auth: user must own projectId.
//
// One call produces:
//   - 1 content_asset row (the shared media + base content).
//   - N generated_posts rows (one caption per platform, each
//     linked via asset_id).
//   - For ugc_video / reel: 1 heygen_jobs row queued (cron + the
//     /api/heygen/generate-video helper render the video).
//   - For photo: fire-and-forget /api/visuals/generate.
//   - For carousel: fire-and-forget /api/marketing/posts/[id]/
//     generate-slides.
//   - For long_form_text: no media call (baseContent IS the asset).
//
// Engine integration per asset type:
//
//   ugc_video / reel:
//     - WITHOUT baseContentOverride: full buildAdaptivePrompt +
//       appendUgcSchemaToPrompt → UGCBundle JSON. Extract spoken
//       text via scriptText(bundle); persist the bundle on each
//       generated_post.structuredContent for future overlay /
//       hashtag rendering.
//     - WITH baseContentOverride (founder picked from A/B): use
//       it verbatim. If baseUgcBundleOverride is also present,
//       persist that on each post; otherwise just persist the
//       spoken text. Skips one Haiku call.
//
//   carousel / photo / long_form_text:
//     - Always: full buildAdaptivePrompt (no UGC schema layer)
//       → plain prose output. The carousel slide parser splits
//       "Slide N: …" lines into the slides[] structure the
//       generate-slides endpoint consumes.
//
//   Per-platform caption adaptation (every asset type, N parallel):
//     - Engine-aware adaptation prompt. Stacks:
//         PROMPT_COMPOSITION_RULES
//       + HUMANIZE_RULES
//       + CLIENT CONTEXT block (formatDynamicContext)
//       + PLATFORM_TONE_INSTRUCTIONS for the target platform
//       + my PLATFORM_TONE_RULES override (for reel sub-variants)
//       + "Adapt this base content for {platform}" directive
//     - Output: plain caption text, hashtags split out by regex.

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
import { loadClientContext } from '@/lib/voice-engine/loader';
import {
  buildAdaptivePrompt,
  formatDynamicContext,
} from '@/lib/voice-engine/prompt-builder';
import { appendUgcSchemaToPrompt } from '@/lib/voice-engine/ugc-prompt';
import {
  parseUgcBundle,
  scriptText as flattenUgcScript,
  type UGCBundle,
} from '@/lib/voice-engine/ugc-schema';
import { HUMANIZE_RULES } from '@/lib/voice-engine/humanize-rules';
import {
  assetTypeToContentType,
  platformToVoicePlatform,
} from '@/lib/voice-engine/asset-mapping';
import {
  PROMPT_COMPOSITION_RULES,
  PLATFORM_TONE_INSTRUCTIONS,
  type Platform as VoicePlatform,
} from '@/lib/ai/platform-tone';
import {
  ASSET_TYPES,
  PLATFORM_RULES,
  PLATFORM_TONE_RULES,
  type AssetType,
  type Platform,
} from '@/lib/marketing/platform-rules';
// PR Sprint B-finish — new asset rows + a queued HeyGen job are
// meaningful signal for the "This week" insights bullets ("you
// generated 3 assets this week — schedule them"). Drop the
// analytics insights cache after a successful generation so the
// next /analytics visit regenerates with the new state.
import { invalidateAnalyticsInsightsCache } from '@/lib/analytics/invalidate-insights-cache';

// Vercel: Anthropic Haiku is fast (~5-8s for typical caption
// length), but N parallel adaptations + a primary content call
// give us some headroom. 60s is plenty.
export const maxDuration = 60;

interface RequestBody {
  projectId?: string;
  assetType?: string;
  platforms?: string[];
  prompt?: string;
  variantLabel?: 'A' | 'B' | null;
  variantGroupId?: string;
  // PR Sprint 7.27 — UGC A/B script picker. When the founder
  // committed a script from /api/ai/generate-ugc-scripts, the
  // panel passes it back so we skip primary content generation.
  baseContentOverride?: string;
  // PR Sprint 7.28 — when the override came from the A/B picker
  // we ALSO receive the full UGCBundle JSON so the structured
  // bundle (hook + body + cta + overlays + caption + hashtags)
  // is preserved on each generated_post.structuredContent for
  // future surface rendering.
  baseUgcBundleOverride?: UGCBundle;
}

interface CaptionResult {
  platform: Platform;
  caption: string;
  hashtags: string[];
  cta: string | null;
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

// Lightweight hashtag extractor — pulls #word tokens out of the
// caption, dedupes, and strips them from the visible body so the
// hashtags column stays canonical and the caption reads clean.
// Platforms that prefer hashtags hidden below the fold (IG) get
// them re-appended at render time.
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

// Parse "Slide N: …" lines into the slides[] shape that
// generate-slides consumes. Roles are derived from position:
// first → cover, last → cta, middle → value.
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
    const m = line.match(/^slide\s+\d+\s*[:\-—.]\s*(.+)$/i);
    if (m) {
      slides.push({ title: m[1].trim().slice(0, 80), body: m[1].trim() });
    } else if (slides.length > 0) {
      const last = slides[slides.length - 1];
      last.body = `${last.body} ${line}`.slice(0, 400);
    }
  }
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

// =============================================================
// Primary content generation — routes through the canonical
// voice engine pipeline.
// =============================================================
//
// For UGC/reel: produces a UGCBundle JSON via the same
// buildAdaptivePrompt + appendUgcSchemaToPrompt stack
// generate-structured uses. Returns spokenText for HeyGen +
// the full bundle for future overlay/hashtag rendering.
//
// For carousel/photo/text: produces plain prose via
// buildAdaptivePrompt (no schema layer). The engine still
// applies HUMANIZE + brand bible + voice fingerprint + winning
// /losing patterns + variety + idiosyncrasies, the model just
// outputs prose rather than UGCBundle JSON.
async function generatePrimaryContent(args: {
  assetType: AssetType;
  prompt: string;
  primaryPlatform: VoicePlatform;
  clientContext: Awaited<ReturnType<typeof loadClientContext>>;
}): Promise<{
  spokenOrBaseText: string;
  ugcBundle: UGCBundle | null;
}> {
  const contentType = assetTypeToContentType(args.assetType);
  const isUgcLike = contentType === 'ugc';

  const basePrompt = buildAdaptivePrompt({
    platform: args.primaryPlatform,
    contentType,
    clientContext: args.clientContext,
    painPoint: args.prompt,
    includeExamples: true,
    injectHumanize: true,
  });

  const stackedPrompt = isUgcLike
    ? appendUgcSchemaToPrompt(basePrompt, args.primaryPlatform)
    : basePrompt;

  const systemText = isUgcLike
    ? [
        "You are Helm's content generator. You produce ONE UGCBundle JSON",
        'per request, matching the brand voice and the schema in the user message.',
        '',
        'RULES (every output)',
        '- Match the brand voice exactly. No vague marketing copy.',
        '- Respect cadence + hook + delivery + overlay rules.',
        '- Return STRICT JSON only — no prose, no markdown fences.',
        '- The JSON must validate against the UGCBundle schema.',
        '- Never invent facts beyond the brand bible.',
        '',
        LANGUAGE_INSTRUCTION_AUDIENCE,
      ].join('\n')
    : [
        "You are Helm's content generator. You produce ONE piece of base",
        'content matching the brand voice and the type-specific format rules',
        'in the user message.',
        '',
        'RULES (every output)',
        '- Match the brand voice exactly. No vague marketing copy.',
        '- Specific over generic. Use brand phrases, avoid banned terms.',
        '- Return plain prose — no markdown fences, no commentary.',
        '- Never invent facts beyond the brand bible.',
        '',
        LANGUAGE_INSTRUCTION_AUDIENCE,
      ].join('\n');

  const resp = await anthropic.messages.create({
    model: MODELS.HAIKU,
    max_tokens: 2000,
    system: cachedSystem(systemText),
    messages: [{ role: 'user', content: stackedPrompt }],
  });
  const text = textFromMessage(
    resp.content as Array<{ type: string; text?: string }>,
  );

  if (!isUgcLike) {
    return { spokenOrBaseText: text, ugcBundle: null };
  }

  // UGC path — parse the JSON. Strip any leading prose / trailing
  // <override_log> blocks so parseUgcBundle sees just the bundle.
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    throw new Error('Model returned no UGCBundle JSON object');
  }
  const jsonStr = text.slice(jsonStart, jsonEnd + 1);
  let raw: unknown;
  try {
    raw = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(
      `Invalid UGCBundle JSON: ${e instanceof Error ? e.message : 'parse error'}`,
    );
  }
  const parsed = parseUgcBundle(raw);
  if (parsed.kind === 'failed') {
    throw new Error(`UGCBundle schema failed: ${parsed.issues.slice(0, 300)}`);
  }
  return {
    spokenOrBaseText: flattenUgcScript(parsed.bundle),
    ugcBundle: parsed.bundle,
  };
}

// =============================================================
// Per-platform caption adaptation — engine-aware.
// =============================================================
//
// Builds a custom adaptation prompt that splices the engine's
// dynamic CLIENT CONTEXT block (brand bible + voice fingerprint
// + winning/losing patterns + overrides + anti-samples) +
// HUMANIZE_RULES + PLATFORM_TONE_INSTRUCTIONS for the target
// platform, then asks the model to adapt the EXISTING base
// content rather than write fresh content.
//
// Why not buildAdaptivePrompt: that helper produces a "write the
// X for Y" prompt with structured output expectations — wrong
// fit for the "rephrase this baseContent for Y" task.
async function adaptCaptionForPlatform(args: {
  platform: Platform;
  baseContent: string;
  assetType: AssetType;
  clientContext: Awaited<ReturnType<typeof loadClientContext>>;
}): Promise<CaptionResult> {
  const voicePlatform = platformToVoicePlatform(args.platform);
  const dynamicContext = formatDynamicContext(
    args.clientContext,
    voicePlatform,
  );
  // Engine's canonical PLATFORM_TONE for the folded parent
  // network (Sprint 7.13). Carries the full ~1KB caption-format
  // rule bank.
  const engineTone = PLATFORM_TONE_INSTRUCTIONS[voicePlatform];
  // My reel-specific overrides (Sprint 7.26). When the platform
  // is a reel sub-variant we layer these on top of the parent
  // network's tone so the caption still respects reel quirks
  // (short hook line, no hashtag overload).
  const reelOverride = PLATFORM_TONE_RULES[args.platform];

  const systemText = [
    "You are Helm's content adapter. You take a piece of base content the",
    'founder produced for a multi-platform asset and adapt it into a',
    "single-platform caption that fits the platform's native format.",
    '',
    "Keep the message. Change the SHAPE. Match the brand voice exactly.",
    '',
    'OUTPUT: plain text. Hashtags inline at the natural spot for the',
    'platform (end-of-caption for IG/TikTok, none for FB/X/Reddit unless',
    "the rule says otherwise). No quotes around the output, no preamble,",
    'no markdown fences.',
    '',
    LANGUAGE_INSTRUCTION_AUDIENCE,
  ].join('\n');

  const userPrompt = [
    PROMPT_COMPOSITION_RULES,
    '',
    HUMANIZE_RULES,
    '',
    'CLIENT CONTEXT (apply strongly, this is the client-specific intelligence):',
    dynamicContext,
    '',
    `PLATFORM_TONE for ${voicePlatform.toUpperCase()} (specialization for this caption):`,
    engineTone,
    '',
    `PLATFORM SUB-VARIANT (${args.platform}): ${reelOverride}`,
    '',
    'ASSET TYPE: ' + args.assetType,
    '',
    'BASE CONTENT to adapt into a caption for the platform above:',
    '"""',
    args.baseContent,
    '"""',
    '',
    `Return the ${args.platform} caption only.`,
  ].join('\n');

  const resp = await anthropic.messages.create({
    model: MODELS.HAIKU,
    max_tokens: 800,
    system: cachedSystem(systemText),
    messages: [{ role: 'user', content: userPrompt }],
  });
  const raw = textFromMessage(
    resp.content as Array<{ type: string; text?: string }>,
  );
  const { caption, hashtags } = splitCaptionAndHashtags(raw);
  return {
    platform: args.platform,
    caption,
    hashtags,
    cta: null,
  };
}

// =============================================================
// POST handler
// =============================================================

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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

    // Ownership check — load the project so we can stash a
    // brand-snapshot on the asset row (auditability) and so the
    // engine knows whose ClientContext to load.
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
      .limit(1);
    if (!project) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Load the ClientContext. This is the single source of truth
    // for every Haiku call below — primary content generation
    // AND caption adaptation per platform share the same
    // intelligence.
    const clientContext = await loadClientContext({
      userId: user.id,
      projectId,
    });

    // Pick the "primary platform" for engine-side learning. UGC
    // / reel default to TikTok (most common UGC target). Other
    // types pick the first valid platform of the asset — that's
    // the platform whose voice fingerprint + winning patterns
    // should bias the primary content.
    const primaryAssetPlatform: Platform =
      assetType === 'ugc_video' || assetType === 'reel'
        ? valid.find((p) => p === 'tiktok') ?? valid[0]
        : valid[0];
    const primaryVoicePlatform = platformToVoicePlatform(primaryAssetPlatform);

    // ─── Step 1 — resolve baseContent. ─────────────────────────
    //
    // Three paths:
    //   (a) baseContentOverride present (UGC A/B picker case) →
    //       trust it verbatim. Save the optional bundle override
    //       for structuredContent persistence below.
    //   (b) UGC/Reel without override → run engine + UGC schema,
    //       extract spoken text + bundle.
    //   (c) carousel / photo / long_form_text → run engine, plain
    //       prose.
    let baseContent: string;
    let ugcBundle: UGCBundle | null = null;
    const isVideoAsset = assetType === 'ugc_video' || assetType === 'reel';
    const honorOverride =
      typeof body.baseContentOverride === 'string' &&
      body.baseContentOverride.trim().length > 0 &&
      isVideoAsset;

    if (honorOverride) {
      baseContent = body.baseContentOverride!.trim();
      ugcBundle = body.baseUgcBundleOverride ?? null;
    } else {
      try {
        const result = await generatePrimaryContent({
          assetType,
          prompt,
          primaryPlatform: primaryVoicePlatform,
          clientContext,
        });
        baseContent = result.spokenOrBaseText;
        ugcBundle = result.ugcBundle;
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
    }
    if (!baseContent) {
      return NextResponse.json(
        { error: 'AI returned empty base content' },
        { status: 502 },
      );
    }

    // ─── Step 2 — insert the asset row. ────────────────────────
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

    // ─── Step 3 — adapt captions per platform in parallel. ─────
    //
    // Each platform runs adaptCaptionForPlatform which builds an
    // engine-aware adaptation prompt (PROMPT_COMPOSITION_RULES +
    // HUMANIZE_RULES + dynamic CLIENT CONTEXT block +
    // PLATFORM_TONE_INSTRUCTIONS + reel-specific overrides).
    const settled = await Promise.allSettled(
      valid.map((p) =>
        adaptCaptionForPlatform({
          platform: p,
          baseContent,
          assetType,
          clientContext,
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
      return NextResponse.json(
        {
          error: 'All caption adaptations failed',
          partialErrors,
        },
        { status: 502 },
      );
    }

    // ─── Step 4 — persist one generated_posts row per platform.
    //
    // Map AssetType → legacy contentType so the existing library
    // / calendar / publisher chrome (which keys off contentType)
    // still works.
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

    // For carousels we ALSO parse the baseContent into the
    // slides shape the slide-gen endpoint consumes. Without
    // this, the auto-fire below finds zero slides and renders
    // nothing.
    const parsedSlides =
      assetType === 'carousel' ? parseCarouselSlides(baseContent) : null;
    const structuredContentForPosts: Record<string, unknown> = {
      assetType,
      baseContent,
    };
    if (parsedSlides) {
      structuredContentForPosts.slides = parsedSlides;
    }
    if (ugcBundle) {
      // Persist the UGCBundle on each post so future surfaces
      // (overlay rendering, hashtag display, caption fallback)
      // can read it without re-running the engine. Same bundle
      // duplicated across N posts is intentional — it's small
      // and the alternative (a JOIN through asset_id every
      // render) costs more.
      structuredContentForPosts.ugcBundle = ugcBundle;
    }

    const inserted = await db
      .insert(generatedPosts)
      .values(
        captionResults.map((c) => ({
          projectId,
          assetId: asset.id,
          platform: c.platform,
          content: c.caption,
          caption: c.caption,
          hashtags: c.hashtags,
          ctaText: c.cta,
          prompt,
          contentType: legacyContentType,
          structuredContent: structuredContentForPosts,
          variantLabel:
            body.variantLabel === 'A' || body.variantLabel === 'B'
              ? body.variantLabel
              : null,
          variantGroupId: body.variantGroupId ?? null,
          isReel: assetType === 'reel' || assetType === 'ugc_video',
          videoUrl: null,
          imageUrl: null,
        })),
      )
      .returning({
        id: generatedPosts.id,
        platform: generatedPosts.platform,
        caption: generatedPosts.caption,
      });

    // ─── Step 5 — queue HeyGen for video assets. ───────────────
    //
    // One job tied to the first inserted draft. When the cron
    // (or the user-driven endpoint) fires HeyGen and the webhook
    // returns, the resulting videoUrl is mirrored onto the
    // content_asset (PR Sprint 7.26) so every platform variant
    // in the group surfaces the same render via the library
    // leftJoin.
    if (isVideoAsset && inserted.length > 0) {
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
        // Non-fatal — founder can re-queue from the library
        // detail card.
        console.warn(
          '[generate-asset] heygen queue insert failed (non-fatal):',
          err instanceof Error ? err.message : err,
        );
      }
    }

    // ─── Step 6 — fire-and-forget photo image generation. ──────
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

    // ─── Step 7 — fire-and-forget carousel slide generation. ───
    if (assetType === 'carousel' && inserted.length > 0) {
      const first = inserted[0];
      const origin = new URL(request.url).origin;
      void fetch(`${origin}/api/marketing/posts/${first.id}/generate-slides`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: request.headers.get('cookie') ?? '',
        },
        body: JSON.stringify({ painPoint: prompt }),
      }).catch(() => {
        /* fire-and-forget — visible in Library on next refresh */
      });
    }

    // PR Sprint B-finish — drop the analytics insights cache so
    // the founder's next /analytics visit reflects the new asset.
    // Fire-and-forget; failure is silently swallowed inside the
    // helper.
    void invalidateAnalyticsInsightsCache(user.id);

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
      // Surface that the bundle is available so the UI can later
      // render overlays / hashtags from it.
      hasUgcBundle: ugcBundle !== null,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : 'Generation failed',
      },
      { status: 500 },
    );
  }
}
