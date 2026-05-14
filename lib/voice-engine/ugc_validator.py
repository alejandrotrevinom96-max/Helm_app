"""
ugc_validator.py
================

Server-side soft validation of UGC bundles after generation.

Pydantic enforces the JSON schema (field types, lengths, ranges, sequential
beat numbering). This module catches the rules that depend on cross-field
relationships, platform-specific norms, or qualitative checks Pydantic alone
can't express.

Usage:
    from ugc_schema import UGCBundle
    from ugc_validator import validate_ugc_bundle

    bundle = UGCBundle.model_validate_json(model_output)  # Pydantic schema check
    failures = validate_ugc_bundle(bundle)                # Soft checks
    if failures:
        # Send failures back to the model for regeneration
        ...

Version: 2.0 (hook specificity score + sales-disguised CTA detector)
"""

from __future__ import annotations

import re

from ugc_schema import UGCBundle


# ============================================================================
# Constants for hook specificity scoring
# ============================================================================

NUMBER_PATTERN = re.compile(
    r"\b\d+(?:[.,]\d+)?(?:k|m|hrs?|min|seconds?|secs?|years?|months?|weeks?|days?|x|%)?\b",
    re.IGNORECASE,
)
DOLLAR_PATTERN = re.compile(r"\$\d+(?:[.,]\d+)?[km]?", re.IGNORECASE)

CONFESSION_VERBS: set[str] = {
    "used to", "dropped", "deleted", "spent", "wasted", "quit",
    "stopped", "killed", "switched", "ditched", "fired", "tried",
    "failed", "lost", "missed", "ignored", "regret", "burned",
}

NAMED_ENTITY_TOOLS: set[str] = {
    "buffer", "hootsuite", "chatgpt", "claude", "gemini", "notion",
    "reddit", "twitter", "linkedin", "tiktok", "instagram", "threads",
    "facebook", "vercel", "supabase", "stripe", "canva", "figma",
    "google", "youtube", "slack", "discord", "github", "intercom",
    "hubspot", "salesforce", "airtable", "zapier", "make.com",
    "n8n", "openai", "anthropic", "perplexity", "midjourney", "fal",
    "heygen", "loom", "calendly", "shopify", "webflow", "framer",
}

VAGUE_NOUNS: set[str] = {
    "thing", "things", "stuff", "something", "anything", "everything",
    "nothing",
}


# ============================================================================
# Sales-disguised CTA constants
# ============================================================================

SALES_CTA_PHRASES: tuple[str, ...] = (
    "check out", "learn more", "click the link", "click below",
    "sign up", "subscribe", "purchase", "buy now", "get yours",
    "limited time", "don't miss", "act now", "swipe up to",
    "link in bio to buy", "link in bio to purchase", "visit our website",
    "visit my site", "shop now", "use code", "discount code",
    "promo code", "order now", "claim your", "grab yours",
)


# ============================================================================
# Public API
# ============================================================================

def validate_ugc_bundle(bundle: UGCBundle) -> list[str]:
    """Run all soft validation rules against a UGCBundle.

    Pydantic already enforced the schema. These checks catch the rules that
    depend on cross-field relationships, platform-specific norms, or content
    quality heuristics.

    Returns:
        Empty list if all validations pass. Otherwise, list of human-readable
        failure messages suitable to send back to the model for regeneration.
    """
    failures: list[str] = []

    failures.extend(_check_total_duration(bundle))
    failures.extend(_check_overlay_timing_within_video(bundle))
    failures.extend(_check_overlay_not_verbatim_repeat(bundle))
    failures.extend(_check_caption_not_summary(bundle))
    failures.extend(_check_hook_quality(bundle))
    failures.extend(_check_hook_specificity(bundle))
    failures.extend(_check_cta_not_sales_disguised(bundle))
    failures.extend(_check_swipe_test_self_report(bundle))

    return failures


# ============================================================================
# Public API
# ============================================================================

