// PR Sprint 7.18 — UGCBundle schema port.
//
// 1:1 translation of
// Helm SEO/helm-adaptive-voice-engine/ugc_schema.py.
// Pydantic v2 → Zod. Same field types, same length / range
// constraints, same custom validators (hook word count,
// overlay word count, body beats sequential, hashtag format).
//
// Bundle shape stays exactly the same as the Python source so a
// Python service or a TS service could interchange JSON payloads
// without translation.

import { z } from 'zod';

// ============================================================
// Word-counting helper
// ============================================================
//
// Hotfix — the original word counters did
//   `text.trim().split(/\s+/).length`
// which counts EVERY whitespace-separated token, including
// standalone emoji like ❌ or ✅. That punished a deliberately
// good overlay pattern ("BUFFER ❌ NOTION ❌ FIGMA ❌") — three
// brand names plus three pictogram markers, the exact "brand-tool
// callout" shape ugc_validator.py recommends. Splitting that on
// whitespace gives 6 tokens, the schema rejected it as "6 words",
// and video generation failed for any prompt that produced a
// brand-vs-brand comparison overlay.
//
// `countLexicalWords` only counts tokens that contain at least
// one Unicode letter or number. Pictogram-only tokens (emoji,
// dashes, bullets, arrows) don't increment the count.
//
//   "BUFFER ❌ NOTION ❌ FIGMA ❌"  → 3 (was 6)
//   "I dropped Buffer last month"  → 5 (unchanged)
//   "Stop. Now."                   → 2 (unchanged)
//   "$1M in 6 months"              → 4 (unchanged — digits count)
//   "❌"                            → 0 (was 1; pure pictograms aren't
//                                       a word)
//
// Same logic mirrored in lib/voice-engine/ugc_schema.py so the
// Python and TS paths agree.
function countLexicalWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0 && /[\p{L}\p{N}]/u.test(token))
    .length;
}

// ============================================================
// Enums
// ============================================================

export const DELIVERY_STYLES = [
  'punchy', // Fast, high-energy, attention-grabbing
  'explanatory', // Calm, informative
  'tension', // Building toward a reveal, slightly slower
  'reveal', // The payoff moment, emphatic but controlled
  'warm', // Friendly, conversational close
  'confessional', // First-person admission, slightly vulnerable
  'emphatic', // Stressed, slow. Use sparingly.
] as const;

export const DeliveryStyleSchema = z.enum(DELIVERY_STYLES);
export type DeliveryStyle = z.infer<typeof DeliveryStyleSchema>;

// ============================================================
// Sections
// ============================================================

export const HookSectionSchema = z
  .object({
    text: z
      .string()
      .min(10, 'Hook text must be at least 10 chars')
      .max(180, 'Hook text must be at most 180 chars'),
    duration_seconds: z.number().min(1.0).max(4.0),
    delivery: DeliveryStyleSchema,
  })
  .strict()
  .superRefine((hook, ctx) => {
    // 9-word cap, same as the Pydantic field_validator. Uses the
    // lexical counter so a hook like "I quit 3 apps. ✋" is 4
    // words, not 5.
    const wordCount = countLexicalWords(hook.text);
    if (wordCount > 9) {
      ctx.addIssue({
        code: 'custom',
        message: `Hook has ${wordCount} words. Maximum is 9 spoken words. Current hook: '${hook.text}'. Trim it aggressively.`,
        path: ['text'],
      });
    }
  });

export type HookSection = z.infer<typeof HookSectionSchema>;

export const BodyBeatSchema = z
  .object({
    beat: z.number().int().min(1).max(5),
    text: z
      .string()
      .min(20, 'Body beat text must be at least 20 chars')
      .max(400, 'Body beat text must be at most 400 chars'),
    duration_seconds: z.number().min(2.0).max(15.0),
    delivery: DeliveryStyleSchema,
  })
  .strict();

export type BodyBeat = z.infer<typeof BodyBeatSchema>;

