// PR Sprint 7.19 — visual subject extractor port.
//
// 1:1 translation of
// Helm SEO/helm-adaptive-voice-engine/visual_subject_extractor.py.
//
// Mini-LLM call that translates PAIN_POINT + caption into a
// concrete visual subject for image generation. This is the core
// innovation of the visual pipeline — the caption describes what
// the person SAYS about the image; the subject describes what's
// IN the image.
//
// Recommended model: Claude Haiku (fast, cheap, good at
// structured extraction). Cost ~$0.005 per call, latency ~1-2s.

import { anthropic, MODELS } from '@/lib/ai/claude';
import {
  SubjectBlockSchema,
  repairSubjectBlockInput,
  type SubjectBlock,
} from './visual-schema';

// ============================================================
// The extraction prompt
// ============================================================

export const SUBJECT_EXTRACTION_PROMPT = `You are a senior visual director specialized in founder and SaaS marketing content. Your job is to translate a marketing post into a powerful, specific visual scene that an image generator (Flux, Midjourney, etc.) can render into a thumb-stopper.

INPUTS:

PAIN_POINT (what the post is fundamentally about, the audience pain or insight):
{pain_point}

CAPTION (what the person says about the image; NOT what the image should literally show):
{caption}

BRAND ARCHETYPE: {brand_archetype}
BRAND MOOD: {brand_mood}

YOUR TASK:

Output a JSON object describing the visual subject. The image should evoke the EMOTIONAL HUMAN CONSEQUENCE of the pain point, not the tool or the literal caption. For B2B/SaaS pain points, the strongest images show the human moment that the pain creates, not a screenshot or an abstract concept.

OUTPUT SCHEMA (return ONLY this JSON, no commentary):

{
  "main_subject": "<concrete description of the central subject. 15-300 chars. E.g., 'A solo founder hunched over a laptop at 2am, 8 browser tabs glowing on the screen'>",
  "composition": "<framing and arrangement. 5-150 chars. E.g., 'centered, slight low angle, subject filling 60% of frame'>",
  "setting": "<environment/context. 5-200 chars. E.g., 'messy home office, warm desk lamp, late night, papers scattered'>",
  "mood_descriptor": "<emotional tone as a full phrase, 3-80 chars. E.g., 'exhausted but determined', 'quietly confident', 'frustrated and overwhelmed'>",
  "emotional_anchor": "<single dominant emotion as a short tag, 1-3 words max, 30 chars. E.g., 'exhaustion', 'determination', 'relief', 'frustration'. Or null if no single dominant emotion stands out.>",
  "visual_strategy": "<one of: human_story, metaphor_driven, product_shot, data_visualization, behind_scenes, brand_heritage>",
  "visual_metaphor": "<required if visual_strategy is 'metaphor_driven', 3-200 chars. Otherwise null.>"
}

VISUAL STRATEGY GUIDE (pick exactly one):
- human_story: Subject is a person in a real moment. DEFAULT for SaaS/founder pain points.
- metaphor_driven: Subject is a concrete object/scene representing an abstract concept. Use when human story doesn't fit.
- product_shot: Subject is a product or interface. Use sparingly, only for product launches.
- data_visualization: Subject is a chart, graph, or screenshot. Use only when the data IS the story.
- behind_scenes: Subject is a workspace, process, or in-progress moment.
- brand_heritage: Subject is brand-anchored imagery (founder portrait, signature setting). Use rarely.

CRITICAL RULES:
- The image MUST work as a standalone thumb-stopper. Would a stranger scrolling at 2am stop on this image?
- Focus on the EMOTIONAL HUMAN CONSEQUENCE of the pain point, not the tool itself.
- Do NOT describe text overlays, captions, watermarks, UI elements, or logos. Those are added separately in post-production.
- Do NOT just paraphrase the caption. Translate it to visuals.
- For pain points about software/tools, prefer showing the human consequence (a tired founder) over the tool itself (a screenshot).
- The mood_descriptor and emotional_anchor should align with the BRAND_MOOD. If brand mood is "warm and human" don't pick "cold and clinical".
- emotional_anchor is a short tag (1-3 words). mood_descriptor is the full phrase. They describe the same emotion at two different levels of detail.
- Keep the visual concept achievable for an image model. Avoid impossible spatial relationships, hyperspecific cultural references, or anything requiring legible text.

Return only the JSON. No preamble, no markdown fences, no thinking.`;

// ============================================================
// Errors
// ============================================================

/**
 * Raised when the extractor fails to produce a valid SubjectBlock
 * after all retries. Caller should fall back to a default subject
 * or surface to the user.
 */
export class SubjectExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubjectExtractionError';
  }
}

// ============================================================
// Public API
// ============================================================

export interface ExtractSubjectBlockInput {
  pain_point: string;
  caption: string;
  brand_archetype: string;
  brand_mood: string;
  /** Model identifier. Defaults to Haiku for speed/cost. */
  model?: string;
  /** How many times to retry on parse/validation failure. */
  max_retries?: number;
}

/**
 * Extract a SubjectBlock by calling Claude Haiku.
 *
 * Throws SubjectExtractionError if all retries fail. The caller
 * should catch and either fall back to a generic SubjectBlock
 * ("a clean professional setting") or surface to the user.
 */
export async function extractSubjectBlock(
  input: ExtractSubjectBlockInput,
): Promise<SubjectBlock> {
  const {
    pain_point,
    caption,
    brand_archetype,
    brand_mood,
    model = MODELS.HAIKU,
    max_retries = 2,
  } = input;

  const prompt = SUBJECT_EXTRACTION_PROMPT.replace(
    '{pain_point}',
    pain_point.trim(),
  )
    .replace('{caption}', caption.trim())
    .replace('{brand_archetype}', brand_archetype.trim())
    .replace('{brand_mood}', brand_mood.trim());

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= max_retries; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model,
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }],
      });
      const textBlock = response.content.find((b) => b.type === 'text');
      const raw =
        textBlock?.type === 'text' ? textBlock.text.trim() : '';
      const payload = extractJsonObject(raw);
      // PR Sprint 7.25 Phase 11.7 — truncate over-long string
      // fields before strict parse. Haiku sometimes writes 200+
      // char mood descriptors against an 80-char cap (was 80,
      // bumped to 200; this still trims when the model goes
      // really long). Without this safety net we'd retry 3 times
      // and then crash the whole IR pipeline.
      const prepared = repairSubjectBlockInput(payload);
      // Zod throws on validation failure; caught by the outer try.
      const subject = SubjectBlockSchema.parse(prepared);
      return subject;
    } catch (e) {
      lastError = e;
      continue;
    }
  }

  throw new SubjectExtractionError(
    `Failed to extract SubjectBlock after ${max_retries + 1} attempts. Last error: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

// ============================================================
// Internal helpers
// ============================================================

/**
 * Extract the first JSON object from a string, tolerating
 * markdown fences and minor model preamble. Mirrors the Python
 * implementation byte-for-byte.
 */
export function extractJsonObject(raw: string): unknown {
  let text = raw.trim();

  // Strip markdown fences if present.
  if (text.startsWith('```')) {
    const newlineIdx = text.indexOf('\n');
    text = newlineIdx >= 0 ? text.slice(newlineIdx + 1) : text;
    if (text.endsWith('```')) {
      const lastFence = text.lastIndexOf('```');
      text = text.slice(0, lastFence);
    }
    text = text.trim();
  }

  // Find the bracketing { ... } and parse.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('No JSON object found in response');
  }
  return JSON.parse(text.slice(start, end + 1));
}
