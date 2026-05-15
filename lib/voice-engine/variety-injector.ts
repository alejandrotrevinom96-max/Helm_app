// PR Sprint 7.22 Sprint E.1 — F4 variety injection (TS port of
// Helm SEO/helm-adaptive-voice-engine/variety_injector.py).
//
// Probabilistic variety injection for content generation. The
// system tracks which post archetypes a project has used recently
// on each platform, and ~15% of generations forces a different
// archetype so the feed has range (shitposts, contrarian takes,
// vulnerable confessions, data drops) instead of 100% structured
// essays.
//
// Cold-start guard: don't fire variety until the project has at
// least MIN_POSTS_BEFORE_VARIETY archetype usages. New projects
// build up their default voice first; variety only makes sense
// once there IS a default to break from.
//
// Cooldown: after a variety injection, skip variety for the next
// N normal generations so the feed doesn't oscillate.
//
// Canonical TS source-of-truth. Python upstream at
// lib/voice-engine/variety_injector.py (and
// Helm SEO/helm-adaptive-voice-engine/) MUST stay in lockstep.

import type {
  ArchetypeUsage,
  PostArchetype,
  VarietyConfig,
} from '@/lib/types/brand';
import { defaultVarietyConfig } from '@/lib/types/brand';

// ============================================================
// VARIETY_MODE_INSTRUCTIONS — one per archetype
// ============================================================

const ESSAY_INSTRUCTION = `
==============================================
VARIETY MODE: ESSAY (override default rules)
==============================================

This generation is a structured essay. This is also the default mode; the
content_type rules already encode essay shape, so the only thing this
instruction does is confirm the default and reject mid-flight drift into
shitpost/shortform.

  - Use the full structure that content_type_rules describes.
  - Headers, body paragraphs, and a CTA all present.
  - Voice can still be casual but structure stays.

The point: when variety lands on ESSAY, the model is being told "stay the
course". No override beyond reaffirming the default.
`;

const SHITPOST_INSTRUCTION = `
==============================================
VARIETY MODE: SHITPOST (override default rules)
==============================================

This generation is a shitpost. Override the default CONTENT_TYPE_RULES and
PLATFORM_TONE structure rules. For this one post only:

  - Maximum 50 words total. Hard cap.
  - No headers, no bullets, no structure.
  - One single observation, not a structured argument.
  - Lowercase first letter is mandatory.
  - Fragmentary sentences only. Acceptable to end mid-thought.
  - No CTA. No question. No call to engage.
  - Acceptable to be slightly absurd or self-deprecating.

The point: shitposts are observations someone has at 2am that they ship
without polishing. Do not polish.

Examples of shape (not content):
  - "the marketing tool that finally made me happy is the one i deleted"
  - "spent 3 hours optimizing my analytics dashboard. zero people read it."
  - "every founder writes the same linkedin post on tuesday and i hate that i'm one of them"
`;

const CONTRARIAN_INSTRUCTION = `
==============================================
VARIETY MODE: CONTRARIAN (override default rules)
==============================================

This generation takes a contrarian position. Override the default tone
toward warmth/balance. For this one post only:

  - Open with the unpopular take in the first 10 words.
  - Acceptable openers: "hot take:", "unpopular opinion:", "everyone's wrong about X",
    "I'm going to get pushback for this but"
  - Do NOT soften the take in the body. The take is the thesis.
  - Body should defend the take with one specific reason or example, not three.
  - End with a challenge or restatement, not a polite question.
  - Acceptable to acknowledge that some readers will disagree.

The point: contrarian posts move the needle because they take a position.
Do not hedge. Do not "balance perspectives". Take the side and defend it.
`;

const VULNERABLE_INSTRUCTION = `
==============================================
VARIETY MODE: VULNERABLE (override default rules)
==============================================

This generation is a vulnerable confession. Override the default tone
toward authority/confidence. For this one post only:

  - Open with admission, not a hook. Examples: "I lost $X last month",
    "I've been hiding this for 6 months", "I think I made the wrong call"
  - First-person throughout. Specific failure or doubt, not generic struggle.
  - No "lessons learned" section. Vulnerable posts don't tie up neatly.
  - Acceptable to admit you don't know what to do next.
  - End in uncertainty, not resolution.

The point: vulnerable posts build trust because they break the polish.
Do not turn vulnerability into a teaching moment.
`;

