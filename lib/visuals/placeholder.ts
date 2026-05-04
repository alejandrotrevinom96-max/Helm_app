import type { BrandBible, ImageStyle } from '@/lib/types/brand';

export interface VisualPrompt {
  platform: string;
  postContent: string;
  brandBible: BrandBible | null;
  style?: ImageStyle;
}

export interface VisualResult {
  url: string | null;
  provider: 'fal' | 'replicate' | 'placeholder';
  prompt: string;
  costEstimate: number;
}

// Stub for the future image-gen pipeline. Returns null until FAL_API_KEY is
// configured (planned for PR #12). Callers should always handle null and
// fall back to text-only posts.
export async function generateVisual(
  input: VisualPrompt
): Promise<VisualResult | null> {
  if (!process.env.FAL_API_KEY) {
    return null;
  }
  // TODO(PR #12): integrate fal.ai SDXL pipeline here
  void input;
  return null;
}

// Build a text prompt for the eventual image generator. Pulled out of the
// route so we can iterate on the brand-aware phrasing without touching the
// transport layer.
export function buildVisualPrompt(input: VisualPrompt): string {
  const bible = input.brandBible;
  const colors = bible?.visual?.colors;
  const style = input.style || bible?.visual?.imageStyle || 'minimalist';

  return `${style} image for social post on ${input.platform}.

Brand: ${bible?.identity?.name ?? 'unknown'}
Archetype: ${bible?.archetype?.primary ?? 'unknown'}
Mood: ${bible?.visual?.photographyMood ?? 'neutral'}
Color palette: ${colors?.primary ?? ''} ${colors?.secondary ?? ''} ${colors?.accent ?? ''}

Post content (for context, don't include text in image):
${input.postContent.slice(0, 200)}

Style: ${style}, no text overlay, modern composition.`;
}
