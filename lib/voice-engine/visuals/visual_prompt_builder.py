"""
visual_prompt_builder.py
========================

Composes a VisualPromptIR from input signals (pain_point, caption, BrandBible,
platform, content_type). Calls visual_subject_extractor for the SubjectBlock
and pulls the other 4 blocks from BrandBible + PLATFORM_VISUAL_LANGUAGE.

This is the entry point called by the visual generation pipeline. Once the
IR is built, hand it to a renderer (visual_renderer_flux.render_for_flux)
to produce the final string for the image model.

Usage:
    from visual_prompt_builder import build_visual_prompt_ir
    from visual_renderer_flux import render_for_flux

    ir = await build_visual_prompt_ir(
        pain_point="...",
        caption="...",
        brand_bible=client_brand_bible,
        platform="instagram",
        content_type="photo",
        llm_client=haiku_client,
    )
    flux_prompt = render_for_flux(ir)

Version: 1.0 (MVP Phase 1)
"""

from __future__ import annotations

import hashlib
import time

from visual_schema import (
    BrandBlock,
    CameraType,
    DepthOfField,
    LightingType,
    NegativeBlock,
    PlatformBlock,
    StyleBlock,
    StyleType,
    VisualPromptIR,
    VisualPromptMetadata,
)
from visual_subject_extractor import LLMClient, extract_subject_block
from platform_visual_language import (
    format_visual_language_notes,
    get_visual_language,
)


# ============================================================================
# Style defaults by brand archetype
#
# Archetype is the strongest single brand signal we have for visual identity.
# Mapping each archetype to its natural camera/lighting/DOF combination
# produces dramatically more consistent output than relying on content_type
# defaults alone.
#
# Lookup precedence: archetype defaults override content_type defaults.
# If archetype is not recognized, fall back to content_type defaults.
# ============================================================================

# ============================================================================
# Dynamic negative terms by platform and style
#
# Layered on top of DEFAULT_NEGATIVE_TERMS to catch failure modes specific
# to each platform's visual culture and each style type's typical confusions.
# ============================================================================

NEGATIVE_BY_PLATFORM: dict[str, list[str]] = {
    "linkedin": ["neon colors", "casual lifestyle imagery", "selfie aesthetic"],
    "tiktok": ["muted desaturated palette", "static composition", "professional studio look"],
    "instagram": ["corporate stock photography", "boring composition"],
    "x": ["overly polished imagery", "studio lighting"],
    "threads": ["magazine-style production", "overly polished imagery"],
    "facebook": ["edgy harsh aesthetic", "low-key dark imagery"],
}

NEGATIVE_BY_STYLE: dict[StyleType, list[str]] = {
    StyleType.PHOTOGRAPHY: ["cartoonish illustration", "anime style", "flat 2D drawing"],
    StyleType.ILLUSTRATION: ["photorealistic 3D render", "uncanny valley faces"],
    StyleType.SCREENSHOT: ["artistic interpretation", "stylized rendering"],
    StyleType.MIXED_MEDIA: [],
    StyleType.ABSTRACT: ["literal subject", "documentary realism"],
    StyleType.THREE_D_RENDER: ["flat illustration", "2D drawing"],
}


def build_negative_terms(
    platform: str,
    style_type: StyleType,
    base: list[str] | None = None,
) -> list[str]:
    """Combine default negative terms with platform-specific and style-specific
    additions. Deduplicates while preserving order so the most generic
    anti-patterns appear first.
    """
    from visual_schema import DEFAULT_NEGATIVE_TERMS

    combined: list[str] = list(base) if base is not None else list(DEFAULT_NEGATIVE_TERMS)
    combined.extend(NEGATIVE_BY_PLATFORM.get(platform.lower(), []))
    combined.extend(NEGATIVE_BY_STYLE.get(style_type, []))

    seen: set[str] = set()
    deduped: list[str] = []
    for term in combined:
        term_lower = term.lower()
        if term_lower not in seen:
            seen.add(term_lower)
            deduped.append(term)
    return deduped


