import { fal } from '@fal-ai/client';
import type { BrandBible, ImageStyle } from '@/lib/types/brand';
import { logger } from '@/lib/observability/logger';
import { buildVisualPromptIR } from '@/lib/voice-engine/visuals/visual-prompt-builder';
import {
  getImageSizeForFal,
  renderForFlux,
} from '@/lib/voice-engine/visuals/visual-renderer-flux';
import { validateVisualPromptIR } from '@/lib/voice-engine/visuals/visual-validator';
import { SubjectExtractionError } from '@/lib/voice-engine/visuals/visual-subject-extractor';

// fal.ai client picks up FAL_API_KEY automatically when present in env, but
// we config explicitly so a missing key shows up as a clearer error than
// "no auth configured" deep inside the SDK.
if (process.env.FAL_API_KEY) {
  fal.config({ credentials: process.env.FAL_API_KEY });
}

export type AspectRatio = 'square' | 'portrait' | 'landscape';

export interface VisualPrompt {
  // PR #88 — Sprint 7.12: 'tiktok' joined for Single Photo and
  // Carousel content types. The platform name flows into prompt
  // scaffolding + default aspect ratio (TikTok → portrait 9:16).
  platform:
    | 'instagram'
    | 'facebook'
    | 'linkedin'
    | 'threads'
    | 'reddit'
    | 'tiktok';
  postContent: string;
  brandBible: BrandBible | null;
  style?: ImageStyle;
  aspectRatio?: AspectRatio;
  // Sprint 7.19 Round 1 — optional inputs that unlock the IR
  // pipeline path. When both `painPoint` and `contentType` are
  // present AND the brand bible has the minimum fields AND the
  // ENABLE_VISUAL_IR_PIPELINE flag is on, generateVisual()
  // routes through buildVisualPromptIR + renderForFlux instead
  // of the legacy prompt builder.
  painPoint?: string;
  contentType?: 'photo' | 'carousel' | 'ugc';
}

export interface VisualResult {
  url: string;
  provider: 'fal';
  prompt: string;
  costEstimate: number;
  width: number;
  height: number;
}

// fal.ai accepts named image_size strings; we map our aspect ratio to the
// closest one + record the dimensions for downstream UI sizing. The literal
// type annotation matches the SDK's accepted enum.
type FalImageSize =
  | 'square'
  | 'square_hd'
  | 'portrait_4_3'
  | 'portrait_16_9'
  | 'landscape_4_3'
  | 'landscape_16_9';

const ASPECT_DIMENSIONS: Record<
  AspectRatio,
  { width: number; height: number; image_size: FalImageSize }
> = {
  square: { width: 1024, height: 1024, image_size: 'square_hd' },
  portrait: { width: 832, height: 1216, image_size: 'portrait_4_3' },
  landscape: { width: 1216, height: 832, image_size: 'landscape_4_3' },
};

const PLATFORM_DEFAULT_ASPECT: Record<
  VisualPrompt['platform'],
  AspectRatio
> = {
  instagram: 'square',
  facebook: 'landscape',
  linkedin: 'landscape',
  threads: 'square',
  // Reddit posts most often render in feed at landscape; old.reddit
  // and image-heavy subreddits both handle 1.91:1 well.
  reddit: 'landscape',
  // PR #88 — Sprint 7.12: TikTok's native canvas is 9:16 vertical.
  // Even photo posts render full-bleed portrait, so default to
  // 'portrait' (832×1216) rather than the Instagram 'square'
  // default. Carousel slides inherit per-slide via the
  // generate-slides endpoint.
  tiktok: 'portrait',
};

/** Feature flag — when "false", force the legacy prompt builder
 * even when the IR pipeline inputs are present. Default is ON
 * (PR Sprint 7.24 — Prompt 2): the IR pipeline produces visibly
 * better Flux output (subject extraction, brand visual language,
 * platform aesthetics) and was just a flag-flip away from being
 * live. Set ENABLE_VISUAL_IR_PIPELINE=false to roll back.
 *
 * Note: even with the flag on, the IR path only runs when ALL of:
 *   - painPoint provided
 *   - contentType provided
 *   - brandBible non-null
 *   - platform !== 'reddit'
 * are true. Anything missing falls back to the legacy path
 * automatically (`canUseIR` in generateVisual).
 */
function irPipelineEnabled(): boolean {
  return process.env.ENABLE_VISUAL_IR_PIPELINE !== 'false';
}

