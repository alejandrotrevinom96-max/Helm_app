// PR Sprint 7.19 — visual prompt builder port.
//
// 1:1 translation of
// Helm SEO/helm-adaptive-voice-engine/visual_prompt_builder.py.
//
// Composes a VisualPromptIR from input signals (pain_point,
// caption, BrandBible, platform, content_type). Calls
// visual-subject-extractor for the SubjectBlock and pulls the
// other 4 blocks from BrandBible + PLATFORM_VISUAL_LANGUAGE.
//
// Entry point for the visual generation pipeline. Once the IR is
// built, hand it to a renderer (visual-renderer-flux.renderForFlux)
// to produce the final string for the image model.

import { createHash } from 'node:crypto';
import {
  BrandBlockSchema,
  DEFAULT_NEGATIVE_TERMS,
  NegativeBlockSchema,
  PlatformBlockSchema,
  StyleBlockSchema,
  VisualPromptIRSchema,
  VisualPromptMetadataSchema,
  type CameraType,
  type DepthOfField,
  type LightingType,
  type StyleBlock,
  type StyleType,
  type VisualPromptIR,
} from './visual-schema';
import {
  formatVisualLanguageNotes,
  getVisualLanguage,
} from './platform-visual-language';
import {
  extractSubjectBlock,
  type ExtractSubjectBlockInput,
} from './visual-subject-extractor';

// ============================================================
// BrandBible adapter
//
// The builder doesn't know about ClientContext. It takes a loose
// dict-like brand_bible to stay decoupled from the learning
// engine. Calling code is responsible for extracting the right
// slice from the full BrandBible (lib/types/brand.ts).
// ============================================================

export interface BrandBibleVisualSlice {
  /** Brand archetype, e.g. 'rebel', 'sage', 'creator'. */
  archetype: string;
  /** From BrandBible.visual.photographyMood. */
  photography_mood: string;
  /**
   * "photography" | "illustration" | "screenshot" | "mixed_media" |
   * "abstract" | "3d_render". Maps to StyleType; falls back to
   * 'photography' if unrecognized.
   */
  image_style: string;
  /** Hex codes or color names. Up to 5. */
  colors?: string[];
  voice_descriptor?: string | null;
}

// ============================================================
// Style defaults by brand archetype
//
// Archetype is the strongest single brand signal we have for
// visual identity. Mapping each archetype to its natural camera/
// lighting/DOF combination produces dramatically more consistent
// output than relying on content_type defaults alone.
//
// Lookup precedence: archetype defaults override content_type
// defaults. If archetype is not recognized, fall back to
// content_type defaults.
// ============================================================

interface StyleDefaults {
  camera: CameraType;
  lighting: LightingType;
  depth_of_field: DepthOfField;
}

export const STYLE_DEFAULTS_BY_ARCHETYPE: Readonly<
  Record<string, StyleDefaults>
> = {
  rebel: {
    camera: 'dutch angle',
    lighting: 'harsh dramatic shadows',
    depth_of_field: 'shallow depth of field with bokeh background',
  },
  outlaw: {
    camera: 'dutch angle',
    lighting: 'low-key moody lighting',
    depth_of_field: 'shallow depth of field with bokeh background',
  },
  sage: {
    camera: 'medium shot',
    lighting: 'soft window light',
    depth_of_field: 'deep focus, everything sharp',
  },
  creator: {
    camera: 'close-up',
    lighting: 'golden hour warm light',
    depth_of_field: 'shallow depth of field with bokeh background',
  },
  hero: {
    camera: 'wide shot',
    lighting: 'backlit silhouette',
    depth_of_field: 'medium depth of field',
  },
  caregiver: {
    camera: 'close-up',
    lighting: 'natural soft light',
    depth_of_field: 'shallow depth of field with bokeh background',
  },
  everyman: {
    camera: 'documentary handheld',
    lighting: 'natural soft light',
    depth_of_field: 'medium depth of field',
  },
  ruler: {
    camera: '85mm portrait lens',
    lighting: 'studio lighting with key + fill',
    depth_of_field: 'shallow depth of field with bokeh background',
  },
  magician: {
    camera: 'close-up',
    lighting: 'low-key moody lighting',
    depth_of_field: 'shallow depth of field with bokeh background',
  },
  innocent: {
    camera: 'medium shot',
    lighting: 'natural soft light',
    depth_of_field: 'medium depth of field',
  },
  explorer: {
    camera: 'wide shot',
    lighting: 'golden hour warm light',
    depth_of_field: 'deep focus, everything sharp',
  },
  lover: {
    camera: 'close-up',
    lighting: 'golden hour warm light',
    depth_of_field: 'shallow depth of field with bokeh background',
  },
  jester: {
    camera: 'medium shot',
    lighting: 'natural soft light',
    depth_of_field: 'medium depth of field',
  },
};