STYLE_DEFAULTS_BY_ARCHETYPE: dict[str, dict] = {
    "rebel":     {"camera": CameraType.DUTCH_ANGLE,    "lighting": LightingType.HARSH_SHADOWS, "depth_of_field": DepthOfField.SHALLOW},
    "outlaw":    {"camera": CameraType.DUTCH_ANGLE,    "lighting": LightingType.LOW_KEY,       "depth_of_field": DepthOfField.SHALLOW},
    "sage":      {"camera": CameraType.MEDIUM_SHOT,    "lighting": LightingType.WINDOW_LIGHT,  "depth_of_field": DepthOfField.DEEP},
    "creator":   {"camera": CameraType.CLOSE_UP,       "lighting": LightingType.GOLDEN_HOUR,   "depth_of_field": DepthOfField.SHALLOW},
    "hero":      {"camera": CameraType.WIDE_SHOT,      "lighting": LightingType.BACKLIT,       "depth_of_field": DepthOfField.MEDIUM},
    "caregiver": {"camera": CameraType.CLOSE_UP,       "lighting": LightingType.NATURAL_SOFT,  "depth_of_field": DepthOfField.SHALLOW},
    "everyman":  {"camera": CameraType.DOCUMENTARY,    "lighting": LightingType.NATURAL_SOFT,  "depth_of_field": DepthOfField.MEDIUM},
    "ruler":     {"camera": CameraType.PORTRAIT_85MM,  "lighting": LightingType.STUDIO,        "depth_of_field": DepthOfField.SHALLOW},
    "magician":  {"camera": CameraType.CLOSE_UP,       "lighting": LightingType.LOW_KEY,       "depth_of_field": DepthOfField.SHALLOW},
    "innocent":  {"camera": CameraType.MEDIUM_SHOT,    "lighting": LightingType.NATURAL_SOFT,  "depth_of_field": DepthOfField.MEDIUM},
    "explorer":  {"camera": CameraType.WIDE_SHOT,      "lighting": LightingType.GOLDEN_HOUR,   "depth_of_field": DepthOfField.DEEP},
    "lover":     {"camera": CameraType.CLOSE_UP,       "lighting": LightingType.GOLDEN_HOUR,   "depth_of_field": DepthOfField.SHALLOW},
    "jester":    {"camera": CameraType.MEDIUM_SHOT,    "lighting": LightingType.NATURAL_SOFT,  "depth_of_field": DepthOfField.MEDIUM},
}


# ============================================================================
# BrandBible adapter
#
# The visual_prompt_builder doesn't know about ClientContext. It takes a
# loose dict-like brand_bible to stay decoupled from the learning engine.
# Calling code is responsible for extracting the right slice.
# ============================================================================

class BrandBibleVisualSlice:
    """Minimal contract for what the visual builder needs from BrandBible.

    Adapt your existing BrandBible to this shape at the call site. Avoids
    coupling the visual module to a specific BrandBible class layout.
    """

    def __init__(
        self,
        archetype: str,
        photography_mood: str,
        image_style: str,  # "photography" | "illustration" | etc., maps to StyleType
        colors: list[str] | None = None,
        voice_descriptor: str | None = None,
    ):
        self.archetype = archetype
        self.photography_mood = photography_mood
        self.image_style = image_style
        self.colors = colors or []
        self.voice_descriptor = voice_descriptor


# ============================================================================
# Public API
# ============================================================================