/** Map the legacy 3-value aspect ratio to a fal image_size +
 * pixel dims. Kept here because the legacy path still uses it. */
function legacyDimsFor(aspectRatio: AspectRatio) {
  return ASPECT_DIMENSIONS[aspectRatio];
}

/** Build the fal-ai input pair for the IR-pipeline path. */
function falInputFromIR(ir: {
  platform: { aspect_ratio: '1:1' | '4:5' | '9:16' | '16:9' | '3:2' };
}): { image_size: FalImageSize; width: number; height: number } {
  const named = getImageSizeForFal(ir.platform.aspect_ratio);
  // getImageSizeForFal returns the same name set we accept. Map
  // back to pixel dims for the VisualResult bookkeeping.
  const dimsTable: Record<string, { width: number; height: number }> = {
    square_hd: { width: 1024, height: 1024 },
    portrait_4_3: { width: 832, height: 1216 },
    portrait_16_9: { width: 768, height: 1344 },
    landscape_16_9: { width: 1344, height: 768 },
    landscape_4_3: { width: 1216, height: 832 },
  };
  const dims = dimsTable[named] ?? { width: 1024, height: 1024 };
  return { image_size: named as FalImageSize, ...dims };
}

export async function generateVisual(
  input: VisualPrompt
): Promise<VisualResult | null> {
  if (!process.env.FAL_API_KEY) {
    logger.warn('visuals/generate', 'FAL_API_KEY not set, skipping image generation');
    return null;
  }

  // Decide which builder to use. Conditions for the new pipeline:
  //   - Feature flag is ON
  //   - We have painPoint + contentType (the new pipeline needs both)
  //   - The (platform, contentType) combo is supported by the new
  //     PLATFORM_VISUAL_LANGUAGE map (Reddit isn't, e.g.)
  //   - We have a brand bible with the minimum visual fields
  const canUseIR =
    irPipelineEnabled() &&
    !!input.painPoint &&
    !!input.contentType &&
    !!input.brandBible &&
    input.platform !== 'reddit';

  if (canUseIR) {
    const irResult = await tryIRPipelinePath(input);
    if (irResult) return irResult;
    // tryIRPipelinePath already logged the failure; we fall
    // through to the legacy builder so the user still gets an
    // image rather than a null.
    logger.warn(
      'visuals/generate',
      'IR pipeline failed, falling back to legacy buildVisualPrompt',
      { platform: input.platform, contentType: input.contentType },
    );
  }

  return runLegacyPath(input);
}

// ============================================================
// IR pipeline path (Sprint 7.19)
// ============================================================

async function tryIRPipelinePath(
  input: VisualPrompt,
): Promise<VisualResult | null> {
  const bible = input.brandBible;
  if (!bible || !input.painPoint || !input.contentType) return null;

  try {
    const ir = await buildVisualPromptIR({
      pain_point: input.painPoint,
      caption: input.postContent,
      brand_bible: {
        archetype: bible.archetype?.primary ?? 'modern',
        photography_mood: bible.visual?.photographyMood ?? 'warm and human',
        image_style: bible.visual?.imageStyle ?? 'photography',
        colors: [
          bible.visual?.colors?.primary,
          bible.visual?.colors?.secondary,
          bible.visual?.colors?.accent,
        ].filter(Boolean) as string[],
        voice_descriptor: null,
      },
      platform: input.platform,
      content_type: input.contentType,
    });

    // Soft-validation. We log failures but proceed — these are
    // hints, not hard rejects. Hard rejects already throw inside
    // buildVisualPromptIR via Zod.
    const failures = validateVisualPromptIR(ir);
    if (failures.length > 0) {
      logger.warn('visuals/generate', 'IR soft-validation failures', {
        failures,
        platform: input.platform,
        contentType: input.contentType,
      });
    }

    const prompt = renderForFlux(ir);
    const fal_input = falInputFromIR(ir);

    const result = (await fal.subscribe('fal-ai/flux-pro/v1.1', {
      input: {
        prompt,
        image_size: fal_input.image_size,
        num_images: 1,
      },
      logs: false,
    })) as {
      data?: { images?: Array<{ url: string }> };
      images?: Array<{ url: string }>;
    };
    const imageUrl =
      result?.data?.images?.[0]?.url ?? result?.images?.[0]?.url ?? null;
    if (!imageUrl) {
      logger.error('visuals/generate', 'fal.ai returned no image URL (IR path)');
      return null;
    }

    return {
      url: imageUrl,
      provider: 'fal',
      prompt,
      costEstimate: 0.055, // ~$0.05 fal + ~$0.005 Haiku subject extractor
      width: fal_input.width,
      height: fal_input.height,
    };
  } catch (e) {
    if (e instanceof SubjectExtractionError) {
      logger.warn(
        'visuals/generate',
        'SubjectBlock extraction failed after retries',
        { error: e },
      );
    } else {
      logger.error('visuals/generate', 'IR pipeline crashed', { error: e });
    }
    return null;
  }
}

