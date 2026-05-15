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
// Second hotfix (Phase 11.6) — count per SEGMENT, not over the
// whole string. An overlay like "7 TABS. 2 HOURS. 1 POST." renders
// as three stacked compact lines on screen — each line is a fact,
// and the on-screen "word count" the human reads is the longest
// line, not the sum. Treating the whole string as one sentence
// punished a deliberately good 3-fact callout pattern.
//
//   "BUFFER ❌ NOTION ❌ FIGMA ❌"  → 3 (one segment, 3 lexical words)
//   "7 TABS. 2 HOURS. 1 POST."     → 2 (three segments, max length 2)
//   "I dropped Buffer last month"  → 5 (one segment, 5 words)
//   "Stop. Now."                   → 1 (two segments, max length 1)
//   "$1M in 6 months"              → 4 (one segment, 4 lexical words)
//   "I built Helm to ship faster"  → 6 (one segment, 6 words → fails 5-cap)
//   "❌"                            → 0
//
// Same logic mirrored in lib/voice-engine/ugc_schema.py so the
// Python and TS paths agree.
function countLexicalWords(text: string): number {
  // Split on sentence-final punctuation. Each piece is one
  // "stacked line" on the rendered overlay. Cap applies to the
  // longest piece — a 3-fact overlay with 2 words per fact passes
  // the same cap a single 5-word phrase does.
  const segments = text
    .trim()
    .split(/[.,!?;]\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (segments.length === 0) return 0;
  const perSegment = segments.map(
    (seg) =>
      seg
        .split(/\s+/)
        .filter((token) => token.length > 0 && /[\p{L}\p{N}]/u.test(token))
        .length,
  );
  return Math.max(...perSegment);
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
// Resilient parse (PR Sprint 7.25 Phase 9)
// ============================================================
//
// The strict schema rejects a lot of cosmetic drift Opus produces
// in long-tail prompts — `cta` returned as a flat string, an
// extra "notes" key on a section, a delivery value spelled
// slightly off ("EXPLANATORY" → caps; "calm" → unmapped). Each of
// those killed the whole generation with "Invalid input" even
// though the rest of the bundle was sound.
//
// `repairUgcBundleInput` is a best-effort normaliser that runs
// BEFORE strict validation:
//   - sections returned as strings get wrapped into the canonical
//     {text, duration_seconds, delivery} shape
//   - delivery values are lower-cased + mapped to the closest
//     enum member (everything unknown falls back to 'warm' for
//     CTAs, 'explanatory' for body beats, 'punchy' for hooks)
//   - duration_seconds out of range are clamped
//   - body beats with missing `beat` numbers get sequential ones
//   - hashtags lose stray '#' prefixes / whitespace
//   - extra fields on sections are dropped (strict mode would
//     reject; we silently shave instead)
//
// `parseUgcBundle(input)` returns:
//   { kind: 'ok', bundle }                — strict parse succeeded
//   { kind: 'repaired', bundle, issues }  — strict failed, repair worked
//   { kind: 'failed', issues }            — both failed; surface upstream
const ALLOWED_DELIVERY = new Set<string>(DELIVERY_STYLES);

function pickDelivery(
  raw: unknown,
  fallback: (typeof DELIVERY_STYLES)[number],
): (typeof DELIVERY_STYLES)[number] {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw.toLowerCase().trim();
  if (ALLOWED_DELIVERY.has(cleaned)) {
    return cleaned as (typeof DELIVERY_STYLES)[number];
  }
  // Soft mapping for common Opus variants.
  if (/calm|informative/.test(cleaned)) return 'explanatory';
  if (/friendly|warm/.test(cleaned)) return 'warm';
  if (/intense|stress|emphas/.test(cleaned)) return 'emphatic';
  if (/admit|honest|vulnerable/.test(cleaned)) return 'confessional';
  if (/build|slow|tense/.test(cleaned)) return 'tension';
  if (/payoff|punch|fast/.test(cleaned)) return 'punchy';
  if (/reveal/.test(cleaned)) return 'reveal';
  return fallback;
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

function coerceNumber(raw: unknown, fallback: number): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const parsed = parseFloat(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function repairHook(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === 'string') {
    return {
      text: raw.trim().slice(0, 180),
      duration_seconds: 2.5,
      delivery: 'punchy',
    };
  }
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const text = typeof o.text === 'string' ? o.text.trim() : '';
  return {
    text: text.slice(0, 180),
    duration_seconds: clamp(coerceNumber(o.duration_seconds, 2.5), 1, 4),
    delivery: pickDelivery(o.delivery, 'punchy'),
  };
}

function repairCta(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === 'string') {
    return {
      text: raw.trim().slice(0, 200),
      duration_seconds: 4,
      delivery: 'warm',
    };
  }
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const text = typeof o.text === 'string' ? o.text.trim() : '';
  return {
    text: text.slice(0, 200),
    duration_seconds: clamp(coerceNumber(o.duration_seconds, 4), 2, 6),
    delivery: pickDelivery(o.delivery, 'warm'),
  };
}

function repairBody(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((b): b is Record<string, unknown> => !!b && typeof b === 'object')
    .slice(0, 5)
    .map((b, i) => ({
      beat: typeof b.beat === 'number' ? b.beat : i + 1,
      text:
        typeof b.text === 'string'
          ? b.text.trim().slice(0, 400)
          : String(b.text ?? '').slice(0, 400),
      duration_seconds: clamp(coerceNumber(b.duration_seconds, 5), 2, 15),
      delivery: pickDelivery(b.delivery, 'explanatory'),
    }))
    // Renumber sequentially in case the model skipped a beat number.
    .map((b, i) => ({ ...b, beat: i + 1 }));
}

function repairOverlays(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object')
    .slice(0, 8)
    .map((o) => ({
      text:
        typeof o.text === 'string'
          ? o.text.trim().slice(0, 40)
          : String(o.text ?? '').slice(0, 40),
      trigger_at_seconds: Math.max(coerceNumber(o.trigger_at_seconds, 0), 0),
      duration_seconds: clamp(coerceNumber(o.duration_seconds, 2), 0.5, 5),
    }));
}

function repairHashtags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t) =>
      typeof t === 'string'
        ? t.replace(/^#+/, '').replace(/\s+/g, '').toLowerCase().trim()
        : '',
    )
    .filter((t) => t.length > 0)
    .slice(0, 5);
}

