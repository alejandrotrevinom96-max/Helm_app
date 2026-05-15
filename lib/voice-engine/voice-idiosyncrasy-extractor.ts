// PR Sprint 7.22 Sprint E.2 — E1 voice idiosyncrasies extractor
// (TS port of
// Helm SEO/helm-adaptive-voice-engine/voice_idiosyncrasy_extractor.py).
//
// Extracts statistical voice patterns from a list of past post texts.
// The output is a VoiceIdiosyncrasies object that the prompt builder
// injects as a WRITER VOICE PROFILE block of concrete rules
// (em-dash rate, fragment ratio, common openers, hedging behavior,
// etc.) so the model can match the writer's voice as an explicit
// set of constraints rather than imitating loose samples.
//
// Pure functions — no DB, no network, no async. The
// maybe-refresh-idiosyncrasies helper does the DB query +
// freshness logic and calls into this module.
//
// Canonical TS source-of-truth. Python upstream at
// lib/voice-engine/voice_idiosyncrasy_extractor.py (and
// Helm SEO/helm-adaptive-voice-engine/) MUST stay in lockstep.

import type { VoiceIdiosyncrasies } from '@/lib/types/brand';

// ============================================================
// Tokenization patterns
// ============================================================

const WORD_RE = /\b[\w']+\b/g;
const SENTENCE_END_RE = /[.!?]+/;
// Emoji ranges: misc symbols + dingbats + emoji extensions + regional
// indicators. Same charset class as the Python version.
const EMOJI_RE =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E0}-\u{1F1FF}]/gu;
const EM_DASH_RE = /—|--|\s-\s/g;
const ELLIPSIS_RE = /\.{3,}|…/g;
const SEMICOLON_RE = /;/g;
const PARENTHETICAL_RE = /\([^)]{4,80}\)/g;
const NUMBER_RE = /\b\d+(?:[.,]\d+)?\b/g;

const TRACKED_FILLERS: readonly string[] = [
  'tbh',
  'ngl',
  'imo',
  'imho',
  'fwiw',
  'idk',
  'honestly',
  'literally',
  'actually',
  'anyway',
  'ok so',
  'alright',
  'look',
  'hot take',
  'real talk',
  'fr',
  'lowkey',
  'highkey',
];

const TRACKED_OPENERS: readonly string[] = [
  'ok so',
  'alright',
  'tbh',
  'honestly',
  'look',
  'hot take',
  'real talk',
  "i've been thinking",
  'quick thought',
  'thinking about',
];

const TRACKED_CLOSERS: readonly string[] = [
  'anyway',
  'idk',
  'fwiw',
  'edit:',
  'tldr:',
  'thoughts?',
  "we'll see",
  "here's hoping",
];

const HEDGE_MARKERS: readonly string[] = [
  'about',
  'around',
  'roughly',
  'approximately',
  'i think',
  'maybe',
  'give or take',
  'more or less',
  'ish',
  'kinda',
];

const SELF_CORRECTION_MARKERS: readonly string[] = [
  'actually wait',
  'scratch that',
  'no wait',
  'hmm actually',
  'i meant',
  'what i meant',
  'let me restart',
];

const TRACKED_PROFANITY: readonly string[] = [
  'shit',
  'fuck',
  'damn',
  'hell',
  'ass',
  'bullshit',
  'crap',
  'wtf',
  'tf',
  'af',
];

// ============================================================
// Per-pattern helpers
// ============================================================

function per1000Words(count: number, totalWords: number): number {
  if (totalWords === 0) return 0;
  return Math.round((count / totalWords) * 1000 * 100) / 100;
}

function countMatches(re: RegExp, text: string): number {
  // We rebuild the regex per call so the global flag state doesn't
  // leak between invocations.
  const fresh = new RegExp(re.source, re.flags);
  let n = 0;
  while (fresh.exec(text) !== null) n++;
  return n;
}

function wordsOf(text: string): string[] {
  return text.match(WORD_RE) ?? [];
}

// ============================================================
// Public API
// ============================================================

export const MIN_POSTS_FOR_EXTRACTION = 10;
const TRIM_PERCENT = 0.1; // Trim top/bottom 10% by length

export interface ExtractorInputPost {
  text: string;
}

/**
 * Run statistical analysis on a list of past posts and produce a
 * structured VoiceIdiosyncrasies object.
 *
 * Returns null when there aren't enough posts to extract reliable
 * patterns. Callers (the prompt builder) handle null by skipping
 * the WRITER VOICE PROFILE block — the model falls back to brand
 * bible + voice fingerprint samples for tone guidance.
 */