// ============================================================
// Legacy path (pre-Sprint-7.19 — buildVisualPrompt)
// ============================================================

async function runLegacyPath(input: VisualPrompt): Promise<VisualResult | null> {
  const aspectRatio = input.aspectRatio ?? PLATFORM_DEFAULT_ASPECT[input.platform];
  const dims = legacyDimsFor(aspectRatio);
  const prompt = buildVisualPrompt(input);

  try {
    const result = (await fal.subscribe('fal-ai/flux-pro/v1.1', {
      input: {
        prompt,
        image_size: dims.image_size,
        num_images: 1,
      },
      logs: false,
    })) as {
      data?: { images?: Array<{ url: string }> };
      images?: Array<{ url: string }>;
    };
    const imageUrl =
      result?.data?.images?.[0]?.url ?? result?.images?.[0]?.url ?? null;
    if (!imageUrl) {
      logger.error('visuals/generate', 'fal.ai returned no image URL (legacy path)');
      return null;
    }
    return {
      url: imageUrl,
      provider: 'fal',
      prompt,
      costEstimate: 0.05,
      width: dims.width,
      height: dims.height,
    };
  } catch (e) {
    logger.error('visuals/generate', 'fal.ai generation failed (legacy path)', {
      error: e,
    });
    return null;
  }
}

/**
 * @deprecated Sprint 7.19 — replaced by the
 * lib/voice-engine/visuals/ pipeline (buildVisualPromptIR +
 * renderForFlux). The new pipeline runs a mini-LLM call that
 * translates pain_point + caption into a concrete visual
 * scene before sending to Flux, which dramatically lifts image
 * quality (no more stock-feeling output). Kept for one sprint
 * so existing call sites don't break; remove once all visual
 * generation flows route through the IR pipeline.
 *
 * Migration path:
 *   import { buildVisualPromptIR } from
 *     '@/lib/voice-engine/visuals/visual-prompt-builder';
 *   import { renderForFlux, getImageSizeForFal } from
 *     '@/lib/voice-engine/visuals/visual-renderer-flux';
 *
 *   const ir = await buildVisualPromptIR({
 *     pain_point, caption, brand_bible, platform, content_type,
 *   });
 *   const prompt = renderForFlux(ir);
 *   const image_size = getImageSizeForFal(ir.platform.aspect_ratio);
 */
export function buildVisualPrompt(input: VisualPrompt): string {
  const bible = input.brandBible;
  const colors = bible?.visual?.colors;
  const style = input.style ?? bible?.visual?.imageStyle ?? 'minimalist';
  const archetype = bible?.archetype?.primary ?? 'modern';
  const photographyMood = bible?.visual?.photographyMood;
  const aspectRatio =
    input.aspectRatio ?? PLATFORM_DEFAULT_ASPECT[input.platform];

  const postPreview = input.postContent
    .replace(/[#@]\w+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);

  const parts = [
    `${style} image for ${input.platform} social post.`,
    `Visual concept based on: "${postPreview}"`,
    `Brand archetype: ${archetype}`,
  ];

  if (photographyMood) parts.push(`Mood: ${photographyMood}`);

  if (colors?.primary) {
    const colorList = [colors.primary, colors.secondary, colors.accent]
      .filter(Boolean)
      .slice(0, 3)
      .join(', ');
    parts.push(`Color palette: ${colorList}`);
  }

  parts.push(
    'NO TEXT in the image (text will be overlaid separately).',
    'Modern composition, professional quality, social-media-ready.',
    `${aspectRatio === 'portrait' ? '4:5 portrait' : aspectRatio === 'landscape' ? '16:9 landscape' : '1:1 square'} aspect ratio.`
  );

  return parts.join(' ');
}
