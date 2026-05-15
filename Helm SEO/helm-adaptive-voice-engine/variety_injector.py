"""
variety_injector.py
====================

Probabilistic variety injection for content generation.

The system tracks which post archetypes a client has used recently, and
periodically (10-15% of generations) forces a deliberate variation: a
"variety mode" instruction that overrides the default content_type rules
and produces a structurally different output.

Default behavior:
  - 15% probability of variety injection per generation
  - Cooldown: 3 normal generations between variety injections
  - Selection: prefer archetypes not used in the last 10 posts
  - First 5 posts on a platform: no variety injection (cold start)

Version: 1.0 (Phase 1.5)
"""

from __future__ import annotations

import random
from datetime import datetime, timezone

from client_context import (
    ArchetypeUsage,
    PlatformSlots,
    PostArchetype,
    VarietyConfig,
)


# ============================================================================
# Variety mode instructions
#
# When the variety injector decides to fire, it picks an archetype and the
# corresponding instruction below gets appended to the generation prompt.
# These instructions OVERRIDE the default content_type rules for that one
# generation.
# ============================================================================

VARIETY_MODE_INSTRUCTIONS: dict[PostArchetype, str] = {

    PostArchetype.ESSAY: """
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
""",

    PostArchetype.SHITPOST: """
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
""",

    PostArchetype.CONTRARIAN: """
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
""",

    PostArchetype.VULNERABLE: """
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
""",

    PostArchetype.DATA_DROP: """
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
""",

    PostArchetype.STORY: """
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
""",

    PostArchetype.QUESTION: """
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
""",

    PostArchetype.OBSERVATION: """
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
""",

    PostArchetype.META: """
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
""",
}


# ============================================================================
# Selection + injection logic
# ============================================================================

MIN_POSTS_BEFORE_VARIETY = 5


def should_inject_variety(
    slots: PlatformSlots,
    config: VarietyConfig,
    rng: random.Random | None = None,
) -> bool:
    """Decide whether this generation should inject variety mode.

    Returns False if:
      - variety is disabled per config
      - client has < MIN_POSTS_BEFORE_VARIETY on this platform (cold start)
      - cooldown is active (recent variety post within last cooldown_after_variety posts)
      - probabilistic roll fails

    The rng arg lets tests inject deterministic randomness.
    """
    if not config.enabled:
        return False
    if slots.post_count < MIN_POSTS_BEFORE_VARIETY:
        return False

    # Cooldown check
    recent = slots.recent_post_archetypes[-config.cooldown_after_variety:]
    if any(usage.was_variety_injected for usage in recent):
        return False

    rng = rng or random
    return rng.random() < config.injection_probability


def select_variety_archetype(
    slots: PlatformSlots,
    config: VarietyConfig,
    rng: random.Random | None = None,
) -> PostArchetype:
    """Pick which variety archetype to inject.

    Strategy: prefer archetypes NOT used in the recent sliding window. If all
    archetypes have been used, pick the least recently used one.
    """
    rng = rng or random
    recent_window = slots.recent_post_archetypes[-config.sliding_window_size:]
    recent_archetypes = {usage.archetype for usage in recent_window}

    all_archetypes = set(PostArchetype)
    available = all_archetypes - recent_archetypes

    if available:
        return rng.choice(sorted(available, key=lambda a: a.value))

    # All archetypes used recently. Pick least recently used.
    last_used: dict[PostArchetype, datetime] = {}
    for usage in recent_window:
        last_used[usage.archetype] = usage.used_at

    return min(last_used.keys(), key=lambda a: last_used[a])


def get_variety_instruction(archetype: PostArchetype) -> str:
    """Return the prompt-injection text for the given archetype."""
    return VARIETY_MODE_INSTRUCTIONS.get(archetype, "")


def record_archetype_usage(
    slots: PlatformSlots,
    archetype: PostArchetype,
    was_variety_injected: bool,
    config: VarietyConfig,
) -> None:
    """Append a new ArchetypeUsage to the sliding window. Mutates in place."""
    slots.recent_post_archetypes.append(
        ArchetypeUsage(
            archetype=archetype,
            used_at=datetime.now(timezone.utc),
            was_variety_injected=was_variety_injected,
        )
    )
    # Trim to window size
    max_window = max(config.sliding_window_size * 2, 20)
    if len(slots.recent_post_archetypes) > max_window:
        slots.recent_post_archetypes = slots.recent_post_archetypes[-max_window:]
