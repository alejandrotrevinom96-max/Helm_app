import type Anthropic from '@anthropic-ai/sdk';
import {
  anthropic,
  cachedSystem,
  cachedUserMessage,
  logCacheStats,
  MODELS,
} from '@/lib/ai/claude';
import type { BrandBible } from '@/lib/types/brand';

export interface ScoreBreakdown {
  voice: number; // 0-10
  vocabulary: number;
  nonNegotiables: number;
  pillarAlignment: number;
  audienceResonance: number;
}

export interface ConsistencyScore {
  total: number; // 0-100
  breakdown: ScoreBreakdown;
  violations: string[];
  suggestions: string[];
}

// Voice carries the largest weight because the audience perceives tone
// before they parse vocabulary or non-negotiables. Non-negotiables and
// pillars are next — those are the brand's hard rules and core attributes.
// Audience resonance is last because it's the fuzziest dimension to score.
const WEIGHTS = {
  voice: 0.35,
  vocabulary: 0.15,
  nonNegotiables: 0.2,
  pillarAlignment: 0.2,
  audienceResonance: 0.1,
};

const NEUTRAL_BREAKDOWN: ScoreBreakdown = {
  voice: 7,
  vocabulary: 7,
  nonNegotiables: 7,
  pillarAlignment: 7,
  audienceResonance: 7,
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function neutralScore(reason: string): ConsistencyScore {
  return {
    total: 70,
    breakdown: NEUTRAL_BREAKDOWN,
    violations: [reason],
    suggestions: [],
  };
}

export async function computeConsistencyScore(
  postContent: string,
  bible: BrandBible | null,
  pillarFocus?: string
): Promise<ConsistencyScore> {
  // No bible = nothing to score against. Neutral total so the UI doesn't
  // mark the post as bad just because the user hasn't configured anything.
  if (!bible || !bible.identity) {
    return neutralScore('No brand bible to evaluate against');
  }

  const pillars = (bible.pillars ?? []).map((p) => p.name).join(', ') || '(none)';
  const banned =
    (bible.vocabulary?.bannedTerms ?? []).map((t) => t.term).join(', ') || '(none)';
  const preferred =
    (bible.vocabulary?.preferredTerms ?? []).map((t) => t.term).join(', ') ||
    '(none)';
  const nonNeg = (bible.nonNegotiables ?? []).join(' | ') || '(none)';
  const topPain = bible.audience?.primary?.painPoints?.[0]?.pain ?? '(unknown)';

  // PR #35 — Sprint 6.3: split into system + user blocks so prompt
  // caching can reuse the bible across the 3 drafts × N platforms a
  // single Generate click produces. The system prompt holds the
  // scoring rubric (stable across all calls). The user message has
  // TWO blocks: bible (cached) + post-to-evaluate (dynamic).
  const SYSTEM_PROMPT = `You are a brand quality auditor. Evaluate posts against the provided brand bible. Output STRICTLY valid JSON in this shape:

{
  "voice": 0-10 (does it match the voice spectrum?),
  "vocabulary": 0-10 (uses preferred, avoids banned?),
  "nonNegotiables": 0-10 (10 if no violations, 0 if violates one),
  "pillarAlignment": 0-10 (does it embody the pillar(s)?),
  "audienceResonance": 0-10 (would the audience care about this?),
  "violations": [string] (specific things wrong, max 5),
  "suggestions": [string] (specific improvements, max 3)
}

Be strict but fair. Penalize banned-term hits hard (vocabulary score). Reward authentic voice that matches the calibration sliders. No preamble, no markdown fences.`;

  const bibleBlock = `═══════ BRAND BIBLE ═══════

Archetype: ${bible.archetype?.primary ?? 'unknown'}
Voice (0=left, 10=right):
- Casual ↔ Formal: ${bible.voice?.formal ?? 5}/10
- Playful ↔ Serious: ${bible.voice?.serious ?? 5}/10
- Reserved ↔ Bold: ${bible.voice?.bold ?? 5}/10

Pillars: ${pillars}
Banned terms: ${banned}
Preferred terms: ${preferred}
Non-negotiables: ${nonNeg}

Audience: ${bible.audience?.primary?.description ?? '(unknown)'}
Top pain: ${topPain}`;

  const postBlock = `═══════ POST TO EVALUATE ═══════

${pillarFocus ? `(this draft was written to lean into pillar: ${pillarFocus})\n\n` : ''}${postContent}`;

  let response: Anthropic.Message;
  try {
    response = await anthropic.messages.create({
      model: MODELS.HAIKU,
      max_tokens: 1500,
      system: cachedSystem(SYSTEM_PROMPT),
      messages: [
        {
          role: 'user',
          // First block (bible) gets cache_control; second block (post)
          // is dynamic so the cache prefix ends right before it.
          content: cachedUserMessage(bibleBlock, postBlock),
        },
      ],
    });
    logCacheStats('consistency-score', response.usage);
    void import('./usage-tracker').then(({ trackUsage }) =>
      trackUsage({
        endpoint: 'consistency-score',
        model: MODELS.HAIKU,
        usage: response.usage,
      })
    );
  } catch {
    return neutralScore('Score evaluation failed');
  }

  const textBlock = response.content.find((b) => b.type === 'text');
  let raw = textBlock?.type === 'text' ? textBlock.text.trim() : '';
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return neutralScore('Could not parse evaluation');
  }

  const breakdown: ScoreBreakdown = {
    voice: clamp(Number(parsed.voice ?? 7), 0, 10),
    vocabulary: clamp(Number(parsed.vocabulary ?? 7), 0, 10),
    nonNegotiables: clamp(Number(parsed.nonNegotiables ?? 7), 0, 10),
    pillarAlignment: clamp(Number(parsed.pillarAlignment ?? 7), 0, 10),
    audienceResonance: clamp(Number(parsed.audienceResonance ?? 7), 0, 10),
  };

  const total = Math.round(
    (breakdown.voice * WEIGHTS.voice +
      breakdown.vocabulary * WEIGHTS.vocabulary +
      breakdown.nonNegotiables * WEIGHTS.nonNegotiables +
      breakdown.pillarAlignment * WEIGHTS.pillarAlignment +
      breakdown.audienceResonance * WEIGHTS.audienceResonance) *
      10
  );

  const violations = Array.isArray(parsed.violations)
    ? (parsed.violations as unknown[]).filter((v): v is string => typeof v === 'string').slice(0, 5)
    : [];
  const suggestions = Array.isArray(parsed.suggestions)
    ? (parsed.suggestions as unknown[]).filter((s): s is string => typeof s === 'string').slice(0, 3)
    : [];

  return {
    total: clamp(total, 0, 100),
    breakdown,
    violations,
    suggestions,
  };
}