const DATA_DROP_INSTRUCTION = `
==============================================
VARIETY MODE: DATA_DROP (override default rules)
==============================================

This generation is data-forward. Override the default story-led structure.
For this one post only:

  - Open with a specific number in the first 8 words.
  - Body is 80% numbers/data, 20% interpretation.
  - Use bullet points for the numbers (this is one case where bullets win).
  - Each number needs context (timeframe, sample size, source).
  - Numbers should not be hedged in this mode. Precision is the value.
  - End with the most surprising number, not a CTA.

The point: data drops earn engagement because they reduce the reader's
uncertainty. Lead with the number. Defend it with method.
`;

const STORY_INSTRUCTION = `
==============================================
VARIETY MODE: STORY (override default rules)
==============================================

This generation is narrative-driven. Override the default insight-first
structure. For this one post only:

  - Open with a specific scene: time, place, action. "It was 2am. Tuesday."
  - Body unfolds chronologically. No flashbacks, no jumps.
  - Use sensory details (what you saw, what you heard, what you felt).
  - One climactic moment, then a brief resolution.
  - The "lesson" emerges from the story, not stated directly.
  - End on the resolution, not on a generalization.

The point: stories engage because they let the reader inhabit a moment.
Show the moment. Trust the reader to extract the meaning.
`;

const QUESTION_INSTRUCTION = `
==============================================
VARIETY MODE: QUESTION (override default rules)
==============================================

This generation is genuinely asking the audience. Override the default
"I have an insight" framing. For this one post only:

  - Open with the question itself in the first line.
  - Provide 2-4 sentences of context for WHY you're asking.
  - Acceptable to admit you don't know the answer.
  - Do NOT include your own preliminary opinion (that biases the responses).
  - End with the question repeated or a "genuinely asking" marker.

The point: real questions earn replies because the reader can contribute.
Stated opinions disguised as questions get ignored.
`;

const OBSERVATION_INSTRUCTION = `
==============================================
VARIETY MODE: OBSERVATION (override default rules)
==============================================

This generation is a quick noticing. Override the default fully-developed
argument structure. For this one post only:

  - Maximum 100 words total.
  - Open with the observation itself ("I noticed", "weird thing", "thinking about how").
  - One observation, not three.
  - No CTA. The observation IS the post.
  - Acceptable to leave it slightly open-ended.

The point: observations earn engagement because they invite the reader to
notice the same thing. Do not over-explain.
`;

const META_INSTRUCTION = `
==============================================
VARIETY MODE: META (override default rules)
==============================================

This generation reflects on the work itself. Override the default subject-
focused framing. For this one post only:

  - Topic is the writer's relationship with the work (writing, marketing,
    building, posting).
  - First-person, present-tense.
  - Acceptable to be slightly philosophical without being grandiose.
  - Do NOT include a tactical takeaway. Meta posts don't teach tactics.
  - End on the tension or the question of the meta-observation.

The point: meta posts work because they signal self-awareness. Do not
turn the meta into a productivity tip.
`;

const VARIETY_MODE_INSTRUCTIONS: Record<PostArchetype, string> = {
  essay: ESSAY_INSTRUCTION,
  shitpost: SHITPOST_INSTRUCTION,
  contrarian: CONTRARIAN_INSTRUCTION,
  vulnerable: VULNERABLE_INSTRUCTION,
  observation: OBSERVATION_INSTRUCTION,
  data_drop: DATA_DROP_INSTRUCTION,
  story: STORY_INSTRUCTION,
  question: QUESTION_INSTRUCTION,
  meta: META_INSTRUCTION,
};

export function getVarietyInstruction(archetype: PostArchetype): string {
  return VARIETY_MODE_INSTRUCTIONS[archetype] ?? '';
}

const ALL_ARCHETYPES: PostArchetype[] = [
  'essay',
  'shitpost',
  'contrarian',
  'vulnerable',
  'observation',
  'data_drop',
  'story',
  'question',
  'meta',
];

// ============================================================
// Selection logic
// ============================================================