function repairMetadata(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') {
    return { platform: 'instagram', language: 'en', passes_swipe_test: true };
  }
  const o = raw as Record<string, unknown>;
  return {
    platform:
      typeof o.platform === 'string' && o.platform.trim().length > 0
        ? o.platform.trim().toLowerCase()
        : 'instagram',
    language:
      typeof o.language === 'string' && o.language.trim().length >= 2
        ? o.language.trim()
        : 'en',
    passes_swipe_test:
      typeof o.passes_swipe_test === 'boolean'
        ? o.passes_swipe_test
        : true,
  };
}

export function repairUgcBundleInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object') return {};
  const o = input as Record<string, unknown>;
  return {
    hook: repairHook(o.hook),
    body: repairBody(o.body),
    cta: repairCta(o.cta),
    overlays: repairOverlays(o.overlays),
    caption:
      typeof o.caption === 'string'
        ? o.caption.trim().slice(0, 500)
        : String(o.caption ?? '').slice(0, 500),
    hashtags: repairHashtags(o.hashtags),
    metadata: repairMetadata(o.metadata),
  };
}

export type UgcParseResult =
  | { kind: 'ok'; bundle: UGCBundle }
  | { kind: 'repaired'; bundle: UGCBundle; originalIssues: string }
  | { kind: 'failed'; issues: string };

export function parseUgcBundle(input: unknown): UgcParseResult {
  const strict = UGCBundleSchema.safeParse(input);
  if (strict.success) {
    return { kind: 'ok', bundle: strict.data };
  }
  const originalIssues = strict.error.issues
    .map((i) => `${i.path.join('.')}: ${i.message}`)
    .join('; ');
  // Try the repair path. The shape Opus returned might be salvageable
  // with the heuristics above.
  const repaired = UGCBundleSchema.safeParse(repairUgcBundleInput(input));
  if (repaired.success) {
    return { kind: 'repaired', bundle: repaired.data, originalIssues };
  }
  const repairedIssues = repaired.error.issues
    .map((i) => `${i.path.join('.')}: ${i.message}`)
    .join('; ');
  return {
    kind: 'failed',
    issues: `Original: ${originalIssues}. After repair: ${repairedIssues}`,
  };
}

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