// Content-type defaults (fallback when archetype is unknown).
const CONTENT_TYPE_DEFAULTS: Readonly<Record<string, StyleDefaults>> = {
  photo: {
    camera: 'medium shot',
    lighting: 'natural soft light',
    depth_of_field: 'shallow depth of field with bokeh background',
  },
  carousel: {
    camera: 'flat lay top-down',
    lighting: 'studio lighting with key + fill',
    depth_of_field: 'deep focus, everything sharp',
  },
  ugc: {
    camera: 'medium shot',
    lighting: 'soft window light',
    depth_of_field: 'medium depth of field',
  },
};

// ============================================================
// Dynamic negative terms by platform and style
//
// Layered on top of DEFAULT_NEGATIVE_TERMS to catch failure modes
// specific to each platform's visual culture and each style
// type's typical confusions.
// ============================================================

export const NEGATIVE_BY_PLATFORM: Readonly<Record<string, string[]>> = {
  linkedin: [
    'neon colors',
    'casual lifestyle imagery',
    'selfie aesthetic',
  ],
  tiktok: [
    'muted desaturated palette',
    'static composition',
    'professional studio look',
  ],
  instagram: ['corporate stock photography', 'boring composition'],
  x: ['overly polished imagery', 'studio lighting'],
  threads: ['magazine-style production', 'overly polished imagery'],
  facebook: ['edgy harsh aesthetic', 'low-key dark imagery'],
};

export const NEGATIVE_BY_STYLE: Readonly<Record<StyleType, string[]>> = {
  photography: [
    'cartoonish illustration',
    'anime style',
    'flat 2D drawing',
  ],
  illustration: ['photorealistic 3D render', 'uncanny valley faces'],
  screenshot: ['artistic interpretation', 'stylized rendering'],
  mixed_media: [],
  abstract: ['literal subject', 'documentary realism'],
  '3d_render': ['flat illustration', '2D drawing'],
};

/**
 * Combine default negative terms with platform-specific and
 * style-specific additions. Deduplicates while preserving order
 * so the most generic anti-patterns appear first.
 */
export function buildNegativeTerms(
  platform: string,
  styleType: StyleType,
  base?: readonly string[],
): string[] {
  const combined: string[] = base
    ? [...base]
    : [...DEFAULT_NEGATIVE_TERMS];
  combined.push(...(NEGATIVE_BY_PLATFORM[platform.toLowerCase()] ?? []));
  combined.push(...(NEGATIVE_BY_STYLE[styleType] ?? []));

  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const term of combined) {
    const lower = term.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      deduped.push(term);
    }
  }
  return deduped;
}

// ============================================================
// Public API
// ============================================================

export interface BuildVisualPromptIRInput {
  pain_point: string;
  caption: string;
  brand_bible: BrandBibleVisualSlice;
  platform: string;
  content_type: string;
  subject_extractor_model?: string;
  /** Forwarded to extractSubjectBlock (default 2). */
  max_retries?: number;
}

/**
 * Build a complete VisualPromptIR by composing all 5 blocks.
 *
 * Pipeline:
 *   1. Call mini-LLM to extract SubjectBlock from pain_point + caption
 *   2. Build StyleBlock from BrandBible.image_style + archetype defaults
 *   3. Build BrandBlock from BrandBible
 *   4. Build PlatformBlock from platform + content_type lookup
 *   5. Use default NegativeBlock (or override per client in future)
 *
 * Throws SubjectExtractionError if the mini-LLM call fails after
 * retries. Callers should catch and fall back to a generic
 * subject block to keep the user-facing flow resilient.
 */
