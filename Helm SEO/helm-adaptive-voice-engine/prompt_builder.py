"""
prompt_builder.py
=================

Builds the final generation prompt by composing static rules + dynamic client
context (Helm Adaptive Voice Engine v1.0 MVP).

This is the entry point called by the content generation pipeline. It pulls the
static scaffold from platform_tone_instructions.py and overlays the
client-specific dynamic context from ClientContext.

Replaces the standalone build_generation_prompt() that lived in
platform_tone_instructions.py. Now context-aware.

Output convention:
  The model returns the final draft. If any learned_override was applied that
  contradicts a CONTENT_TYPE_RULES or PLATFORM_TONE default, the model appends:

      <override_log>
      dimension=hook_length, applied=7, default=10, confidence=0.82
      dimension=cta_style, applied=question, default=statement, confidence=0.91
      </override_log>

  These tags are parsed by parse_override_log() and added to the audit log
  automatically.

Version: 1.0 (MVP Phase 1)
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

from client_context import ClientContext, ContentType, Platform

# Phase 2 (Patch 2): the bridge matcher's LLMClient Protocol is only
# referenced as a type annotation, not at runtime. Importing under
# TYPE_CHECKING keeps prompt_builder runtime-light and avoids triggering
# the matcher's pydantic import when the caller hasn't opted into the
# bridge flow.
if TYPE_CHECKING:
    from product_bridge_matcher import LLMClient as BridgeMatcherClient

# Import the static scaffold. Adjust the import path when you move the file
# into your codebase.
from platform_tone_instructions import (
    CONTENT_TYPE_EXAMPLES,
    CONTENT_TYPE_RULES,
    PLATFORM_CONTENT_COMPATIBILITY,
    PLATFORM_TONE_INSTRUCTIONS,
    PROMPT_COMPOSITION_RULES,
)


# ============================================================================
# Public API
# ============================================================================

async def build_generation_prompt(
    *,
    platform: Platform,
    content_type: ContentType,
    client_context: ClientContext,
    pain_point: str,
    target_sub: str | None = None,
    include_examples: bool = True,
    inject_humanize: bool = True,
    bridge_matcher_client: "BridgeMatcherClient | None" = None,
) -> str:
    """Compose the full generation prompt for the model.

    Stacks PROMPT_COMPOSITION_RULES, the dynamic client context block,
    PAIN_POINT, CONTENT_TYPE_RULES (+ optional examples), and PLATFORM_TONE,
    in the precedence order defined by PROMPT_COMPOSITION_RULES.

    Async because the optional bridge matcher (Phase 2 / Patch 2) runs a
    Haiku call when supplied. With bridge_matcher_client=None the call
    does no I/O — async is still required so the signature stays stable
    when the bridge flow is opted in.

    Args:
        platform:              target platform
        content_type:          target content type
        client_context:        the ClientContext aggregate for this client
        pain_point:            what this post is about (from research/insight
                               pipeline)
        target_sub:            for Reddit, the target subreddit (e.g., "r/SaaS")
        include_examples:      whether to inject CONTENT_TYPE_EXAMPLES. Default
                               True. Toggle False in dev/test for shorter
                               prompts and faster iteration. Quality drops
                               measurably when off.
        inject_humanize:       Phase 2 — F1 preventive humanize. When True
                               (default), HUMANIZE_RULES are embedded directly
                               in the prompt so the model never produces an AI
                               tell to clean up. Toggle False to run the legacy
                               generate-then-clean flow during A/B comparison.
        bridge_matcher_client: Phase 2 (Patch 2). Optional LLMClient adapter
                               used by product_bridge_matcher to pick the best
                               pain → product bridge for this post. When
                               provided AND the client has approved bridges,
                               a PRODUCT_RELEVANCE section is injected between
                               PAIN_POINT and CONTENT_TYPE_RULES. When None,
                               the bridge flow is fully skipped (no I/O, no
                               behavior change).

    Raises:
        ValueError if the (platform, content_type) combination isn't compatible
        or if either value is unknown.
    """
    # Phase 2 — F1: prompt-time import of the humanize rules. Local import
    # so the dependency is only loaded when injection is requested AND so
    # platform_tone_instructions.py (which is imported at module load time)
    # doesn't have to take a hard runtime dependency on humanize_rules.
    from humanize_rules import HUMANIZE_RULES

    # Phase 1.5 — F4: variety injection. Probabilistic override of the
    # default content_type rules, chosen from PostArchetype rotation. The
    # caller is responsible for calling record_archetype_usage() AFTER the
    # post is actually published so we track shipped archetypes, not
    # generated ones.
    from variety_injector import (
        get_variety_instruction,
        select_variety_archetype,
        should_inject_variety,
    )

    platform_key = platform.value
    content_type_key = content_type.value

    _validate_combination(platform_key, content_type_key)

    slots = client_context.get_platform_slots(platform)
    variety_instruction = ""
    if should_inject_variety(slots, slots.variety_config):
        variety_archetype = select_variety_archetype(slots, slots.variety_config)
        variety_instruction = get_variety_instruction(variety_archetype)

    dynamic_context = _format_dynamic_context(client_context, platform)

    # Phase 2 — Patch 2: product bridge matching. Optional async LLM call
    # that picks the best pain → bridge match for this post and inserts a
    # PRODUCT_RELEVANCE section between PAIN_POINT and CONTENT_TYPE_RULES.
    # Skipped entirely when no client is supplied or the project has no
    # approved bridges — the matcher itself filters out pending_review
    # bridges, so an early empty-list check here just avoids the extra
    # function call.
    product_relevance_section = ""
    if bridge_matcher_client is not None:
        from product_bridge_matcher import (
            format_bridge_for_prompt,
            match_bridge_for_pain,
        )
        bridges = client_context.brand_bible.pain_to_product_bridges
        if bridges:
            match = await match_bridge_for_pain(
                pain_point=pain_point,
                available_bridges=bridges,
                client=bridge_matcher_client,
            )
            product_relevance_section = format_bridge_for_prompt(match)

    content_rules = CONTENT_TYPE_RULES[content_type_key]
    platform_tone = PLATFORM_TONE_INSTRUCTIONS[platform_key]
    sub_line = (
        f"\nTARGET SUBREDDIT: {target_sub}\n"
        if platform_key == "reddit" and target_sub
        else ""
    )

    examples_section = ""
    if include_examples:
        examples = CONTENT_TYPE_EXAMPLES.get(content_type_key, "").strip()
        if examples:
            examples_section = (
                f"\nCONTENT_TYPE_EXAMPLES for {content_type_key.upper()} "
                f"(good vs bad pairs to pattern-match against):\n{examples}\n"
            )

    humanize_section = ""
    if inject_humanize:
        humanize_section = f"\n\n{HUMANIZE_RULES}\n"

    base_prompt = f"""{PROMPT_COMPOSITION_RULES}{humanize_section}

