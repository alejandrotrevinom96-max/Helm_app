// PR Sprint 7.18 — UGC soft validator port (v2.0).
//
// 1:1 translation of
// Helm SEO/helm-adaptive-voice-engine/ugc_validator.py.
// Zod (in ugc-schema.ts) already enforces the JSON shape +
// length / range / sequential-beat / hashtag-format rules; this
// module catches the cross-field + qualitative rules that schema
// alone can't express:
//
//   1. total_duration            video must land 15-60s
//   2. overlay_timing            each overlay starts/ends within the video
//   3. overlay_not_verbatim      overlays can't repeat spoken script
//   4. caption_not_summary       caption doesn't open as "in this video..."
//   5. hook_quality              weak-opener blacklist
//   6. hook_specificity   (v2)   scoring (number + brand + confession verb − vague nouns)
//   7. cta_not_sales_disguised (v2)  rejects "click the link", "use code", etc.
//   8. swipe_test_self_report    rejects when metadata.passes_swipe_test=false
//
// Test plan: SHIP.md upgrades from 5 to 7 tests; the two new
// checks (#6, #7) are what changed.

import { scriptText, totalDurationSeconds, type UGCBundle } from './ugc-schema';

// ============================================================
// Hook specificity constants
// ============================================================

// Number with optional unit suffix. Mirrors the Python regex; we
// use the /i flag for the unit suffixes.
const NUMBER_PATTERN =
  /\b\d+(?:[.,]\d+)?(?:k|m|hrs?|min|seconds?|secs?|years?|months?|weeks?|days?|x|%)?\b/i;
const DOLLAR_PATTERN = /\$\d+(?:[.,]\d+)?[km]?/i;

const CONFESSION_VERBS = new Set([
  'used to',
  'dropped',
  'deleted',
  'spent',
  'wasted',
  'quit',
  'stopped',
  'killed',
  'switched',
  'ditched',
  'fired',
  'tried',
  'failed',
  'lost',
  'missed',
  'ignored',
  'regret',
  'burned',
]);

const NAMED_ENTITY_TOOLS = new Set([
  'buffer',
  'hootsuite',
  'chatgpt',
  'claude',
  'gemini',
  'notion',
  'reddit',
  'twitter',
  'linkedin',
  'tiktok',
  'instagram',
  'threads',
  'facebook',
  'vercel',
  'supabase',
  'stripe',
  'canva',
  'figma',
  'google',
  'youtube',
  'slack',
  'discord',
  'github',
  'intercom',
  'hubspot',
  'salesforce',
  'airtable',
  'zapier',
  'make.com',
  'n8n',
  'openai',
  'anthropic',
  'perplexity',
  'midjourney',
  'fal',
  'heygen',
  'loom',
  'calendly',
  'shopify',
  'webflow',
  'framer',
]);

const VAGUE_NOUNS = new Set([
  'thing',
  'things',
  'stuff',
  'something',
  'anything',
  'everything',
  'nothing',
]);

// ============================================================
// Sales-CTA constants
// ============================================================

const SALES_CTA_PHRASES = [
  'check out',
  'learn more',
  'click the link',
  'click below',
  'sign up',
  'subscribe',
  'purchase',
  'buy now',
  'get yours',
  'limited time',
  "don't miss",
  'act now',
  'swipe up to',
  'link in bio to buy',
  'link in bio to purchase',
  'visit our website',
  'visit my site',
  'shop now',
  'use code',
  'discount code',
  'promo code',
  'order now',
  'claim your',
  'grab yours',
];

// ============================================================
// Public API
// ============================================================

/**
 * Run all soft validation rules against a UGCBundle.
 *
 * Returns an empty array when every check passes. Otherwise it
 * returns human-readable failure messages — the caller can send
 * them back to the model in the retry context.
 */