export function extractVoiceIdiosyncrasies(
  posts: readonly ExtractorInputPost[],
): VoiceIdiosyncrasies | null {
  if (posts.length < MIN_POSTS_FOR_EXTRACTION) return null;

  // Trim outliers by text length (top/bottom 10%).
  const byLength = [...posts].sort((a, b) => a.text.length - b.text.length);
  const trimN = Math.floor(byLength.length * TRIM_PERCENT);
  const trimmed = trimN > 0 ? byLength.slice(trimN, -trimN) : byLength;
  if (trimmed.length < MIN_POSTS_FOR_EXTRACTION) return null;

  const texts = trimmed.map((p) => p.text);
  const combined = texts.join('\n\n');
  const totalWords = wordsOf(combined).length;

  const punctuation = {
    emDashPer1000Words: per1000Words(countMatches(EM_DASH_RE, combined), totalWords),
    ellipsisPer1000Words: per1000Words(
      countMatches(ELLIPSIS_RE, combined),
      totalWords,
    ),
    semicolonPer1000Words: per1000Words(
      countMatches(SEMICOLON_RE, combined),
      totalWords,
    ),
    parentheticalAsidePer1000Words: per1000Words(
      countMatches(PARENTHETICAL_RE, combined),
      totalWords,
    ),
  };

  const lowercaseFirstLetterRatio = roundTo(
    texts.filter((t) => {
      const stripped = t.trim();
      const first = stripped[0];
      return first !== undefined && /^[a-z]$/.test(first);
    }).length / texts.length,
    2,
  );

  const commonFillerWords: Record<string, number> = {};
  for (const filler of TRACKED_FILLERS) {
    const postCount = texts.filter((t) => t.toLowerCase().includes(filler))
      .length;
    if (postCount > 0) {
      commonFillerWords[filler] = roundTo(postCount / texts.length, 2);
    }
  }

  const commonOpeners = extractCommonOpeners(texts);
  const commonClosers = extractCommonClosers(texts);

  const sentences = combined
    .split(SENTENCE_END_RE)
    .map((s) => s.trim())
    .filter(Boolean);
  let avgSentenceLengthWords = 0;
  let fragmentRatio = 0;
  if (sentences.length > 0) {
    const lengths = sentences.map((s) => wordsOf(s).length);
    avgSentenceLengthWords =
      Math.round(
        (lengths.reduce((a, b) => a + b, 0) / lengths.length) * 10,
      ) / 10;
    const fragmentCount = lengths.filter((l) => l <= 4).length;
    fragmentRatio = roundTo(fragmentCount / sentences.length, 2);
  }

  let allEmojis: string[] = [];
  for (const t of texts) {
    allEmojis = allEmojis.concat(t.match(EMOJI_RE) ?? []);
  }
  const emojiPerPost = roundTo(allEmojis.length / texts.length, 2);
  const emojiCounts = countBy(allEmojis);
  const commonEmojis = topN(emojiCounts, 5);

  const combinedLower = combined.toLowerCase();
  const usedProfanity: string[] = [];
  let totalProfanity = 0;
  for (const word of TRACKED_PROFANITY) {
    const wordRe = new RegExp(`\\b${escapeRegex(word)}\\b`, 'gi');
    const count = countMatches(wordRe, combinedLower);
    if (count > 0) {
      usedProfanity.push(word);
      totalProfanity += count;
    }
  }

  const hedgingRatio = computeHedgingRatio(combinedLower);
  const selfCorrectionCount = TRACKED_SELF_CORRECTION_COUNT(combinedLower);

  return {
    sampleSize: trimmed.length,
    extractedAt: new Date().toISOString(),
    ...punctuation,
    lowercaseFirstLetterRatio,
    commonFillerWords,
    commonProfanity: usedProfanity,
    profanityPer1000Words: per1000Words(totalProfanity, totalWords),
    avgSentenceLengthWords,
    fragmentRatio,
    emojiPerPost,
    commonEmojis,
    commonOpeners,
    commonClosers,
    hedgingRatio,
    selfCorrectionCount,
  };
}

// ============================================================
// Helpers
// ============================================================

function extractCommonOpeners(texts: readonly string[]): string[] {
  const counter = new Map<string, number>();
  for (const post of texts) {
    const head = post.toLowerCase().trim().slice(0, 30);
    for (const opener of TRACKED_OPENERS) {
      if (head.startsWith(opener)) {
        counter.set(opener, (counter.get(opener) ?? 0) + 1);
      }
    }
  }
  return topN(counter, 5);
}

function extractCommonClosers(texts: readonly string[]): string[] {
  const counter = new Map<string, number>();
  for (const post of texts) {
    const tail = post.toLowerCase().trim().slice(-50);
    for (const closer of TRACKED_CLOSERS) {
      if (tail.includes(closer)) {
        counter.set(closer, (counter.get(closer) ?? 0) + 1);
      }
    }
  }
  return topN(counter, 5);
}

function computeHedgingRatio(textLower: string): number {
  const fresh = new RegExp(NUMBER_RE.source, NUMBER_RE.flags);
  const matches: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = fresh.exec(textLower)) !== null) {
    matches.push(m);
  }
  if (matches.length === 0) return 0;

  let hedged = 0;
  for (const match of matches) {
    const windowStart = Math.max(0, match.index - 30);
    const window = textLower.slice(windowStart, match.index + match[0].length);
    if (HEDGE_MARKERS.some((marker) => window.includes(marker))) hedged++;
  }
  return roundTo(hedged / matches.length, 2);
}