export async function buildVisualPromptIR(
  input: BuildVisualPromptIRInput,
): Promise<VisualPromptIR> {
  const platform = input.platform.toLowerCase();
  const contentType = input.content_type.toLowerCase();

  // 1. Extract SubjectBlock via mini-LLM (timed for telemetry).
  const startMs = Date.now();
  const extractorInput: ExtractSubjectBlockInput = {
    pain_point: input.pain_point,
    caption: input.caption,
    brand_archetype: input.brand_bible.archetype,
    brand_mood: input.brand_bible.photography_mood,
    model: input.subject_extractor_model,
    max_retries: input.max_retries ?? 2,
  };
  const subject = await extractSubjectBlock(extractorInput);
  const extractionLatencyMs = Date.now() - startMs;

  // 2. StyleBlock — derived from brand_bible + content_type
  //    defaults, with archetype defaults taking precedence.
  const style = buildStyleBlock(input.brand_bible, contentType);

  // 3. BrandBlock — direct adapter.
  const brand = BrandBlockSchema.parse({
    archetype: input.brand_bible.archetype,
    mood: input.brand_bible.photography_mood,
    color_palette: input.brand_bible.colors ?? [],
    voice_descriptor: input.brand_bible.voice_descriptor ?? null,
  });

  // 4. PlatformBlock — lookup from PLATFORM_VISUAL_LANGUAGE.
  const visualLangSpec = getVisualLanguage(platform, contentType);
  const platformBlock = PlatformBlockSchema.parse({
    platform,
    content_type: contentType,
    aspect_ratio: visualLangSpec.aspect_ratio,
    visual_language_notes: formatVisualLanguageNotes(visualLangSpec),
  });

  // 5. NegativeBlock — defaults + platform/style overlays.
  const negative = NegativeBlockSchema.parse({
    avoid_terms: buildNegativeTerms(platform, style.style_type),
  });

  // Metadata for audit + future cache layer.
  const cacheKey = generateCacheKey({
    pain_point: input.pain_point,
    caption: input.caption,
    brand_archetype: input.brand_bible.archetype,
    brand_mood: input.brand_bible.photography_mood,
    platform,
    content_type: contentType,
  });
  const metadata = VisualPromptMetadataSchema.parse({
    pain_point_excerpt: input.pain_point.slice(0, 300),
    caption_excerpt: input.caption.slice(0, 300),
    target_platform: platform,
    target_content_type: contentType,
    subject_extractor_model:
      input.subject_extractor_model ?? 'claude-haiku-4-5',
    subject_extractor_latency_ms: extractionLatencyMs,
    cache_key: cacheKey,
  });

  return VisualPromptIRSchema.parse({
    subject,
    style,
    brand,
    platform: platformBlock,
    negative,
    metadata,
  });
}

// ============================================================
// Internal helpers
// ============================================================

/**
 * Construct the StyleBlock from BrandBible + content-type
 * defaults. Lookup precedence:
 *   1. STYLE_DEFAULTS_BY_ARCHETYPE if archetype is recognized
 *   2. CONTENT_TYPE_DEFAULTS keyed by content_type
 *   3. CONTENT_TYPE_DEFAULTS.photo as last resort
 */
function buildStyleBlock(
  brand: BrandBibleVisualSlice,
  contentType: string,
): StyleBlock {
  // Normalize image_style to a known StyleType, default photography.
  const styleTypeInput = brand.image_style.toLowerCase();
  const KNOWN_STYLE_TYPES: ReadonlyArray<StyleType> = [
    'photography',
    'illustration',
    'screenshot',
    'mixed_media',
    'abstract',
    '3d_render',
  ];
  const styleType: StyleType = (KNOWN_STYLE_TYPES as readonly string[]).includes(
    styleTypeInput,
  )
    ? (styleTypeInput as StyleType)
    : 'photography';

  const archetypeKey = brand.archetype.trim().toLowerCase();
  const defaults =
    STYLE_DEFAULTS_BY_ARCHETYPE[archetypeKey] ??
    CONTENT_TYPE_DEFAULTS[contentType] ??
    CONTENT_TYPE_DEFAULTS.photo;

  return StyleBlockSchema.parse({
    style_type: styleType,
    camera: defaults.camera,
    lighting: defaults.lighting,
    depth_of_field: defaults.depth_of_field,
    additional_style_notes: null,
  });
}

/**
 * Stable hash for caching SubjectBlock outputs (v1.5 cache
 * layer). Truncated SHA-256 (16 chars) is enough collision
 * avoidance at expected scale. The cache_key is stored in
 * VisualPromptMetadata so the future cache layer can look up
 * without recomputing.
 */
export function generateCacheKey(input: {
  pain_point: string;
  caption: string;
  brand_archetype: string;
  brand_mood: string;
  platform: string;
  content_type: string;
}): string {
  const combined = [
    input.pain_point.trim(),
    input.caption.trim(),
    input.brand_archetype.trim().toLowerCase(),
    input.brand_mood.trim().toLowerCase(),
    input.platform.toLowerCase(),
    input.content_type.toLowerCase(),
  ].join('||');
  return createHash('sha256').update(combined, 'utf8').digest('hex').slice(0, 16);
}