async def build_visual_prompt_ir(
    *,
    pain_point: str,
    caption: str,
    brand_bible: BrandBibleVisualSlice,
    platform: str,
    content_type: str,
    llm_client: LLMClient,
    subject_extractor_model: str = "claude-haiku-4-5",
) -> VisualPromptIR:
    """Build a complete VisualPromptIR by composing all 5 blocks.

    Pipeline:
      1. Call mini-LLM to extract SubjectBlock from pain_point + caption
      2. Build StyleBlock from BrandBible.image_style + content_type defaults
      3. Build BrandBlock from BrandBible
      4. Build PlatformBlock from platform + content_type via lookup
      5. Use default NegativeBlock (or override per client in future)

    Args:
        pain_point:              the audience pain / insight
        caption:                 the post's caption
        brand_bible:             BrandBibleVisualSlice with the client's visual identity
        platform:                target platform (instagram, linkedin, x, etc.)
        content_type:            target content type (photo, carousel, ugc)
        llm_client:              LLMClient adapter for SubjectBlock extraction
        subject_extractor_model: model id for the mini-LLM call

    Returns:
        VisualPromptIR ready for validation + rendering.
    """
    platform = platform.lower()
    content_type = content_type.lower()

    # 1. Extract SubjectBlock via mini-LLM call (timed for telemetry)
    start_ms = int(time.monotonic() * 1000)
    subject = await extract_subject_block(
        pain_point=pain_point,
        caption=caption,
        brand_archetype=brand_bible.archetype,
        brand_mood=brand_bible.photography_mood,
        client=llm_client,
        model=subject_extractor_model,
    )
    extraction_latency_ms = int(time.monotonic() * 1000) - start_ms

    # 2. StyleBlock — derived from brand_bible + content_type defaults
    style = _build_style_block(brand_bible, content_type)

    # 3. BrandBlock — direct adapter
    brand = BrandBlock(
        archetype=brand_bible.archetype,
        mood=brand_bible.photography_mood,
        color_palette=brand_bible.colors,
        voice_descriptor=brand_bible.voice_descriptor,
    )

    # 4. PlatformBlock — lookup from PLATFORM_VISUAL_LANGUAGE
    visual_lang_spec = get_visual_language(platform, content_type)
    platform_block = PlatformBlock(
        platform=platform,
        content_type=content_type,
        aspect_ratio=visual_lang_spec["aspect_ratio"],
        visual_language_notes=format_visual_language_notes(visual_lang_spec),
    )

    # 5. NegativeBlock — defaults + platform-specific + style-specific overlays
    negative = NegativeBlock(
        avoid_terms=build_negative_terms(platform, style.style_type)
    )

    # Metadata for audit (cache_key reserved for v1.5 cache layer)
    cache_key = _generate_cache_key(
        pain_point=pain_point,
        caption=caption,
        brand_archetype=brand_bible.archetype,
        brand_mood=brand_bible.photography_mood,
        platform=platform,
        content_type=content_type,
    )
    metadata = VisualPromptMetadata(
        pain_point_excerpt=pain_point[:300],
        caption_excerpt=caption[:300],
        target_platform=platform,
        target_content_type=content_type,
        subject_extractor_model=subject_extractor_model,
        subject_extractor_latency_ms=extraction_latency_ms,
        cache_key=cache_key,
    )

    return VisualPromptIR(
        subject=subject,
        style=style,
        brand=brand,
        platform=platform_block,
        negative=negative,
        metadata=metadata,
    )


# ============================================================================
# Internal helpers
# ============================================================================

def _build_style_block(brand: BrandBibleVisualSlice, content_type: str) -> StyleBlock:
    """Construct the StyleBlock from BrandBible + content-type defaults.

    Lookup precedence (highest first):
      1. STYLE_DEFAULTS_BY_ARCHETYPE if brand archetype is recognized
      2. content_type defaults

    Brands can override the StyleType by setting brand.image_style.
    """
    try:
        style_type = StyleType(brand.image_style.lower())
    except ValueError:
        style_type = StyleType.PHOTOGRAPHY

    # Try archetype-driven defaults first (strongest brand signal)
    archetype_key = brand.archetype.lower().strip()
    archetype_defaults = STYLE_DEFAULTS_BY_ARCHETYPE.get(archetype_key)

    if archetype_defaults:
        defaults = archetype_defaults
    else:
        # Fall back to content-type defaults
        defaults_by_content_type = {
            "photo": {
                "camera": CameraType.MEDIUM_SHOT,
                "lighting": LightingType.NATURAL_SOFT,
                "depth_of_field": DepthOfField.SHALLOW,
            },
            "carousel": {
                "camera": CameraType.FLAT_LAY,
                "lighting": LightingType.STUDIO,
                "depth_of_field": DepthOfField.DEEP,
            },
            "ugc": {
                "camera": CameraType.MEDIUM_SHOT,
                "lighting": LightingType.WINDOW_LIGHT,
                "depth_of_field": DepthOfField.MEDIUM,
            },
        }
        defaults = defaults_by_content_type.get(content_type, defaults_by_content_type["photo"])

    return StyleBlock(
        style_type=style_type,
        camera=defaults["camera"],
        lighting=defaults["lighting"],
        depth_of_field=defaults["depth_of_field"],
        additional_style_notes=None,
    )


def _generate_cache_key(
    *,
    pain_point: str,
    caption: str,
    brand_archetype: str,
    brand_mood: str,
    platform: str,
    content_type: str,
) -> str:
    """Stable hash for caching SubjectBlock outputs (v1.5 cache layer).

    Truncated SHA-256 (16 chars) is enough for collision avoidance at
    expected scale. The cache_key is stored in VisualPromptMetadata so
    the future cache layer can lookup without recomputing.
    """
    combined = "||".join([
        pain_point.strip(),
        caption.strip(),
        brand_archetype.strip().lower(),
        brand_mood.strip().lower(),
        platform.lower(),
        content_type.lower(),
    ])
    return hashlib.sha256(combined.encode("utf-8")).hexdigest()[:16]
