"""
ugc_extractor.py
================

Extract specific artifacts from a UGCBundle for downstream consumers:
  - HeyGen / TTS engines need the spoken script as flat text
  - Post-production tools need overlay metadata for the video timeline
  - Social schedulers need caption + hashtags formatted correctly
  - Storyboard/QA views need a beat-by-beat breakdown with timing

Replaces the original extractScriptText() with a richer set of extractors.
The HeyGen-compatible flat string is still available via
extract_script_for_heygen() so the migration is one-line.

Version: 1.0
"""

from __future__ import annotations

from ugc_schema import UGCBundle


# ============================================================================
# Script extraction (TTS / HeyGen)
# ============================================================================

def extract_script_for_heygen(bundle: UGCBundle) -> str:
    """Concatenate hook + body beats + CTA into a single string for TTS.

    Spaces between sections; no SSML tags in MVP. Phase 1.5 can add SSML
    delivery hints if HeyGen's API supports them on the relevant voice.

    Drop-in replacement for the previous extractScriptText() that read
    {opening, body, closing}. Behavior: hook + body in beat order + cta.
    """
    return bundle.script_text


# ============================================================================
# Overlay extraction (video editor / post-production)
# ============================================================================

def extract_overlay_track(bundle: UGCBundle) -> list[dict]:
    """Return overlay timing data formatted for video editor import.

    Each entry has the text, the timestamp to appear, and the duration. Video
    editors (CapCut, Premiere, custom pipelines) can use this to auto-place
    text overlays on the timeline at the right moments.

    Returns:
        List of dicts shaped like:
          {
            "text": "BUFFER ❌",
            "start_seconds": 1.5,
            "end_seconds": 3.5,
            "duration_seconds": 2.0
          }
    """
    return [
        {
            "text": o.text,
            "start_seconds": o.trigger_at_seconds,
            "end_seconds": o.trigger_at_seconds + o.duration_seconds,
            "duration_seconds": o.duration_seconds,
        }
        for o in bundle.overlays
    ]


# ============================================================================
# Caption extraction (social scheduler)
# ============================================================================

def extract_caption_for_post(bundle: UGCBundle, include_hashtags: bool = True) -> str:
    """Format the caption for social media post upload.

    Hashtags are stored without the # prefix in the bundle. This extractor
    adds the # back when include_hashtags=True, so consumers don't have to.

    Args:
        bundle:           the UGC bundle
        include_hashtags: whether to append the hashtag block. Default True.
                          Set False for platforms that handle hashtags via
                          a separate field (e.g., Instagram first-comment strategy).

    Returns:
        Caption string ready to paste into the social platform's compose field.
    """
    if not include_hashtags or not bundle.hashtags:
        return bundle.caption

    hashtag_block = " ".join(f"#{tag}" for tag in bundle.hashtags)
    return f"{bundle.caption}\n\n{hashtag_block}"


def extract_hashtag_list(bundle: UGCBundle, with_prefix: bool = True) -> list[str]:
    """Return hashtags as a list, optionally with the # prefix added back.

    Useful for platforms that take hashtags via a separate API field.
    """
    if with_prefix:
        return [f"#{tag}" for tag in bundle.hashtags]
    return list(bundle.hashtags)


# ============================================================================
# Beat breakdown (storyboard / QA / post-production timing)
# ============================================================================

def extract_beat_breakdown(bundle: UGCBundle) -> list[dict]:
    """Return a beat-by-beat breakdown including running timing.

    Useful for storyboarding views, manual QA, and post-production planning
    where you need to see exactly when each section starts and ends.

    Returns:
        List of dicts shaped like:
          {
            "section": "hook" | "body_beat_1" | "body_beat_2" | ... | "cta",
            "start_seconds": 0.0,
            "end_seconds": 3.0,
            "duration_seconds": 3.0,
            "text": "...",
            "delivery": "punchy"
          }
    """
    breakdown: list[dict] = []
    cursor = 0.0

    breakdown.append({
        "section": "hook",
        "start_seconds": cursor,
        "end_seconds": cursor + bundle.hook.duration_seconds,
        "duration_seconds": bundle.hook.duration_seconds,
        "text": bundle.hook.text,
        "delivery": bundle.hook.delivery.value,
    })
    cursor += bundle.hook.duration_seconds

    for beat in bundle.body:
        breakdown.append({
            "section": f"body_beat_{beat.beat}",
            "start_seconds": cursor,
            "end_seconds": cursor + beat.duration_seconds,
            "duration_seconds": beat.duration_seconds,
            "text": beat.text,
            "delivery": beat.delivery.value,
        })
        cursor += beat.duration_seconds

    breakdown.append({
        "section": "cta",
        "start_seconds": cursor,
        "end_seconds": cursor + bundle.cta.duration_seconds,
        "duration_seconds": bundle.cta.duration_seconds,
        "text": bundle.cta.text,
        "delivery": bundle.cta.delivery.value,
    })

    return breakdown


# ============================================================================
# Combined export (for storage / debugging)
# ============================================================================

def extract_full_export(bundle: UGCBundle) -> dict:
    """Return everything: script, overlays, caption, hashtags, beat breakdown.

    Useful for debugging, archiving, or when you want a single payload to
    pass to a downstream service that handles multiple consumers.
    """
    return {
        "script": extract_script_for_heygen(bundle),
        "overlays": extract_overlay_track(bundle),
        "caption_with_hashtags": extract_caption_for_post(bundle, include_hashtags=True),
        "caption_without_hashtags": extract_caption_for_post(bundle, include_hashtags=False),
        "hashtags": extract_hashtag_list(bundle, with_prefix=True),
        "beat_breakdown": extract_beat_breakdown(bundle),
        "total_duration_seconds": bundle.total_duration_seconds,
        "platform": bundle.metadata.platform,
        "language": bundle.metadata.language,
    }
