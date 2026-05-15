// PR Sprint 7.22 Fase 2 — text-post validator (TS port of
// Helm SEO/helm-adaptive-voice-engine/text_post_validator.py).
//
// Universal validator for text posts (Reddit, LinkedIn text, X tweets,
// Threads, Facebook). Catches AI patterns that the platform-specific
// PLATFORM_TONE rules and the per-content-type CONTENT_TYPE_RULES
// don't currently cover.
//
// Checks (Sprint 1 + Patch 1, single combined surface):
//   C1  X, not Y / chiastic flip detection (period AND comma separators)
//   C2  Blockquote (Reddit-specific by default)
//   C3  Symmetric headers (3+ in same starting-word or same word-length)
//   C4  Templated CTA endings (no personal follow-up)
//   C4b "Specifically:" / "specifically curious" opener (Patch 1)
//   C5  Tricolon (3+ adjacent parallel sentences) (Patch 1)
//   C6  Authenticity markers required on Reddit/Threads/X (Patch 1)
//   C7  Max headers per platform (Reddit/LinkedIn 2, FB 1, others 0)
//       (Patch 1)
//
// This is the canonical TS source-of-truth. The Python upstream at
// lib/voice-engine/text_post_validator.py (and the
// Helm SEO/helm-adaptive-voice-engine/ mirror) MUST stay in lockstep
// — when you edit one, edit the other.

// ============================================================
// C1 — "X, not Y" pattern detection
// ============================================================

// Period AND comma separators (Patch 1: comma support added). The
// inner character class deliberately drops the comma to avoid
// catastrophic backtracking — the comma is reserved for the
// separator position only.
const X_NOT_Y_PATTERNS: ReadonlyArray<RegExp> = [
  // ", not X" appositive (e.g., "build, not buy")
  /[,;]\s+not\s+\w+/gi,
  // "It's not X. It's Y." OR "It's not X, it's Y." chiastic flip
  /\bit'?s?\s+not\s+[\w\s'-]{2,60}[.!,]\s*it'?s?\s+/gi,
  // "isn't X. It's Y" / "isn't X, It's Y" / "isn't X. That's Y"
  /\bisn'?t\s+[\w\s'-]{2,60}[.!,]\s*(it'?s|that'?s|the)\s+/gi,
  // "X is the opposite of Y" (rare but distinctive)
  /\bis\s+(almost\s+)?the\s+opposite\s+of\s+\w+/gi,
];

export function countXNotYPatterns(text: string): number {
  let total = 0;
  for (const re of X_NOT_Y_PATTERNS) {
    const matches = text.match(re);
    total += matches?.length ?? 0;
  }
  return total;
}

export function checkXNotY(
  text: string,
  opts: { maxAllowed?: number } = {},
): string[] {
  const maxAllowed = opts.maxAllowed ?? 0;
  const count = countXNotYPatterns(text);
  if (count > maxAllowed) {
    return [
      `Text contains ${count} 'X, not Y' constructions (max allowed: ${maxAllowed}). ` +
        `This is one of the most distinctive AI rhythms. Rewrite without ` +
        `chiastic flips. Examples to avoid: 'specific decisions, not generic lessons', ` +
        `'It's not a problem. It's a system.', 'X is the opposite of Y'.`,
    ];
  }
  return [];
}

// ============================================================
// C5 — Tricolon detection (Patch 1)
// ============================================================

// Words that don't carry sentence meaning, used to skip when
// comparing openers.
const TRICOLON_IGNORE_WORDS: ReadonlySet<string> = new Set([
  'the',
  'a',
  'an',
  'this',
  'that',
  'these',
  'those',
]);

