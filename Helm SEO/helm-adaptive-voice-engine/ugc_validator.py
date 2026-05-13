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

Version: 1.0
"""

from __future__ import annotations

from ugc_schema import UGCBundle


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
