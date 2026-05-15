"""
visual_renderer_flux.py
=======================

Renders a VisualPromptIR to a Flux-compatible prompt string for fal.ai.

Flux prompts work best as comma-separated descriptive phrases, leading with
the most important elements (subject + style) and ending with technical
specifications (aspect ratio, negatives).

Other renderers (Midjourney, SDXL, Imagen) live in sibling files
(visual_renderer_midjourney.py, etc.) when needed. The IR is the same; only
the renderer changes.

Usage:
    from visual_renderer_flux import render_for_flux

    flux_prompt = render_for_flux(ir)
    # Send flux_prompt to fal.ai
    response = await fal_client.run("fal-ai/flux/dev", arguments={
        "prompt": flux_prompt,
        "image_size": ir.platform.aspect_ratio.value,
    })

Version: 1.0 (MVP Phase 1)
"""

from __future__ import annotations

from visual_schema import (
    AspectRatio,
    CameraType,
    DepthOfField,
    LightingType,
    StyleType,
    VisualPromptIR,
)


# ============================================================================
# Style lead by StyleType
#
# The opening phrase that tells Flux what kind of image to make. This is
# arguably the highest-impact line in the entire prompt.
# ============================================================================

STYLE_LEAD: dict[StyleType, str] = {
    StyleType.PHOTOGRAPHY: "Professional photograph",
    StyleType.ILLUSTRATION: "Editorial illustration",
    StyleType.SCREENSHOT: "Realistic screen capture",
    StyleType.MIXED_MEDIA: "Mixed-media composition",
    StyleType.ABSTRACT: "Abstract visual composition",
    StyleType.THREE_D_RENDER: "Cinematic 3D render",
}


# ============================================================================
# Public API
# ============================================================================

def render_for_flux(ir: VisualPromptIR, *, boost_subject: bool = False) -> str:
    """Convert a VisualPromptIR to a Flux/fal.ai prompt string.

    Args:
        ir:             the validated VisualPromptIR
        boost_subject:  EXPERIMENTAL. If True, wraps the main_subject in
                        weighted-attention syntax: (subject:1.3). Some Flux
                        variants (Pro, Dev) respect this; Schnell may not.
                        A/B test before promoting to default. Off by default.

    Output structure:
      [STYLE_LEAD] of [SUBJECT.main_subject], in [SUBJECT.setting].
      [SUBJECT.composition]. Mood: [SUBJECT.mood_descriptor].
      [Optional: visual metaphor].
      Style: [camera], [lighting], [depth_of_field].
      Brand: [archetype] archetype, [mood] mood, color palette of [colors].
      Platform context: [platform_visual_language_notes].
      Aspect ratio: [aspect_ratio].
      Avoid: [negative terms].
    """
    parts: list[str] = []

    # Lead: STYLE + SUBJECT (optionally weight-boosted)
    style_lead = STYLE_LEAD.get(ir.style.style_type, "Professional photograph")
    subject_text = ir.subject.main_subject
    if boost_subject:
        subject_text = f"({subject_text}:1.3)"
    parts.append(f"{style_lead} of {subject_text}")

    # Setting
    parts.append(f"in {ir.subject.setting}")

    # Composition
    parts.append(ir.subject.composition)

    # Mood
    parts.append(f"mood: {ir.subject.mood_descriptor}")

    # Visual metaphor (optional)
    if ir.subject.visual_metaphor:
        parts.append(f"visual metaphor: {ir.subject.visual_metaphor}")

    # Style technicals
    style_technicals: list[str] = []
    if ir.style.camera:
        style_technicals.append(_camera_phrase(ir.style.camera))
    if ir.style.lighting:
        style_technicals.append(_lighting_phrase(ir.style.lighting))
    if ir.style.depth_of_field:
        style_technicals.append(_dof_phrase(ir.style.depth_of_field))
    if ir.style.additional_style_notes:
        style_technicals.append(ir.style.additional_style_notes)
    if style_technicals:
        parts.append("style: " + ", ".join(style_technicals))

    # Brand
    brand_parts: list[str] = []
    brand_parts.append(f"{ir.brand.archetype} brand archetype")
    brand_parts.append(f"{ir.brand.mood} mood")
    if ir.brand.color_palette:
        brand_parts.append(f"color palette of {', '.join(ir.brand.color_palette)}")
    parts.append("brand: " + ", ".join(brand_parts))

    # Platform context
    parts.append(ir.platform.visual_language_notes)

    # Aspect ratio (Flux respects this both in prompt and as a separate API param)
    parts.append(f"{_aspect_phrase(ir.platform.aspect_ratio)} aspect ratio")

    # Negative (Flux accepts negatives in prose form)
    if ir.negative.avoid_terms:
        parts.append(f"avoid: {', '.join(ir.negative.avoid_terms)}")

    return ". ".join(parts) + "."


def render_negative_prompt(ir: VisualPromptIR) -> str:
    """Some Flux variants and Flux-adjacent models accept a separate
    negative_prompt parameter. This helper returns the negative terms as a
    standalone comma-separated string.
    """
    return ", ".join(ir.negative.avoid_terms)


def get_image_size_for_fal(aspect_ratio: AspectRatio) -> str:
    """Map an AspectRatio to fal.ai's image_size parameter values.

    fal.ai accepts named sizes ('square_hd', 'portrait_4_3', etc.) or explicit
    {width, height} dicts. This returns the named string for simplicity; swap
    to dict form if you need custom resolutions.
    """
    mapping: dict[AspectRatio, str] = {
        AspectRatio.SQUARE: "square_hd",
        AspectRatio.PORTRAIT_4_5: "portrait_4_3",  # Closest named match
        AspectRatio.PORTRAIT_9_16: "portrait_16_9",
        AspectRatio.LANDSCAPE_16_9: "landscape_16_9",
        AspectRatio.LANDSCAPE_3_2: "landscape_4_3",
    }
    return mapping.get(aspect_ratio, "square_hd")


# ============================================================================
# Internal helpers
# ============================================================================

def _camera_phrase(camera: CameraType) -> str:
    """Render a CameraType as a natural Flux phrase."""
    return f"shot with {camera.value}"


def _lighting_phrase(lighting: LightingType) -> str:
    return lighting.value


def _dof_phrase(dof: DepthOfField) -> str:
    return dof.value


def _aspect_phrase(aspect: AspectRatio) -> str:
    """Render aspect ratio in Flux-friendly prose."""
    descriptors = {
        AspectRatio.SQUARE: "square 1:1",
        AspectRatio.PORTRAIT_4_5: "portrait 4:5",
        AspectRatio.PORTRAIT_9_16: "tall vertical 9:16",
        AspectRatio.LANDSCAPE_16_9: "wide landscape 16:9",
        AspectRatio.LANDSCAPE_3_2: "landscape 3:2",
    }
    return descriptors.get(aspect, aspect.value)