def validate_ugc_bundle(bundle: UGCBundle) -> list[str]:
    """Run all soft validation rules against a UGCBundle.

    Pydantic already enforced the schema. These checks catch the rules that
    depend on cross-field relationships, platform-specific norms, or content
    quality heuristics.

    Returns:
        Empty list if all validations pass. Otherwise, list of human-readable
        failure messages suitable to send back to the model for regeneration.
    """
    failures: list[str] = []

    failures.extend(_check_total_duration(bundle))
    failures.extend(_check_overlay_timing_within_video(bundle))
    failures.extend(_check_overlay_not_verbatim_repeat(bundle))
    failures.extend(_check_caption_not_summary(bundle))
    failures.extend(_check_hook_quality(bundle))
    failures.extend(_check_swipe_test_self_report(bundle))

    return failures


# ============================================================================
# Individual checks
# ============================================================================

def _check_total_duration(bundle: UGCBundle) -> list[str]:
    """UGC videos should land between 15 and 60 seconds total.

    Under 12s is too short to deliver a hook + body + CTA properly. Over 90s
    blows past TikTok / Reels engagement curves.
    """
    total = bundle.total_duration_seconds
    if total < 12.0:
        return [
            f"Total duration {total:.1f}s is too short. UGC videos should be "
            f"15 to 60 seconds. Add another body beat or extend the hook."
        ]
    if total > 90.0:
        return [
            f"Total duration {total:.1f}s is too long. UGC videos should be "
            f"15 to 60 seconds for best engagement. Trim a body beat or shorten beats."
        ]
    return []


def _check_overlay_timing_within_video(bundle: UGCBundle) -> list[str]:
    """Every overlay must trigger and finish within the video's actual duration."""
    total = bundle.total_duration_seconds
    failures: list[str] = []
    for i, overlay in enumerate(bundle.overlays, 1):
        end = overlay.trigger_at_seconds + overlay.duration_seconds
        if overlay.trigger_at_seconds < 0:
            failures.append(
                f"Overlay {i} ('{overlay.text}') triggers at negative time "
                f"{overlay.trigger_at_seconds}s."
            )
        if end > total + 0.5:  # 0.5s tolerance for rounding
            failures.append(
                f"Overlay {i} ('{overlay.text}') extends past video end "
                f"(triggers at {overlay.trigger_at_seconds:.1f}s for "
                f"{overlay.duration_seconds:.1f}s, video ends at {total:.1f}s)."
            )
    return failures


def _check_overlay_not_verbatim_repeat(bundle: UGCBundle) -> list[str]:
    """An overlay should never appear word-for-word in the spoken script.

    Reinforce, don't repeat. If the speaker says "I dropped Buffer last month",
    a good overlay is "BUFFER ❌". A bad overlay is "I dropped Buffer last month".
    """
    spoken_lower = bundle.script_text.lower()
    failures: list[str] = []
    for i, overlay in enumerate(bundle.overlays, 1):
        overlay_lower = overlay.text.lower().strip()
        # Strip emojis and punctuation for the comparison so "BUFFER ❌" doesn't
        # match the spoken word "buffer" alone (overlay is intentionally minimal).
        # Rule: only flag if the FULL overlay text appears as a substring in the script.
        if len(overlay_lower.split()) >= 3 and overlay_lower in spoken_lower:
            failures.append(
                f"Overlay {i} ('{overlay.text}') repeats spoken text verbatim. "
                f"Use a shorter callout or a different angle (numbers, key terms)."
            )
    return failures


def _check_caption_not_summary(bundle: UGCBundle) -> list[str]:
    """Caption should not start with summary phrases that describe the video.

    The caption is the post-credit scene, not a description of the video.
    """
    bad_starters = (
        "in this video", "this video is about", "today i'm talking about",
        "today i talk about", "watch as i", "here's a video about",
        "i made a video about", "in today's video",
    )
    caption_lower = bundle.caption.lower().strip()
    for starter in bad_starters:
        if caption_lower.startswith(starter):
            return [
                f"Caption opens with summary phrase '{starter}'. Caption should "
                f"extend the video, not describe it. Add context, a question, "
                f"or a hook for the next post."
            ]
    return []


