// PR Sprint 7.19 — Flux renderer port.
//
// 1:1 translation of
// Helm SEO/helm-adaptive-voice-engine/visual_renderer_flux.py.
//
// Renders a VisualPromptIR to a Flux-compatible prompt string
// for fal.ai. Flux prompts work best as comma-separated
// descriptive phrases, leading with the most important elements
// (subject + style) and ending with technical specs (aspect
// ratio, negatives).
//
// Other renderers (Midjourney, SDXL, Imagen) would live in
// sibling files. The IR is the same; only the renderer changes.

import type {
  AspectRatio,
  CameraType,
  DepthOfField,
  LightingType,
  StyleType,
  VisualPromptIR,
} from './visual-schema';

// ============================================================
// Style lead by StyleType
//
// The opening phrase that tells Flux what kind of image to make.
// Arguably the highest-impact line in the entire prompt.
// ============================================================

const STYLE_LEAD: Readonly<Record<StyleType, string>> = {
  photography: 'Professional photograph',
  illustration: 'Editorial illustration',
  screenshot: 'Realistic screen capture',
  mixed_media: 'Mixed-media composition',
  abstract: 'Abstract visual composition',
  '3d_render': 'Cinematic 3D render',
};

// ============================================================
// Public API
// ============================================================

export interface RenderForFluxOptions {
  /**
   * EXPERIMENTAL. If true, wraps the main_subject in
   * weighted-attention syntax: (subject:1.3). Some Flux variants
   * (Pro, Dev) respect this; Schnell may not. A/B test before
   * promoting to default. Off by default.
   */
  boost_subject?: boolean;
}

/**
 * Convert a VisualPromptIR to a Flux/fal.ai prompt string.
 *
 * Output structure:
 *   [STYLE_LEAD] of [SUBJECT.main_subject], in [SUBJECT.setting].
 *   [SUBJECT.composition]. Mood: [SUBJECT.mood_descriptor].
 *   [Optional: visual metaphor].
 *   Style: [camera], [lighting], [depth_of_field].
 *   Brand: [archetype] archetype, [mood] mood, color palette of
 *   [colors].
 *   Platform context: [platform_visual_language_notes].
 *   Aspect ratio: [aspect_ratio].
 *   Avoid: [negative terms].
 */
export function renderForFlux(
  ir: VisualPromptIR,
  options: RenderForFluxOptions = {},
): string {
  const { boost_subject = false } = options;
  const parts: string[] = [];

  // Lead: STYLE + SUBJECT (optionally weight-boosted).
  const styleLead = STYLE_LEAD[ir.style.style_type] ?? 'Professional photograph';
  let subjectText = ir.subject.main_subject;
  if (boost_subject) {
    subjectText = `(${subjectText}:1.3)`;
  }
  parts.push(`${styleLead} of ${subjectText}`);

  // Setting.
  parts.push(`in ${ir.subject.setting}`);

  // Composition.
  parts.push(ir.subject.composition);

  // Mood.
  parts.push(`mood: ${ir.subject.mood_descriptor}`);

  // Visual metaphor (optional).
  if (ir.subject.visual_metaphor) {
    parts.push(`visual metaphor: ${ir.subject.visual_metaphor}`);
  }

  // Style technicals.
  const styleTechnicals: string[] = [];
  if (ir.style.camera) styleTechnicals.push(cameraPhrase(ir.style.camera));
  if (ir.style.lighting) styleTechnicals.push(lightingPhrase(ir.style.lighting));
  if (ir.style.depth_of_field)
    styleTechnicals.push(dofPhrase(ir.style.depth_of_field));
  if (ir.style.additional_style_notes)
    styleTechnicals.push(ir.style.additional_style_notes);
  if (styleTechnicals.length > 0) {
    parts.push(`style: ${styleTechnicals.join(', ')}`);
  }

  // Brand.
  const brandParts: string[] = [
    `${ir.brand.archetype} brand archetype`,
    `${ir.brand.mood} mood`,
  ];
  if (ir.brand.color_palette.length > 0) {
    brandParts.push(`color palette of ${ir.brand.color_palette.join(', ')}`);
  }
  parts.push(`brand: ${brandParts.join(', ')}`);

  // Platform context.
  parts.push(ir.platform.visual_language_notes);

  // Aspect ratio (Flux respects this in prompt and as a separate
  // API param — we send both).
  parts.push(`${aspectPhrase(ir.platform.aspect_ratio)} aspect ratio`);

  // Negative (Flux accepts negatives in prose form).
  if (ir.negative.avoid_terms.length > 0) {
    parts.push(`avoid: ${ir.negative.avoid_terms.join(', ')}`);
  }

  return parts.join('. ') + '.';
}

/**
 * Some Flux variants (and Flux-adjacent models) accept a
 * separate `negative_prompt` parameter. Returns the negative
 * terms as a standalone comma-separated string.
 */
export function renderNegativePrompt(ir: VisualPromptIR): string {
  return ir.negative.avoid_terms.join(', ');
}

/**
 * Map an AspectRatio to fal.ai's `image_size` parameter value.
 * fal.ai accepts named sizes ('square_hd', 'portrait_4_3', etc.)
 * or explicit {width, height}. We return the named string for
 * simplicity; swap to dict form if you need custom resolutions.
 */
export function getImageSizeForFal(aspect: AspectRatio): string {
  const mapping: Record<AspectRatio, string> = {
    '1:1': 'square_hd',
    '4:5': 'portrait_4_3', // Closest named match
    '9:16': 'portrait_16_9',
    '16:9': 'landscape_16_9',
    '3:2': 'landscape_4_3',
  };
  return mapping[aspect] ?? 'square_hd';
}

// ============================================================
// Internal helpers
// ============================================================

function cameraPhrase(camera: CameraType): string {
  return `shot with ${camera}`;
}

function lightingPhrase(lighting: LightingType): string {
  return lighting;
}

function dofPhrase(dof: DepthOfField): string {
  return dof;
}

function aspectPhrase(aspect: AspectRatio): string {
  const descriptors: Record<AspectRatio, string> = {
    '1:1': 'square 1:1',
    '4:5': 'portrait 4:5',
    '9:16': 'tall vertical 9:16',
    '16:9': 'wide landscape 16:9',
    '3:2': 'landscape 3:2',
  };
  return descriptors[aspect] ?? aspect;
}