CLIENT CONTEXT (apply strongly, this is the client-specific intelligence):
{dynamic_context}

PAIN_POINT (what this post is about):
{pain_point}
{sub_line}{product_relevance_section}
CONTENT_TYPE_RULES for {content_type_key.upper()} (base format mechanics):
{content_rules}
{examples_section}
PLATFORM_TONE for {platform_key.upper()} (specialization on top of content-type rules):
{platform_tone}

Now write the {content_type_key} for {platform_key}. After drafting, run BOTH
scan checklists (the CONTENT_TYPE_RULES checklist and the PLATFORM_TONE
checklist). If any item fails, regenerate.

If you applied any learned_override that contradicts a default in
CONTENT_TYPE_RULES or PLATFORM_TONE, append a structured log AFTER the draft:

<override_log>
dimension=<name>, applied=<value>, default=<value>, confidence=<0.0-1.0>
</override_log>

Include one line per override applied. Omit the entire tag block if no
overrides were applied.

Return: the final draft + (if any) the override_log block. No commentary,
no preamble.
"""

    # Phase 1.5 — F4: append the variety mode block (when fired) at the
    # very end so it overrides the structural defaults the model just
    # read. Placing it last guarantees recency-bias works in our favor —
    # the variety instruction is the last thing the model sees before
    # composing.
    if variety_instruction:
        base_prompt = f"{base_prompt}\n\n{variety_instruction}"

    return base_prompt


# ============================================================================
# Output parsing
# ============================================================================

OVERRIDE_LOG_PATTERN = re.compile(r"<override_log>(.*?)</override_log>", re.DOTALL)


def parse_override_log(model_output: str) -> tuple[str, list[dict[str, str]]]:
    """Strip <override_log> tags from the output and parse the entries.

    Returns:
        (clean_draft, records) where each record is a dict like:
            {"dimension": "hook_length", "applied": "7", "default": "10", "confidence": "0.82"}

    If no override_log block is present, returns (model_output.strip(), []).
    """
    match = OVERRIDE_LOG_PATTERN.search(model_output)
    if not match:
        return model_output.strip(), []

    raw_log = match.group(1).strip()
    clean = OVERRIDE_LOG_PATTERN.sub("", model_output).strip()

    records: list[dict[str, str]] = []
    for line in raw_log.split("\n"):
        line = line.strip()
        if not line:
            continue
        record: dict[str, str] = {}
        for pair in line.split(","):
            if "=" in pair:
                key, value = pair.split("=", 1)
                record[key.strip()] = value.strip()
        if record:
            records.append(record)

    return clean, records


# ============================================================================
# Internal helpers
# ============================================================================

def _validate_combination(platform_key: str, content_type_key: str) -> None:
    if platform_key not in PLATFORM_TONE_INSTRUCTIONS:
        raise ValueError(
            f"Unknown platform: {platform_key}. "
            f"Supported: {sorted(PLATFORM_TONE_INSTRUCTIONS.keys())}"
        )

    if content_type_key not in CONTENT_TYPE_RULES:
        raise ValueError(
            f"Unknown content_type: {content_type_key}. "
            f"Supported: {sorted(CONTENT_TYPE_RULES.keys())}"
        )

    if content_type_key not in PLATFORM_CONTENT_COMPATIBILITY[platform_key]:
        raise ValueError(
            f"Content type '{content_type_key}' not supported on platform '{platform_key}'. "
            f"Supported types for {platform_key}: {PLATFORM_CONTENT_COMPATIBILITY[platform_key]}"
        )


def _format_dynamic_context(context: ClientContext, platform: Platform) -> str:
    """Render the per-client context block as a string for the prompt."""
    bb = context.brand_bible
    voice_samples = context.get_voice_samples(platform, max_count=8)
    winning = context.get_recent_winning_patterns(platform, max_count=10)
    losing = context.get_recent_losing_patterns(platform, max_count=10)
    overrides = context.get_platform_slots(platform).learned_overrides
    voice_idiosyncrasies = context.get_platform_slots(platform).voice_idiosyncrasies

    lines: list[str] = [
        "BRAND_BIBLE:",
        f"  Voice: {bb.voice}",
        f"  Audience: {bb.audience}",
        f"  Positioning: {bb.positioning}",
        f"  Pillars: {', '.join(bb.pillars) if bb.pillars else '[none]'}",
        f"  Banned phrases: {bb.banned_phrases or '[none]'}",
        f"  Mandatory signals: {bb.mandatory_signals or '[none]'}",
    ]

    # Phase 1.5 — E1: inject the extracted writer voice profile BEFORE the
    # raw fingerprint samples so the model sees the structured rules first
    # and uses the samples as illustration of those rules. Skipped when
    # there are no idiosyncrasies extracted yet or when the cached profile
    # is older than ~30 days (stale rules underperform fresh ones).
    if voice_idiosyncrasies and not voice_idiosyncrasies.is_stale():
        from voice_idiosyncrasy_extractor import format_idiosyncrasies_as_prompt_rules
        lines.append("")
        lines.append(format_idiosyncrasies_as_prompt_rules(voice_idiosyncrasies))

    lines.extend([
        "",
        "VOICE_FINGERPRINT (writer's actual past output on this platform, sorted by weight):",
    ])

    if voice_samples:
        for i, sample in enumerate(voice_samples, 1):
            text = sample.text.replace("\n", " ")[:280]
            lines.append(f"  Sample {i} (weight={sample.weight:.2f}): {text}")
    else:
        lines.append("  [no samples yet for this platform; rely on BRAND_BIBLE and defaults]")

    lines.append("")
    lines.append("LEARNED_OVERRIDES (apply on top of platform/content defaults):")
    if overrides:
        for dimension, override in overrides.items():
            lines.append(
                f"  {dimension.value} = {override.value!r} "
                f"(confidence={override.confidence:.2f}, samples={override.sample_count}, "
                f"volatility={override.volatility.value})"
            )
    else:
        lines.append("  [none yet; system is still learning this platform]")

    lines.append("")
    lines.append("WINNING_PATTERNS (recent posts approved without edits or with high engagement):")
    if winning:
        for i, post in enumerate(winning[:5], 1):
            text = post.text.replace("\n", " ")[:200]
            lines.append(f"  Win {i}: {text}")
    else:
        lines.append("  [no winning patterns yet]")

    lines.append("")
    lines.append("LOSING_PATTERNS (recent posts rejected, edited heavily, or underperformed; DO NOT replicate):")
    if losing:
        for i, post in enumerate(losing[:5], 1):
            text = post.text.replace("\n", " ")[:200]
            lines.append(f"  Loss {i}: {text}")
    else:
        lines.append("  [no losing patterns yet]")

    lines.append("")
    lines.append("ANTI_SAMPLES_BY_DIMENSION (specific patterns to avoid, tagged by dimension):")
    if context.anti_samples:
        any_added = False
        for dimension, samples in context.anti_samples.items():
            if samples:
                lines.append(f"  {dimension.value}:")
                for sample in samples[:3]:
                    text = sample.text.replace("\n", " ")[:160]
                    lines.append(f"    - {text}")
                any_added = True
        if not any_added:
            lines.append("  [no anti-samples yet]")
    else:
        lines.append("  [no anti-samples yet]")

    return "\n".join(lines)
