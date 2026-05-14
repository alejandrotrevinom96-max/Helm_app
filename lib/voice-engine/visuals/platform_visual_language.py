"""
platform_visual_language.py
============================

Per-platform visual conventions for image generation. Lives parallel to
PLATFORM_TONE_INSTRUCTIONS (which handles text) and is consumed by
visual_prompt_builder.py to populate the PlatformBlock of the VisualPromptIR.

Each entry maps (platform, content_type) -> dict with:
  - aspect_ratio       AspectRatio enum value
  - visual_register    one-line summary of the platform's visual mood
  - composition_notes  framing and arrangement guidance
  - color_treatment    saturation, contrast, palette guidance

Usage:
    from platform_visual_language import get_visual_language

    spec = get_visual_language("instagram", "photo")
    # spec is a dict with the 4 keys above

Version: 1.0 (MVP Phase 1)
"""

from __future__ import annotations

from visual_schema import AspectRatio


# ============================================================================
# PLATFORM_VISUAL_LANGUAGE
#
# Structured by (platform, content_type). Not every platform supports every
# content type — check PLATFORM_CONTENT_COMPATIBILITY in
# platform_tone_instructions.py for which combos are valid.
# ============================================================================

PLATFORM_VISUAL_LANGUAGE: dict[str, dict[str, dict]] = {

    "instagram": {
        "photo": {
            "aspect_ratio": AspectRatio.PORTRAIT_4_5,
            "visual_register": "lifestyle, aspirational, mobile-first",
            "composition_notes": (
                "subject centered or rule-of-thirds, ample negative space, "
                "designed to thumbstop in feed"
            ),
            "color_treatment": (
                "vibrant but natural saturation, slight warm bias, "
                "consistent with mobile screen rendering"
            ),
        },
        "carousel": {
            "aspect_ratio": AspectRatio.SQUARE,
            "visual_register": "editorial, clean, slide-as-standalone",
            "composition_notes": (
                "simple compositions that read at thumbnail size, "
                "subject filling 50-70% of frame, clean negative space "
                "for any future text overlay"
            ),
            "color_treatment": (
                "consistent palette across all slides, muted-to-mid saturation, "
                "high readability"
            ),
        },
        "ugc": {  # Reel cover frame
            "aspect_ratio": AspectRatio.PORTRAIT_9_16,
            "visual_register": "bold, high-contrast, attention-stopper",
            "composition_notes": (
                "subject centered or upper-third, room for text overlay at "
                "top and bottom thirds, face-forward when subject is human"
            ),
            "color_treatment": (
                "saturated, contrasty, optimized for tiny thumbnail visibility"
            ),
        },
    },

    "linkedin": {
        "photo": {
            "aspect_ratio": AspectRatio.PORTRAIT_4_5,
            "visual_register": "clean editorial, business context, professional but human",
            "composition_notes": (
                "subject centered, neutral or office-adjacent setting, "
                "documentary feel over staged"
            ),
            "color_treatment": (
                "muted palette, low-to-mid saturation, blue-gray cool bias is "
                "acceptable, avoid neon"
            ),
        },
        "carousel": {
            "aspect_ratio": AspectRatio.SQUARE,
            "visual_register": "document-style, headline + supporting visual, white-paper feel",
            "composition_notes": (
                "high contrast subject vs background, asymmetric composition "
                "that leaves room for prominent headline text overlay, "
                "flat-lay or clean studio shots work well"
            ),
            "color_treatment": (
                "muted, professional, single accent color, avoid lifestyle "
                "warmth or aspirational glow"
            ),
        },
        "ugc": {  # Native video cover
            "aspect_ratio": AspectRatio.PORTRAIT_9_16,
            "visual_register": "professional but candid, talking-head friendly",
            "composition_notes": (
                "subject upper-center, eye level, neutral background, "
                "looking slightly off-camera or direct"
            ),
            "color_treatment": "natural skin tones, soft window-style lighting",
        },
    },

    "x": {
        "photo": {
            "aspect_ratio": AspectRatio.LANDSCAPE_16_9,
            "visual_register": "documentary, raw, screenshot-friendly",
            "composition_notes": (
                "wider framing, subject can be off-center, scene matters as "
                "much as subject, less polished"
            ),
            "color_treatment": (
                "natural / unprocessed feel, accept some grain or imperfection"
            ),
        },
        "ugc": {
            "aspect_ratio": AspectRatio.PORTRAIT_9_16,
            "visual_register": "raw, in-the-moment, unpolished",
            "composition_notes": (
                "subject filling frame, handheld feel acceptable, "
                "low production value works"
            ),
            "color_treatment": "natural, no filters, slight underexposure OK",
        },
    },

    "threads": {
        "photo": {
            "aspect_ratio": AspectRatio.SQUARE,
            "visual_register": "casual, in-progress, less polished than Instagram",
            "composition_notes": (
                "subject centered, simple, looks like a phone snap rather than "
                "a photoshoot"
            ),
            "color_treatment": "natural, slightly under-saturated, no heavy editing",
        },
        "ugc": {
            "aspect_ratio": AspectRatio.PORTRAIT_9_16,
            "visual_register": "raw, conversational, talking-friend energy",
            "composition_notes": (
                "subject close to camera, casual framing, eye contact"
            ),
            "color_treatment": "natural skin tones, ambient lighting only",
        },
    },

    "facebook": {
        "photo": {
            "aspect_ratio": AspectRatio.SQUARE,
            "visual_register": "warm, community-oriented, less edgy",
            "composition_notes": (
                "subject centered, narrative composition, often shows people "
                "or relatable scenes"
            ),
            "color_treatment": "warm tones, mid saturation, accessible to older audiences",
        },
        "carousel": {
            "aspect_ratio": AspectRatio.SQUARE,
            "visual_register": "story-driven, sequential narrative",
            "composition_notes": (
                "consistent visual language across slides, subject can vary "
                "but treatment stays uniform"
            ),
            "color_treatment": "consistent warm palette across slides",
        },
        "ugc": {
            "aspect_ratio": AspectRatio.PORTRAIT_9_16,
            "visual_register": "warm, community-friendly, talking-head with context",
            "composition_notes": (
                "subject centered, may show a setting that signals community"
            ),
            "color_treatment": "warm natural tones",
        },
    },

    "tiktok": {
        "ugc": {  # Cover frame for TikTok video
            "aspect_ratio": AspectRatio.PORTRAIT_9_16,
            "visual_register": "bold, high-contrast, attention-stopper for thumbnail",
            "composition_notes": (
                "subject centered or upper-third, expressive face if human, "
                "room for text overlay across top, designed to win the "
                "0.5-second swipe test as a static frame"
            ),
            "color_treatment": (
                "high saturation, high contrast, optimized for thumbnail "
                "visibility at 80px"
            ),
        },
    },

    # Reddit intentionally absent: Reddit is text-led, images are uncommon
    # and when used should be screenshots or charts (handled outside this
    # generation pipeline).
}


