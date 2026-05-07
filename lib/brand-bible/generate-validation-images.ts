// PR #27 — Sprint 4: Image validation loop.
//
// Generates one image per context (currently 12 — see image-contexts.ts)
// using fal.ai Flux Pro v1.1, the same model lib/visuals/generate.ts
// uses. Sequential (not parallel) so a single batch doesn't burst
// past fal.ai's rate limits — empirically a 12-image batch finishes
// in ~60-90s.
//
// Inputs come from the canonical BrandBible (projects.brandContext),
// not the auto-generated intermediate shape. We translate voice 0-10
// into descriptive adjectives for the prompt — Flux responds to
// vibes ("playful, bold") much better than numbers ("voice 7/10
// playful").
import { fal } from '@fal-ai/client';
import type { BrandBible } from '@/lib/types/brand';
import { IMAGE_CONTEXTS, type ImageContext } from './image-contexts';

// Same defensive config as lib/visuals/generate.ts — keeps the error
// path clean when FAL_API_KEY is missing.
if (process.env.FAL_API_KEY) {
  fal.config({ credentials: process.env.FAL_API_KEY });
}

// fal.ai Flux Pro v1.1 pricing as of 2026-01. We snapshot it here so
// the cost saved per row is auditable; if fal changes pricing the
// caller can override.
const FLUX_PRO_COST_PER_IMAGE = 0.05;

type FalImageSize =
  | 'square_hd'
  | 'portrait_4_3'
  | 'portrait_16_9'
  | 'landscape_4_3'
  | 'landscape_16_9';

const ASPECT_TO_FAL: Record<ImageContext['dimensions'], FalImageSize> = {
  '1:1': 'square_hd',
  '16:9': 'landscape_16_9',
  '9:16': 'portrait_16_9',
  // Closest fal preset to 4:5 — exact 4:5 isn't a Flux preset.
  '4:5': 'portrait_4_3',
};

// Translate voice scales (BrandBible.voice is 0-10, where 5 = neutral)
// into prompt-friendly adjectives. We collapse the "balanced" middle
// band so prompts don't say "balanced casual balanced playful balanced
// reserved balanced traditional" — that's noise.
function describeVoice(voice: BrandBible['voice']): string {
  const out: string[] = [];
  // 0=casual ↔ 10=formal
  if (voice.formal <= 3) out.push('casual');
  else if (voice.formal >= 7) out.push('formal');
  // 0=playful ↔ 10=serious
  if (voice.serious <= 3) out.push('playful');
  else if (voice.serious >= 7) out.push('serious');
  // 0=reserved ↔ 10=bold
  if (voice.bold <= 3) out.push('understated and refined');
  else if (voice.bold >= 7) out.push('bold and confident');
  // 0=traditional ↔ 10=innovative
  if (voice.innovative <= 3) out.push('classic and timeless');
  else if (voice.innovative >= 7) out.push('modern and innovative');
  return out.length > 0 ? out.join(', ') : 'balanced';
}

export function buildPromptForContext(
  context: ImageContext,
  bible: BrandBible,
  projectName: string
): string {
  const voiceDesc = describeVoice(bible.voice);
  const archetype = bible.archetype?.primary ?? null;
  const pillarNames = (bible.pillars ?? []).map((p) => p.name).slice(0, 4);
  const primaryColor = bible.visual?.colors?.primary ?? null;
  const audienceDesc = bible.audience?.primary?.description ?? '';

  // Color hint only when set; otherwise we let Flux pick a palette
  // consistent with the voice descriptors.
  const colorHint = primaryColor ? ` with hints of ${primaryColor}` : '';
  const archetypeHint = archetype ? ` ${archetype} archetype` : '';
  const audienceHint = audienceDesc
    ? `\nAudience: ${audienceDesc}.`
    : '';
  const pillarsHint =
    pillarNames.length > 0
      ? `\nKey themes: ${pillarNames.join(', ')}.`
      : '';

  const prompt = `${context.promptStyle}, ${voiceDesc} mood${colorHint}.

Brand context: ${projectName}${archetypeHint}.${audienceHint}${pillarsHint}

High quality, professional, brand-aligned. No text in image. No logos. No watermarks.`;

  return prompt.replace(/\n{3,}/g, '\n\n').trim();
}

export interface GeneratedValidationImage {
  context: ImageContext;
  url: string;
  prompt: string;
  cost: number;
}

export async function generateValidationImage(
  context: ImageContext,
  bible: BrandBible,
  projectName: string
): Promise<GeneratedValidationImage> {
  const prompt = buildPromptForContext(context, bible, projectName);

  // flux-pro v1.1's TS input type doesn't include enable_safety_checker
  // (the API still accepts it server-side, but the SDK trimmed it from
  // the typed input). Stick to the typed shape — Flux Pro has its own
  // built-in safety filter.
  const result = await fal.subscribe('fal-ai/flux-pro/v1.1', {
    input: {
      prompt,
      image_size: ASPECT_TO_FAL[context.dimensions],
      num_images: 1,
    },
  });

  const data = result.data as {
    images?: Array<{ url?: string }>;
  };
  const url = data.images?.[0]?.url;
  if (!url) {
    throw new Error('fal.ai returned no image URL');
  }

  return {
    context,
    url,
    prompt,
    cost: FLUX_PRO_COST_PER_IMAGE,
  };
}

// PR #28 — Sprint 4.1.
//
// Parallel-chunked batch generation. Pre-PR-28 this loop was strictly
// sequential and a 12-image batch took 60-120s, blowing past Vercel's
// 60s serverless ceiling. Sequential ate the whole budget on rate-
// limit-friendly safety; in practice fal.ai handles 4 concurrent
// requests per account without throttling.
//
// Chunked approach:
//   - 12 contexts split into chunks of CHUNK_SIZE (4)
//   - Within a chunk: Promise.all → 4 in parallel
//   - Between chunks: sequential await
//   - Total: 3 chunks × ~6-10s ≈ 18-30s wall time
//
// Why chunks instead of pure Promise.all over all 12:
//   - 12 simultaneous requests trip fal.ai per-account rate limits
//   - One bad surge fails 12 instead of 4 (worse partial outcome)
//   - Chunks let the next group "see" the earlier group's failure
//     pattern via the persistent fal client state
//
// Per-image failure semantics unchanged: one bad context returns null
// from the worker, the rest of the batch proceeds. Callers filter
// by checking the array length vs. IMAGE_CONTEXTS.length.
const CHUNK_SIZE = 4;

export async function generateValidationBatch(
  bible: BrandBible,
  projectName: string,
  onProgress?: (completed: number, total: number) => void
): Promise<GeneratedValidationImage[]> {
  const total = IMAGE_CONTEXTS.length;
  const out: GeneratedValidationImage[] = [];
  let completed = 0;

  for (let i = 0; i < total; i += CHUNK_SIZE) {
    const chunk = IMAGE_CONTEXTS.slice(i, i + CHUNK_SIZE);
    const chunkResults = await Promise.all(
      chunk.map(async (ctx) => {
        try {
          const generated = await generateValidationImage(
            ctx,
            bible,
            projectName
          );
          return generated;
        } catch (err) {
          console.error(
            `[validation-batch] context "${ctx.id}" failed`,
            err instanceof Error ? err.message : err
          );
          return null;
        } finally {
          completed += 1;
          onProgress?.(completed, total);
        }
      })
    );
    for (const r of chunkResults) {
      if (r) out.push(r);
    }
  }

  return out;
}