def _check_hook_quality(bundle: UGCBundle) -> list[str]:
    """Heuristic check for weak hook openers that fail the swipe test."""
    weak_openers = (
        "today i", "hey everyone", "what's up", "let me tell you",
        "i want to talk about", "i'm going to", "here's a thing",
        "so basically", "in this video", "guys", "you guys",
        "today we're going to", "let's talk about", "quick tip",
        "pro tip", "fun fact", "did you know", "the truth is",
    )
    hook_lower = bundle.hook.text.lower().strip()
    for weak in weak_openers:
        if hook_lower.startswith(weak):
            return [
                f"Hook opens with weak phrase '{weak}'. Use a confession, "
                f"specific number, contrarian setup, or pattern interrupt instead. "
                f"Examples: 'I used to...', 'I spent 156 hours...', "
                f"'Stop using X. Here's why.', 'Everyone's wrong about Y.'"
            ]
    return []


def _check_swipe_test_self_report(bundle: UGCBundle) -> list[str]:
    """If the model self-reports failing the swipe test, reject the bundle.

    The model is supposed to honestly check its own hook and only return
    passes_swipe_test=true when confident.
    """
    if not bundle.metadata.passes_swipe_test:
        return [
            "metadata.passes_swipe_test is false. The model self-reported the "
            "hook does not pass the 0.5-second swipe test. Regenerate the hook."
        ]
    return []


def _check_hook_specificity(bundle: UGCBundle) -> list[str]:
    """Score the hook on specificity. Hooks below the threshold are rejected.

    Scoring:
      +1 if contains a specific number (with or without unit)
      +1 if mentions a named tool/brand the audience recognizes
      +1 if uses a confession verb (used to, dropped, deleted, tried, etc.)
      -1 if relies on vague nouns (something, things, stuff)

    Threshold: score < 0 fails. Score 0 passes (neutral hook with no penalty).
    Score >= 1 is the target.
    """
    text = bundle.hook.text
    text_lower = text.lower()
    score = 0
    matched_signals: list[str] = []

    if NUMBER_PATTERN.search(text) or DOLLAR_PATTERN.search(text):
        score += 1
        matched_signals.append("number")

    if any(tool in text_lower for tool in NAMED_ENTITY_TOOLS):
        score += 1
        matched_signals.append("named_brand")

    if any(verb in text_lower for verb in CONFESSION_VERBS):
        score += 1
        matched_signals.append("confession_verb")

    cleaned_words = set(re.findall(r"\b\w+\b", text_lower))
    vague_hits = cleaned_words & VAGUE_NOUNS
    if vague_hits:
        score -= 1
        matched_signals.append(f"vague_noun_penalty:{','.join(sorted(vague_hits))}")

    if score < 0:
        return [
            f"Hook specificity score is {score} (need >= 0, ideally >= 1). "
            f"Signals: {matched_signals or 'none'}. Hook: '{text}'. "
            f"Either add specifics (number, brand, confession verb) or remove "
            f"vague nouns ({', '.join(sorted(vague_hits)) if vague_hits else 'n/a'})."
        ]
    return []


def _check_cta_not_sales_disguised(bundle: UGCBundle) -> list[str]:
    """CTAs disguised as sales pitches kill conversion on UGC.

    Detects common sales-style CTA phrases that should be replaced with
    conversational asks ("comment X if...", "save this for later",
    "tag a founder who...").
    """
    cta_lower = bundle.cta.text.lower()
    for phrase in SALES_CTA_PHRASES:
        if phrase in cta_lower:
            return [
                f"CTA contains sales phrase '{phrase}'. UGC CTAs should be "
                f"conversational, not transactional. Rewrite as a question or "
                f"invitation. Examples: 'Comment X if you've been here', "
                f"'Save this for next sprint', 'Tag a founder who needs this'."
            ]
    return []