function TRACKED_SELF_CORRECTION_COUNT(textLower: string): number {
  return SELF_CORRECTION_MARKERS.filter((m) => textLower.includes(m)).length;
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function countBy<T>(items: readonly T[]): Map<T, number> {
  const counter = new Map<T, number>();
  for (const item of items) {
    counter.set(item, (counter.get(item) ?? 0) + 1);
  }
  return counter;
}

function topN<T>(counter: Map<T, number>, n: number): T[] {
  return [...counter.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================
// Format helper — produces the WRITER VOICE PROFILE prompt block
// ============================================================

export function formatIdiosyncrasiesAsPromptRules(
  idio: VoiceIdiosyncrasies,
): string {
  const lines: string[] = [];

  lines.push(
    `WRITER VOICE PROFILE (analyzed from last ${idio.sampleSize} posts):`,
  );
  lines.push('');
  lines.push('PUNCTUATION PATTERNS:');
  lines.push(
    `  - Em dashes: ${idio.emDashPer1000Words} per 1000 words (${describeFrequency(idio.emDashPer1000Words)})`,
  );
  lines.push(
    `  - Ellipsis: ${idio.ellipsisPer1000Words} per 1000 words (${describeFrequency(idio.ellipsisPer1000Words)})`,
  );
  lines.push(`  - Semicolons: ${idio.semicolonPer1000Words} per 1000 words`);
  lines.push(
    `  - Parenthetical asides: ${idio.parentheticalAsidePer1000Words} per 1000 words`,
  );
  lines.push('');
  lines.push('STRUCTURE:');
  lines.push(`  - Average sentence length: ${idio.avgSentenceLengthWords} words`);
  lines.push(
    `  - Fragment ratio: ${Math.round(idio.fragmentRatio * 100)}% of sentences are fragments`,
  );
  lines.push(
    `  - Lowercase first letter: ${Math.round(idio.lowercaseFirstLetterRatio * 100)}% of posts`,
  );
  lines.push('');
  lines.push('VOCABULARY:');

  const fillerEntries = Object.entries(idio.commonFillerWords)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  if (fillerEntries.length > 0) {
    lines.push('  - Filler words used:');
    for (const [word, freq] of fillerEntries) {
      lines.push(`    - '${word}': used in ${Math.round(freq * 100)}% of posts`);
    }
  } else {
    lines.push('  - No tracked filler words found.');
  }

  if (idio.commonProfanity.length > 0) {
    lines.push(
      `  - Profanity: ${idio.profanityPer1000Words} per 1000 words; common: ${idio.commonProfanity.join(', ')}`,
    );
  } else {
    lines.push('  - No profanity in tracked sample.');
  }

  lines.push('');
  lines.push('EMOJI:');
  lines.push(`  - ${idio.emojiPerPost} emojis per post on average`);
  if (idio.commonEmojis.length > 0) {
    lines.push(`  - Common emojis: ${idio.commonEmojis.join(' ')}`);
  }

  lines.push('');
  lines.push('OPENERS / CLOSERS:');
  if (idio.commonOpeners.length > 0) {
    lines.push(`  - Common openers: ${idio.commonOpeners.join(', ')}`);
  }
  if (idio.commonClosers.length > 0) {
    lines.push(`  - Common closers: ${idio.commonClosers.join(', ')}`);
  }

  lines.push('');
  lines.push('NUMBERS AND CORRECTIONS:');
  lines.push(
    `  - Number hedging: ${Math.round(idio.hedgingRatio * 100)}% of numbers are hedged ('about X', 'around Y'). Match this hedge ratio.`,
  );
  lines.push(
    `  - Self-correction frequency: ${idio.selfCorrectionCount} occurrences in sample.`,
  );

  lines.push('');
  lines.push('APPLICATION RULES:');
  lines.push(
    '  - Match these patterns approximately, not mechanically. If em dash usage',
  );
  lines.push(
    '    is 0.2 per 1000 words, use 0 in a 500-word post (matches the rate).',
  );
  lines.push('  - Filler words appear in % of posts, not every post. Vary use.');
  lines.push(
    '  - Lowercase first letter ratio is per post; use it as a probabilistic guide.',
  );

  return lines.join('\n');
}

function describeFrequency(per1000: number): string {
  if (per1000 === 0) return 'never used';
  if (per1000 < 0.5) return 'very rare';
  if (per1000 < 2) return 'occasional';
  if (per1000 < 5) return 'moderate';
  return 'frequent';
}

// ============================================================
// Staleness helper
// ============================================================

const STALE_DAYS = 7;

export function isIdiosyncrasiesStale(
  idio: VoiceIdiosyncrasies,
  asOf: Date = new Date(),
): boolean {
  const extractedAt = new Date(idio.extractedAt).getTime();
  const ageMs = asOf.getTime() - extractedAt;
  return ageMs > STALE_DAYS * 24 * 60 * 60 * 1000;
}
