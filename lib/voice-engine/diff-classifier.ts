// PR Sprint 7.16 — Heuristic diff classifier port.
//
// 1:1 translation of
// Helm SEO/helm-adaptive-voice-engine/diff_classifier.py.
// Detects 7 patterns in MVP:
//   1. Banned vocab (single words removed in edit)
//   2. Banned phrases (multi-word AI-isms removed)
//   3. Hook length delta
//   4. Emoji count delta
//   5. Hashtag count delta
//   6. CTA pattern shift (statement ↔ question)
//   7. Paragraph length drift
//
// Diffs that don't match any heuristic produce zero signals in
// MVP. The Python source has a stub _enqueue_for_llm_batch for
// Phase 1.5 (LLM batch classifier); we preserve the same stub as
// enqueueForLlmBatch so the call site is ready when we ship that
// worker.

import {
  newSignal,
  type ContentType,
  type Platform,
  type Signal,
} from './types';

// ============================================================
// Banned vocab targets — direct copy from the Python source.
// Known AI-isms that get edited out get higher confidence;
// less-common words get lower confidence so they need more
// samples before the override moves.
// ============================================================

const COMMON_AI_BUZZWORDS = new Set([
  'leverage',
  'harness',
  'unlock',
  'empower',
  'elevate',
  'streamline',
  'seamlessly',
  'effortlessly',
  'intuitively',
  'robust',
  'comprehensive',
  'holistic',
  'synergy',
  'navigate',
  'explore',
  'embark',
]);

const COMMON_AI_PHRASES: string[] = [
  'excited to share',
  'excited to announce',
  'thrilled to share',
  'thrilled to announce',
  'humbled to',
  'humbled by',
  'dive into',
  'delve into',
  'unpack',
  'uncover',
  'game-changer',
  'cutting-edge',
  'state-of-the-art',
  "in today's fast-paced world",
  'in the digital age',
  'at the end of the day',
  'at its core',
  'at the heart of',
  "it's worth noting that",
  "let's break it down",
  "let's unpack",
];

// ============================================================
// Tokenization helpers
//
// JS RegExp doesn't support Python's broad \w-with-unicode by
// default, but for the edits we're classifying (English-mostly)
// this is sufficient. Cross-language signal classification is a
// Phase 2 problem.
// ============================================================