const WORD_RE = /\b[\w']+\b/g;

function wordsOf(text: string): string[] {
  return text.match(WORD_RE) ?? [];
}

export function checkTricolon(text: string): string[] {
  // Split into sentences. Use lookbehind so the separators stay
  // attached to the sentence we split off.
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (sentences.length < 3) return [];

  // Sliding window of 3 consecutive sentences.
  for (let i = 0; i <= sentences.length - 3; i++) {
    const window = sentences.slice(i, i + 3);

    // First significant word of each sentence.
    const firstWords: string[] = window.map((s) => {
      const tokens = (s.toLowerCase().match(WORD_RE) ?? []).filter(
        (t) => !TRICOLON_IGNORE_WORDS.has(t),
      );
      return tokens[0] ?? '';
    });

    // Signal A: same first significant word in all 3 sentences.
    const distinctFirstWords = new Set(firstWords);
    if (
      distinctFirstWords.size === 1 &&
      firstWords[0] // non-empty (skip stop-word-only sentences)
    ) {
      return [
        `Tricolon detected: 3 consecutive sentences all start with ` +
          `'${firstWords[0]}'. Example: "${window[0]}" / "${window[1]}" / "${window[2]}". ` +
          `Tricolons are an AI-coded rhetorical device. ` +
          `Trim to 2 items or rewrite as prose.`,
      ];
    }

    // Signal B: all very short (<=5 words) AND structurally similar
    // (approximate POS by first-word category).
    const wordCounts = window.map((s) => wordsOf(s).length);
    if (
      wordCounts.every((c) => c <= 5) &&
      distinctFirstWords.size <= 2 &&
      firstWords.every(Boolean)
    ) {
      return [
        `Tricolon detected: 3 short parallel sentences. ` +
          `Example: "${window[0]}" / "${window[1]}" / "${window[2]}". ` +
          `Trim to 2 items or rewrite as prose.`,
      ];
    }
  }

  return [];
}

// ============================================================
// C2 — Blockquote detection (Reddit-specific)
// ============================================================

const BLOCKQUOTE_PATTERN = /^>\s+/m;

export function checkNoBlockquote(text: string): string[] {
  if (BLOCKQUOTE_PATTERN.test(text)) {
    return [
      `Text contains blockquote (>) lines. On Reddit, blockquotes signal ` +
        `a pre-constructed quotable line, which is an AI tell. Remove the ` +
        `blockquote and either delete the line or fold its content into ` +
        `the surrounding paragraph as plain prose.`,
    ];
  }
  return [];
}

// ============================================================
// C3 — Symmetric headers detector
// ============================================================

const HEADER_PATTERN = /^#+\s+(.+)$/gm;

export function checkSymmetricHeaders(
  text: string,
  opts: { threshold?: number } = {},
): string[] {
  const threshold = opts.threshold ?? 3;
  const headers: string[] = [];
  // Use exec loop so we can pull capture groups out of the /gm regex.
  // Reset lastIndex by reassigning the regex to a fresh instance.
  const re = new RegExp(HEADER_PATTERN.source, HEADER_PATTERN.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    headers.push(m[1]);
  }
  if (headers.length < threshold) return [];

  // Check 1: same starting word
  const startingWords = headers
    .filter((h) => h.trim().length > 0)
    .map((h) => h.toLowerCase().trim().split(/\s+/)[0]);
  const startingCounts = new Map<string, number>();
  for (const w of startingWords) {
    startingCounts.set(w, (startingCounts.get(w) ?? 0) + 1);
  }
  for (const [word, count] of startingCounts) {
    if (count >= threshold) {
      return [
        `Text has ${threshold}+ headers all starting with '${word}'. ` +
          `Symmetric parallel headers ('What X / What Y / What Z') signal ` +
          `essay-style structure that reads as AI-shaped. Rewrite headers ` +
          `with varied syntactic patterns or remove some headers entirely.`,
      ];
    }
  }

  // Check 2: same word count
  const wordLens = headers.map((h) => h.split(/\s+/).filter(Boolean).length);
  const lenCounts = new Map<number, number>();
  for (const l of wordLens) {
    lenCounts.set(l, (lenCounts.get(l) ?? 0) + 1);
  }
  for (const [len, count] of lenCounts) {
    if (count >= threshold) {
      return [
        `Text has ${threshold}+ headers all exactly ${len} words long. ` +
          `Headers in matched parallel structure signal templated essay form. ` +
          `Vary header lengths and structures, or remove some entirely.`,
      ];
    }
  }

  return [];
}

// ============================================================
// C6 — Authenticity markers per platform (Patch 1)
// ============================================================

const AUTHENTICITY_MARKERS_BY_PLATFORM: Record<string, readonly string[]> = {
  reddit: ['tbh', 'ngl', 'imo', 'imho', 'fwiw', 'idk', 'honestly', 'lowkey'],
  threads: [
    'tbh',
    'ngl',
    'imo',
    'idk',
    'ok so',
    'wait',
    'actually',
    'lowkey',
  ],
  x: ['tbh', 'ngl', 'lol', 'imo', 'fr', 'ok so', 'wait'],
  // Instagram, LinkedIn, Facebook: no hard requirement.
};

export function checkAuthenticityMarkers(
  text: string,
  platform: string | undefined,
): string[] {
  if (!platform) return [];
  const markers = AUTHENTICITY_MARKERS_BY_PLATFORM[platform.toLowerCase()];
  if (!markers || markers.length === 0) return [];

  const lower = text.toLowerCase();
  const found = markers.filter((m) => lower.includes(m));
  if (found.length === 0) {
    return [
      `Text contains zero authenticity markers for ${platform} ` +
        `(expected at least one of: ${markers.slice(0, 5).join(', ')}, ...). ` +
        `Real users on ${platform} signal authenticity with informal ` +
        `markers. Add at least one naturally to the post.`,
    ];
  }
  return [];
}

// ============================================================
// C7 — Max headers per platform (Patch 1)
// ============================================================

const MAX_HEADERS_BY_PLATFORM: Record<string, number> = {
  reddit: 2,
  linkedin: 2,
  x: 0,
  threads: 0,
  facebook: 1,
  instagram: 0,
};

export function checkMaxHeaders(
  text: string,
  opts: { platform?: string; maxOverride?: number } = {},
): string[] {
  // Count headers via the same HEADER_PATTERN we use elsewhere.
  const re = new RegExp(HEADER_PATTERN.source, HEADER_PATTERN.flags);
  let count = 0;
  while (re.exec(text) !== null) count++;

  let maxAllowed: number;
  if (opts.maxOverride !== undefined) {
    maxAllowed = opts.maxOverride;
  } else if (opts.platform) {
    maxAllowed = MAX_HEADERS_BY_PLATFORM[opts.platform.toLowerCase()] ?? 5;
  } else {
    maxAllowed = 5;
  }

  if (count > maxAllowed) {
    return [
      `Text has ${count} markdown headers; max for ` +
        `${opts.platform ?? 'this context'} is ${maxAllowed}. ` +
        `Real ${opts.platform ?? 'social'} posts have minimal structure. ` +
        `Convert excess headers to paragraph breaks or remove.`,
    ];
  }
  return [];
}

// ============================================================
// C4 — Templated CTA detector
// ============================================================

const TEMPLATED_CTAS: readonly string[] = [
  "what's your take",
  'whats your take',
  'what worked for you',
  'anyone else seeing this',
  'anyone else?',
  'specifically curious about',
  'specifically curious', // Patch 1 variant
  'specifically asking', // Patch 1 variant
  'drop a comment if',
  'agree or disagree',
  'what am i missing',
  'let me know your thoughts',
  'thoughts?',
  'what do you think?',
  "what's your experience",
  'have you seen this',
];

export function checkTemplatedCta(text: string): string[] {
  const lastPara = text.trim().split(/\n\n/).slice(-1)[0]?.trim().toLowerCase() ?? '';
  // Strip trailing markdown links so a "[link](url)" suffix doesn't
  // hide the templated phrase.
  const lastParaClean = lastPara.replace(/\[.*?\]\(.*?\)/g, '').trim();

  for (const cta of TEMPLATED_CTAS) {
    if (
      lastParaClean.endsWith(cta + '?') ||
      lastParaClean.endsWith(cta + '.')
    ) {
      return [
        `Text ends with templated CTA '${cta}' with no personal context ` +
          `follow-up. Real CTAs from humans add 1 personal clause after ` +
          `(reason, vulnerability, specific ask). Either add a follow-up ` +
          `sentence or rewrite the CTA in the writer's specific voice.`,
      ];
    }
  }
  return [];
}

// Patch 1 — "Specifically:" transitional opener detector
export function checkCtaSpecificallyOpener(text: string): string[] {
  const lastPara = text.trim().split(/\n\n/).slice(-1)[0]?.trim().toLowerCase() ?? '';
  if (/\bspecifically[\s,:]/.test(lastPara)) {
    return [
      `CTA section contains 'Specifically:' or 'specifically curious' ` +
        `transitional opener. This is an AI-coded precision marker. ` +
        `Either ask the question directly or add the precision inline ` +
        `without the 'specifically' bridge.`,
    ];
  }
  return [];
}

// ============================================================
// Public API
// ============================================================

export interface ValidateTextPostOptions {
  platform?: string;
  xNotYMax?: number;
  enforceNoBlockquote?: boolean;
  enforceNoSymmetricHeaders?: boolean;
  enforceNoTemplatedCta?: boolean;
  enforceNoTricolon?: boolean; // Patch 1
  enforceAuthenticityMarkers?: boolean; // Patch 1
  enforceMaxHeaders?: boolean; // Patch 1
  enforceNoSpecificallyOpener?: boolean; // Patch 1
  maxHeadersOverride?: number; // Patch 1
}

/**
 * Run all text-post-level checks against generated content.
 *
 * Returns an empty array when everything passes; otherwise an array of
 * human-readable failure messages suitable to send back to the model
 * (or log to an audit row, which is what the production pipeline does).
 */
export function validateTextPost(
  text: string,
  options: ValidateTextPostOptions = {},
): string[] {
  const {
    platform,
    xNotYMax = 0,
    enforceNoSymmetricHeaders = true,
    enforceNoTemplatedCta = true,
    enforceNoTricolon = true,
    enforceAuthenticityMarkers = true,
    enforceMaxHeaders = true,
    enforceNoSpecificallyOpener = true,
    maxHeadersOverride,
  } = options;

  // Reddit defaults to "no blockquote"; other platforms only enforce
  // when the caller explicitly opts in.
  const enforceNoBlockquote =
    options.enforceNoBlockquote ??
    (platform?.toLowerCase() === 'reddit');

  const failures: string[] = [];

  // C1 universal
  failures.push(...checkXNotY(text, { maxAllowed: xNotYMax }));

  // C5 universal (Patch 1)
  if (enforceNoTricolon) failures.push(...checkTricolon(text));

  // C2 (Reddit by default)
  if (enforceNoBlockquote) failures.push(...checkNoBlockquote(text));

  // C3 universal
  if (enforceNoSymmetricHeaders) failures.push(...checkSymmetricHeaders(text));

  // C7 per-platform (Patch 1)
  if (enforceMaxHeaders) {
    failures.push(
      ...checkMaxHeaders(text, { platform, maxOverride: maxHeadersOverride }),
    );
  }

  // C4 universal
  if (enforceNoTemplatedCta) failures.push(...checkTemplatedCta(text));

  // C4b universal (Patch 1)
  if (enforceNoSpecificallyOpener) failures.push(...checkCtaSpecificallyOpener(text));

  // C6 per-platform (Patch 1)
  if (enforceAuthenticityMarkers) {
    failures.push(...checkAuthenticityMarkers(text, platform));
  }

  return failures;
}

// ============================================================
// Helper for the generation pipeline: flatten a structured-content
// object into a continuous string for validation.
//
// The generate-structured endpoint returns structured JSON
// (typically { opening, body, closing } for text taxonomy). The
// validators above expect continuous prose. This helper does a
// best-effort flatten: it walks the object and concatenates all
// string values with double newlines, which preserves paragraph
// breaks well enough for the regex-based checks above.
// ============================================================

export function flattenStructuredContentForValidation(content: unknown): string {
  const parts: string[] = [];
  const visit = (node: unknown): void => {
    if (typeof node === 'string') {
      const trimmed = node.trim();
      if (trimmed) parts.push(trimmed);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (node !== null && typeof node === 'object') {
      for (const value of Object.values(node)) visit(value);
    }
  };
  visit(content);
  return parts.join('\n\n');
}