# ============================================================================
# Aspect ratio lookup by (platform, content_type) — convenience export
# ============================================================================

ASPECT_RATIO_BY_PLATFORM_AND_TYPE: dict[tuple[str, str], AspectRatio] = {
    (platform, content_type): spec["aspect_ratio"]
    for platform, content_types in PLATFORM_VISUAL_LANGUAGE.items()
    for content_type, spec in content_types.items()
}


# ============================================================================
# Public helpers
# ============================================================================

def get_visual_language(platform: str, content_type: str) -> dict:
    """Get the visual language spec for a (platform, content_type) combination.

    Raises:
        ValueError if the combination is not supported (e.g., reddit + carousel,
        or text-only content types).
    """
    platform = platform.lower()
    content_type = content_type.lower()

    if platform not in PLATFORM_VISUAL_LANGUAGE:
        raise ValueError(
            f"Platform '{platform}' has no visual language defined. "
            f"Supported: {sorted(PLATFORM_VISUAL_LANGUAGE.keys())}"
        )

    if content_type not in PLATFORM_VISUAL_LANGUAGE[platform]:
        raise ValueError(
            f"Content type '{content_type}' not supported for visuals on "
            f"platform '{platform}'. Supported types: "
            f"{sorted(PLATFORM_VISUAL_LANGUAGE[platform].keys())}"
        )

    return PLATFORM_VISUAL_LANGUAGE[platform][content_type]


def get_aspect_ratio(platform: str, content_type: str) -> AspectRatio:
    """Get the aspect ratio for a (platform, content_type) combination."""
    return get_visual_language(platform, content_type)["aspect_ratio"]


def format_visual_language_notes(spec: dict) -> str:
    """Format a visual language spec dict as a single descriptive string for
    the PlatformBlock.visual_language_notes field.
    """
    return (
        f"Visual register: {spec['visual_register']}. "
        f"Composition: {spec['composition_notes']}. "
        f"Color treatment: {spec['color_treatment']}."
    )