const WORD_RE = /[A-Za-z0-9']+/g;
// Unicode property escapes catch emoji (BMP + supplementary).
// /u flag is required.
const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const HASHTAG_RE = /#\w+/g;

function tokenizeWords(text: string): string[] {
  return (text.toLowerCase().match(WORD_RE) ?? []).slice();
}

function countEmojis(text: string): number {
  return (text.match(EMOJI_RE) ?? []).length;
}

function countHashtags(text: string): number {
  return (text.match(HASHTAG_RE) ?? []).length;
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function firstLine(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  return trimmed.split('\n')[0];
}

function firstSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  const m = trimmed.match(/[.!?](\s|$)/);
  if (!m) return trimmed;
  // Index after the punctuation + matched trailing space if any.
  const endIdx = (m.index ?? 0) + m[0].length;
  return trimmed.slice(0, endIdx).trim();
}

// ============================================================
// Heuristics
// ============================================================

export interface ClassifyOpts {
  original: string;
  edited: string;
  platform: Platform;
  contentType: ContentType;
  postId?: string | null;
}

export function detectHookLengthChange(
  o: ClassifyOpts,
): Signal | null {
  const origHook = firstSentence(firstLine(o.original));
  const editedHook = firstSentence(firstLine(o.edited));
  const origWords = tokenizeWords(origHook).length;
  const editedWords = tokenizeWords(editedHook).length;
  if (origWords === 0 || Math.abs(editedWords - origWords) < 2) return null;
  return newSignal({
    source: 'edit_diff',
    platform: o.platform,
    contentType: o.contentType,
    dimension: 'hook_length',
    valueDelta: {
      original_hook_words: origWords,
      edited_hook_words: editedWords,
      delta: editedWords - origWords,
    },
    confidence: 0.85,
  });
}

export function detectBannedVocabChanges(o: ClassifyOpts): Signal[] {
  const orig = new Set(tokenizeWords(o.original));
  const edited = new Set(tokenizeWords(o.edited));
  const removed: string[] = [];
  for (const w of orig) if (!edited.has(w)) removed.push(w);
  return removed.map((word) =>
    newSignal({
      source: 'edit_diff',
      platform: o.platform,
      contentType: o.contentType,
      dimension: 'banned_vocab',
      valueDelta: {
        removed_word: word,
        is_known_buzzword: COMMON_AI_BUZZWORDS.has(word),
      },
      confidence: COMMON_AI_BUZZWORDS.has(word) ? 0.95 : 0.55,
    }),
  );
}

export function detectBannedPhraseChanges(o: ClassifyOpts): Signal[] {
  const origLower = o.original.toLowerCase();
  const editedLower = o.edited.toLowerCase();
  const signals: Signal[] = [];
  for (const phrase of COMMON_AI_PHRASES) {
    if (origLower.includes(phrase) && !editedLower.includes(phrase)) {
      signals.push(
        newSignal({
          source: 'edit_diff',
          platform: o.platform,
          contentType: o.contentType,
          dimension: 'banned_vocab',
          valueDelta: {
            removed_phrase: phrase,
            is_known_buzzword: true,
          },
          confidence: 0.98,
        }),
      );
    }
  }
  return signals;
}

export function detectEmojiCountChange(o: ClassifyOpts): Signal | null {
  const orig = countEmojis(o.original);
  const edited = countEmojis(o.edited);
  if (orig === edited) return null;
  return newSignal({
    source: 'edit_diff',
    platform: o.platform,
    contentType: o.contentType,
    dimension: 'emoji_usage',
    valueDelta: {
      original_emoji_count: orig,
      edited_emoji_count: edited,
      delta: edited - orig,
    },
    confidence: 0.9,
  });
}

export function detectHashtagCountChange(o: ClassifyOpts): Signal | null {
  const orig = countHashtags(o.original);
  const edited = countHashtags(o.edited);
  if (orig === edited) return null;
  return newSignal({
    source: 'edit_diff',
    platform: o.platform,
    contentType: o.contentType,
    dimension: 'hashtag_strategy',
    valueDelta: {
      original_hashtag_count: orig,
      edited_hashtag_count: edited,
      delta: edited - orig,
    },
    confidence: 0.9,
  });
}

export function detectCtaPatternShift(o: ClassifyOpts): Signal | null {
  const origLines = o.original.trim().split('\n');
  const editedLines = o.edited.trim().split('\n');
  const origLast = origLines.length ? origLines[origLines.length - 1] : '';
  const editedLast = editedLines.length
    ? editedLines[editedLines.length - 1]
    : '';
  const origIsQuestion = origLast.trimEnd().endsWith('?');
  const editedIsQuestion = editedLast.trimEnd().endsWith('?');
  if (origIsQuestion === editedIsQuestion) return null;
  return newSignal({
    source: 'edit_diff',
    platform: o.platform,
    contentType: o.contentType,
    dimension: 'cta_style',
    valueDelta: {
      original_was_question: origIsQuestion,
      edited_is_question: editedIsQuestion,
      preferred_style: editedIsQuestion ? 'question' : 'statement',
    },
    confidence: 0.75,
  });
}

export function detectParagraphLengthChange(o: ClassifyOpts): Signal | null {
  const origParas = splitParagraphs(o.original);
  const editedParas = splitParagraphs(o.edited);
  if (origParas.length === 0 || editedParas.length === 0) return null;
  const origAvg =
    origParas.reduce((sum, p) => sum + tokenizeWords(p).length, 0) /
    origParas.length;
  const editedAvg =
    editedParas.reduce((sum, p) => sum + tokenizeWords(p).length, 0) /
    editedParas.length;
  if (Math.abs(editedAvg - origAvg) < 5) return null;
  return newSignal({
    source: 'edit_diff',
    platform: o.platform,
    contentType: o.contentType,
    dimension: 'paragraph_length',
    valueDelta: {
      original_avg_words: Math.round(origAvg * 10) / 10,
      edited_avg_words: Math.round(editedAvg * 10) / 10,
      delta: Math.round((editedAvg - origAvg) * 10) / 10,
    },
    confidence: 0.7,
  });
}

const SINGLE_SIGNAL_HEURISTICS: Array<(o: ClassifyOpts) => Signal | null> = [
  detectHookLengthChange,
  detectEmojiCountChange,
  detectHashtagCountChange,
  detectCtaPatternShift,
  detectParagraphLengthChange,
];

// ============================================================
// Main entry point
// ============================================================

export function classifyDiff(opts: ClassifyOpts): Signal[] {
  if (opts.original.trim() === opts.edited.trim()) return [];

  const signals: Signal[] = [];
  // Multi-signal heuristics first (banned vocab + phrases).
  signals.push(...detectBannedVocabChanges(opts));
  signals.push(...detectBannedPhraseChanges(opts));
  // Single-signal heuristics.
  for (const fn of SINGLE_SIGNAL_HEURISTICS) {
    const s = fn(opts);
    if (s) signals.push(s);
  }
  // Attach post_id when caller provided one.
  const withPostId: Signal[] = opts.postId
    ? signals.map((s) => ({ ...s, postId: opts.postId! }))
    : signals;
  // Stub: queue unclassified diffs for future LLM batch.
  if (withPostId.length === 0) {
    enqueueForLlmBatch(opts);
  }
  return withPostId;
}

// Stub for Phase 1.5 LLM batch classifier. No-op in MVP.
function enqueueForLlmBatch(_opts: ClassifyOpts): void {
  // In Phase 1.5: persist (original, edited, platform,
  // content_type) to a job queue. A nightly worker runs an LLM
  // classifier and emits supplemental signals into the feedback
  // loop. For MVP we drop the diff silently.
  return;
}