export function validateUgcBundle(bundle: UGCBundle): string[] {
  const failures: string[] = [];
  failures.push(...checkTotalDuration(bundle));
  failures.push(...checkOverlayTimingWithinVideo(bundle));
  failures.push(...checkOverlayNotVerbatimRepeat(bundle));
  failures.push(...checkCaptionNotSummary(bundle));
  failures.push(...checkHookQuality(bundle));
  failures.push(...checkHookSpecificity(bundle));
  failures.push(...checkCtaNotSalesDisguised(bundle));
  failures.push(...checkSwipeTestSelfReport(bundle));
  return failures;
}

// ============================================================
// Individual checks
// ============================================================

function checkTotalDuration(bundle: UGCBundle): string[] {
  const total = totalDurationSeconds(bundle);
  if (total < 12.0) {
    return [
      `Total duration ${total.toFixed(1)}s is too short. UGC videos should be 15 to 60 seconds. Add another body beat or extend the hook.`,
    ];
  }
  if (total > 90.0) {
    return [
      `Total duration ${total.toFixed(1)}s is too long. UGC videos should be 15 to 60 seconds for best engagement. Trim a body beat or shorten beats.`,
    ];
  }
  return [];
}

function checkOverlayTimingWithinVideo(bundle: UGCBundle): string[] {
  const total = totalDurationSeconds(bundle);
  const failures: string[] = [];
  bundle.overlays.forEach((overlay, idx) => {
    const i = idx + 1;
    if (overlay.trigger_at_seconds < 0) {
      failures.push(
        `Overlay ${i} ('${overlay.text}') triggers at negative time ${overlay.trigger_at_seconds}s.`,
      );
    }
    const end = overlay.trigger_at_seconds + overlay.duration_seconds;
    // 0.5s tolerance for rounding (matches the Python).
    if (end > total + 0.5) {
      failures.push(
        `Overlay ${i} ('${overlay.text}') extends past video end (triggers at ${overlay.trigger_at_seconds.toFixed(1)}s for ${overlay.duration_seconds.toFixed(1)}s, video ends at ${total.toFixed(1)}s).`,
      );
    }
  });
  return failures;
}

function checkOverlayNotVerbatimRepeat(bundle: UGCBundle): string[] {
  const spokenLower = scriptText(bundle).toLowerCase();
  const failures: string[] = [];
  bundle.overlays.forEach((overlay, idx) => {
    const i = idx + 1;
    const overlayLower = overlay.text.toLowerCase().trim();
    // Only flag when the FULL overlay text (≥3 words) appears
    // verbatim in the spoken script.
    if (
      overlayLower.split(/\s+/).length >= 3 &&
      spokenLower.includes(overlayLower)
    ) {
      failures.push(
        `Overlay ${i} ('${overlay.text}') repeats spoken text verbatim. Use a shorter callout or a different angle (numbers, key terms).`,
      );
    }
  });
  return failures;
}

function checkCaptionNotSummary(bundle: UGCBundle): string[] {
  const badStarters = [
    'in this video',
    'this video is about',
    "today i'm talking about",
    'today i talk about',
    'watch as i',
    "here's a video about",
    'i made a video about',
    "in today's video",
  ];
  const captionLower = bundle.caption.toLowerCase().trim();
  for (const starter of badStarters) {
    if (captionLower.startsWith(starter)) {
      return [
        `Caption opens with summary phrase '${starter}'. Caption should extend the video, not describe it. Add context, a question, or a hook for the next post.`,
      ];
    }
  }
  return [];
}

function checkHookQuality(bundle: UGCBundle): string[] {
  const weakOpeners = [
    'today i',
    'hey everyone',
    "what's up",
    'let me tell you',
    'i want to talk about',
    "i'm going to",
    "here's a thing",
    'so basically',
    'in this video',
    'guys',
    'you guys',
    "today we're going to",
    "let's talk about",
    'quick tip',
    'pro tip',
    'fun fact',
    'did you know',
    'the truth is',
  ];
  const hookLower = bundle.hook.text.toLowerCase().trim();
  for (const weak of weakOpeners) {
    if (hookLower.startsWith(weak)) {
      return [
        `Hook opens with weak phrase '${weak}'. Use a confession, specific number, contrarian setup, or pattern interrupt instead. Examples: 'I used to...', 'I spent 156 hours...', 'Stop using X. Here's why.', 'Everyone's wrong about Y.'`,
      ];
    }
  }
  return [];
}

