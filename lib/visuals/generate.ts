import { fal } from '@fal-ai/client';
import type { BrandBible, ImageStyle } from '@/lib/types/brand';

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

export async function generateVisual(
  input: VisualPrompt
): Promise<VisualResult | null> {
  if (!process.env.FAL_API_KEY) {
    console.warn('[visuals] FAL_API_KEY not set, skipping image generation');
    return null;
  }

  const aspectRatio = input.aspectRatio ?? PLATFORM_DEFAULT_ASPECT[input.platform];
  const dims = ASPECT_DIMENSIONS[aspectRatio];
  const prompt = buildVisualPrompt(input);

  try {
    // Flux Pro v1.1 input is more constrained than older Flux endpoints
    // (no num_inference_steps); the SDK enforces the schema at compile time.
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

    // SDK shape varies by version — accept both `result.data.images` and
    // `result.images`. Either way, take the first image URL.
    const imageUrl =
      result?.data?.images?.[0]?.url ?? result?.images?.[0]?.url ?? null;
    if (!imageUrl) {
      console.error('[visuals] fal.ai returned no image URL');
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
    console.error(
      '[visuals] fal.ai generation failed:',
      e instanceof Error ? e.message : String(e)
    );
    return null;
  }
}

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