// Cold start: variety doesn't fire until the project has at least
// this many archetype usages. Lets the founder's default voice
// establish first.
const MIN_POSTS_BEFORE_VARIETY = 5;

export interface ShouldInjectArgs {
  recentArchetypes: readonly ArchetypeUsage[];
  config?: Partial<VarietyConfig>;
  // Override the RNG for deterministic testing. Production callers
  // omit this and the global Math.random is used.
  rng?: () => number;
}

/**
 * Decide whether this generation should inject variety mode.
 *
 * Returns false when:
 *   - variety is disabled in config
 *   - cold start (< MIN_POSTS_BEFORE_VARIETY total archetype usages)
 *   - cooldown active (any of the last N usages was variety-injected)
 *   - probabilistic roll fails
 */
export function shouldInjectVariety(args: ShouldInjectArgs): boolean {
  const config = { ...defaultVarietyConfig(), ...(args.config ?? {}) };
  if (!config.enabled) return false;

  const usages = args.recentArchetypes;
  if (usages.length < MIN_POSTS_BEFORE_VARIETY) return false;

  // Cooldown check — look at the last `cooldownAfterVariety` entries.
  // If ANY of them was variety-injected, skip this generation.
  const cooldownWindow = usages.slice(-config.cooldownAfterVariety);
  if (cooldownWindow.some((u) => u.wasVarietyInjected)) return false;

  const rng = args.rng ?? Math.random;
  return rng() < config.injectionProbability;
}

export interface SelectArgs {
  recentArchetypes: readonly ArchetypeUsage[];
  config?: Partial<VarietyConfig>;
  rng?: () => number;
}

/**
 * Pick the variety archetype to inject this generation.
 *
 * Prefers archetypes NOT used in the sliding window. Falls back to
 * least-recently-used when every archetype has been seen recently.
 * Never returns ESSAY — variety means "not the default".
 */
export function selectVarietyArchetype(args: SelectArgs): PostArchetype {
  const config = { ...defaultVarietyConfig(), ...(args.config ?? {}) };
  const rng = args.rng ?? Math.random;

  const window = args.recentArchetypes.slice(-config.slidingWindowSize);
  const recentSet = new Set(window.map((u) => u.archetype));

  const nonEssay = ALL_ARCHETYPES.filter((a) => a !== 'essay');
  const available = nonEssay.filter((a) => !recentSet.has(a));

  if (available.length > 0) {
    // Sort for deterministic ordering, then pick at random from the
    // unused set so two-archetype rotations don't lock in.
    const sorted = [...available].sort();
    const idx = Math.floor(rng() * sorted.length);
    return sorted[idx] ?? sorted[0]!;
  }

  // All archetypes used recently. Pick the least recently used.
  const lastUsed: Partial<Record<PostArchetype, string>> = {};
  for (const u of window) {
    lastUsed[u.archetype] = u.usedAt;
  }
  // Sort by usedAt ascending (oldest first), filter to non-essay.
  const lru = nonEssay
    .map((a) => ({ archetype: a, usedAt: lastUsed[a] ?? '' }))
    .sort((x, y) => x.usedAt.localeCompare(y.usedAt));
  return lru[0]?.archetype ?? 'shitpost';
}

// ============================================================
// Recording usage
// ============================================================

/**
 * Append a new ArchetypeUsage to the sliding window and trim it to
 * a sensible max length. Pure function — returns the new array,
 * doesn't mutate.
 */
export function recordArchetypeUsage(
  current: readonly ArchetypeUsage[],
  archetype: PostArchetype,
  wasVarietyInjected: boolean,
  config?: Partial<VarietyConfig>,
): ArchetypeUsage[] {
  const cfg = { ...defaultVarietyConfig(), ...(config ?? {}) };
  const next: ArchetypeUsage[] = [
    ...current,
    {
      archetype,
      usedAt: new Date().toISOString(),
      wasVarietyInjected,
    },
  ];
  // Trim to 2× window size or 20 (whichever larger) to keep the
  // brandContext jsonb reasonably bounded.
  const cap = Math.max(cfg.slidingWindowSize * 2, 20);
  if (next.length > cap) {
    return next.slice(-cap);
  }
  return next;
}