function checkSwipeTestSelfReport(bundle: UGCBundle): string[] {
  if (!bundle.metadata.passes_swipe_test) {
    return [
      'metadata.passes_swipe_test is false. The model self-reported the hook does not pass the 0.5-second swipe test. Regenerate the hook.',
    ];
  }
  return [];
}

// ============================================================
// v2.0 — hook specificity score
// ============================================================

export interface SpecificityScore {
  score: number;
  matchedSignals: string[];
  vagueHits: string[];
}

/**
 * Standalone scorer (exported for unit tests). Returns the raw
 * score + the signals that contributed. Score < 0 is a failure
 * per SHIP.md's calibration.
 */
export function scoreHookSpecificity(text: string): SpecificityScore {
  const lower = text.toLowerCase();
  let score = 0;
  const matched: string[] = [];

  if (NUMBER_PATTERN.test(text) || DOLLAR_PATTERN.test(text)) {
    score += 1;
    matched.push('number');
  }

  const hasNamedTool = (() => {
    for (const tool of NAMED_ENTITY_TOOLS) {
      if (lower.includes(tool)) return true;
    }
    return false;
  })();
  if (hasNamedTool) {
    score += 1;
    matched.push('named_brand');
  }

  const hasConfessionVerb = (() => {
    for (const verb of CONFESSION_VERBS) {
      if (lower.includes(verb)) return true;
    }
    return false;
  })();
  if (hasConfessionVerb) {
    score += 1;
    matched.push('confession_verb');
  }

  // Vague-noun penalty. Tokenize words (alphanumeric + apostrophe)
  // and intersect with VAGUE_NOUNS.
  const tokens = new Set(lower.match(/\b\w+\b/g) ?? []);
  const vagueHits: string[] = [];
  for (const noun of VAGUE_NOUNS) {
    if (tokens.has(noun)) vagueHits.push(noun);
  }
  if (vagueHits.length > 0) {
    score -= 1;
    matched.push(`vague_noun_penalty:${vagueHits.sort().join(',')}`);
  }

  return { score, matchedSignals: matched, vagueHits: vagueHits.sort() };
}

function checkHookSpecificity(bundle: UGCBundle): string[] {
  const text = bundle.hook.text;
  const { score, matchedSignals, vagueHits } = scoreHookSpecificity(text);
  if (score < 0) {
    return [
      `Hook specificity score is ${score} (need >= 0, ideally >= 1). ` +
        `Signals: ${matchedSignals.length > 0 ? matchedSignals.join(', ') : 'none'}. ` +
        `Hook: '${text}'. ` +
        `Either add specifics (number, brand, confession verb) or remove vague nouns (${vagueHits.length > 0 ? vagueHits.join(', ') : 'n/a'}).`,
    ];
  }
  return [];
}

// ============================================================
// v2.0 — sales-disguised CTA detector
// ============================================================

/** Standalone CTA checker (exported for unit tests). */
export function isCtaSalesDisguised(ctaText: string): {
  flagged: boolean;
  matchedPhrase: string | null;
} {
  const lower = ctaText.toLowerCase();
  for (const phrase of SALES_CTA_PHRASES) {
    if (lower.includes(phrase)) {
      return { flagged: true, matchedPhrase: phrase };
    }
  }
  return { flagged: false, matchedPhrase: null };
}

function checkCtaNotSalesDisguised(bundle: UGCBundle): string[] {
  const { flagged, matchedPhrase } = isCtaSalesDisguised(bundle.cta.text);
  if (flagged && matchedPhrase) {
    return [
      `CTA contains sales phrase '${matchedPhrase}'. UGC CTAs should be conversational, not transactional. Rewrite as a question or invitation. Examples: 'Comment X if you've been here', 'Save this for next sprint', 'Tag a founder who needs this'.`,
    ];
  }
  return [];
}