export const CTASectionSchema = z
  .object({
    text: z
      .string()
      .min(10, 'CTA text must be at least 10 chars')
      .max(200, 'CTA text must be at most 200 chars'),
    duration_seconds: z.number().min(2.0).max(6.0),
    delivery: DeliveryStyleSchema,
  })
  .strict();

export type CTASection = z.infer<typeof CTASectionSchema>;

export const OverlaySchema = z
  .object({
    text: z
      .string()
      .min(1, 'Overlay text required')
      .max(40, 'Overlay text must be at most 40 chars'),
    trigger_at_seconds: z.number().min(0.0),
    duration_seconds: z.number().min(0.5).max(5.0),
  })
  .strict()
  .superRefine((overlay, ctx) => {
    // Lexical word count so emoji-only tokens (❌ ✅ → •) don't
    // inflate the count. ugc_validator.py explicitly recommends
    // the "BRAND ❌ BRAND ❌ BRAND ❌" shape — counting the ❌
    // as words made that shape un-shippable.
    const wordCount = countLexicalWords(overlay.text);
    if (wordCount > 5) {
      ctx.addIssue({
        code: 'custom',
        message: `Overlay '${overlay.text}' has ${wordCount} words; max is 5. Overlays longer than 5 words are an anti-pattern.`,
        path: ['text'],
      });
    }
  });

export type Overlay = z.infer<typeof OverlaySchema>;

export const UGCMetadataSchema = z
  .object({
    language: z.string().min(2).max(8).default('en'),
    platform: z.string(), // tiktok / instagram / threads / linkedin / facebook
    passes_swipe_test: z.boolean().default(true),
  })
  .strict();

export type UGCMetadata = z.infer<typeof UGCMetadataSchema>;

// ============================================================
// Top-level bundle
// ============================================================

export const UGCBundleSchema = z
  .object({
    hook: HookSectionSchema,
    body: z.array(BodyBeatSchema).min(1).max(5),
    cta: CTASectionSchema,
    overlays: z.array(OverlaySchema).min(3).max(8),
    caption: z
      .string()
      .min(20, 'Caption must be at least 20 chars')
      .max(500, 'Caption must be at most 500 chars'),
    hashtags: z.array(z.string()).min(3).max(5),
    metadata: UGCMetadataSchema,
  })
  .strict()
  .superRefine((bundle, ctx) => {
    // body beats must be sequential 1..N
    for (let i = 0; i < bundle.body.length; i++) {
      if (bundle.body[i].beat !== i + 1) {
        ctx.addIssue({
          code: 'custom',
          message: `Body beats must be sequential starting from 1 (got beat=${bundle.body[i].beat} at position ${i + 1}).`,
          path: ['body', i, 'beat'],
        });
      }
    }
    // hashtag format: no #, no spaces, lowercased
    for (let i = 0; i < bundle.hashtags.length; i++) {
      const tag = bundle.hashtags[i];
      if (tag.startsWith('#')) {
        ctx.addIssue({
          code: 'custom',
          message: `Hashtag '${tag}' should be stored without the # prefix. The # is added at extraction time.`,
          path: ['hashtags', i],
        });
      }
      if (/\s/.test(tag)) {
        ctx.addIssue({
          code: 'custom',
          message: `Hashtag '${tag}' contains a space.`,
          path: ['hashtags', i],
        });
      }
    }
  });

export type UGCBundle = z.infer<typeof UGCBundleSchema>;

// ============================================================
// Helper getters (mirror the Python @property methods)
// ============================================================

/** Sum of hook + body beats + CTA durations. */
export function totalDurationSeconds(bundle: UGCBundle): number {
  return (
    bundle.hook.duration_seconds +
    bundle.body.reduce((sum, b) => sum + b.duration_seconds, 0) +
    bundle.cta.duration_seconds
  );
}

/** Flat script text for HeyGen / TTS engines. Order: hook → body (beat order) → CTA. */
export function scriptText(bundle: UGCBundle): string {
  const parts: string[] = [bundle.hook.text];
  for (const beat of bundle.body) parts.push(beat.text);
  parts.push(bundle.cta.text);
  return parts.join(' ');
}
