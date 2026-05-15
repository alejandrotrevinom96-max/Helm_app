"""
visual_subject_extractor.py
============================

Mini-LLM call that translates PAIN_POINT + caption into a concrete visual
subject for image generation.

This is the core innovation of the visual pipeline. The caption is what the
person SAYS about the image; the subject describes what's IN the image. That
translation is what every prior version of the pipeline was missing.

Recommended model: Claude Haiku (fast, cheap, good at structured extraction).
Fallback: GPT-4o-mini or equivalent. Cost ~$0.005 per call.

Usage:
    from visual_subject_extractor import extract_subject_block

    subject_block = await extract_subject_block(
        pain_point="Solo founders waste 2.4 hrs/week on context switching",
        caption="I used to open 7 tabs just to tweet once. Now I open 1.",
        brand_archetype="rebel",
        brand_mood="warm and human",
        client=anthropic_client,  # or openai_client
        model="claude-haiku-4-5",
    )

Version: 1.0 (MVP Phase 1)
"""

from __future__ import annotations

import json
from typing import Any, Protocol

from visual_schema import SubjectBlock


# ============================================================================
# The extraction prompt
# ============================================================================

SUBJECT_EXTRACTION_PROMPT = """You are a senior visual director specialized in founder and SaaS marketing content. Your job is to translate a marketing post into a powerful, specific visual scene that an image generator (Flux, Midjourney, etc.) can render into a thumb-stopper.

INPUTS:

PAIN_POINT (what the post is fundamentally about, the audience pain or insight):
{pain_point}

CAPTION (what the person says about the image; NOT what the image should literally show):
{caption}

BRAND ARCHETYPE: {brand_archetype}
BRAND MOOD: {brand_mood}

YOUR TASK:

Output a JSON object describing the visual subject. The image should evoke the EMOTIONAL HUMAN CONSEQUENCE of the pain point, not the tool or the literal caption. For B2B/SaaS pain points, the strongest images show the human moment that the pain creates, not a screenshot or an abstract concept.

OUTPUT SCHEMA (return ONLY this JSON, no commentary):

{{
  "main_subject": "<concrete description of the central subject. 15-300 chars. E.g., 'A solo founder hunched over a laptop at 2am, 8 browser tabs glowing on the screen'>",
  "composition": "<framing and arrangement. 5-150 chars. E.g., 'centered, slight low angle, subject filling 60% of frame'>",
  "setting": "<environment/context. 5-200 chars. E.g., 'messy home office, warm desk lamp, late night, papers scattered'>",
  "mood_descriptor": "<emotional tone as a full phrase, 3-80 chars. E.g., 'exhausted but determined', 'quietly confident', 'frustrated and overwhelmed'>",
  "emotional_anchor": "<single dominant emotion as a short tag, 1-3 words max, 30 chars. E.g., 'exhaustion', 'determination', 'relief', 'frustration'. Or null if no single dominant emotion stands out.>",
  "visual_strategy": "<one of: human_story, metaphor_driven, product_shot, data_visualization, behind_scenes, brand_heritage>",
  "visual_metaphor": "<required if visual_strategy is 'metaphor_driven', 3-200 chars. Otherwise null.>"
}}

VISUAL STRATEGY GUIDE (pick exactly one):
- human_story: Subject is a person in a real moment. DEFAULT for SaaS/founder pain points.
- metaphor_driven: Subject is a concrete object/scene representing an abstract concept. Use when human story doesn't fit.
- product_shot: Subject is a product or interface. Use sparingly, only for product launches.
- data_visualization: Subject is a chart, graph, or screenshot. Use only when the data IS the story.
- behind_scenes: Subject is a workspace, process, or in-progress moment.
- brand_heritage: Subject is brand-anchored imagery (founder portrait, signature setting). Use rarely.

CRITICAL RULES:
- The image MUST work as a standalone thumb-stopper. Would a stranger scrolling at 2am stop on this image?
- Focus on the EMOTIONAL HUMAN CONSEQUENCE of the pain point, not the tool itself.
- Do NOT describe text overlays, captions, watermarks, UI elements, or logos. Those are added separately in post-production.
- Do NOT just paraphrase the caption. Translate it to visuals.
- For pain points about software/tools, prefer showing the human consequence (a tired founder) over the tool itself (a screenshot).
- The mood_descriptor and emotional_anchor should align with the BRAND_MOOD. If brand mood is "warm and human" don't pick "cold and clinical".
- emotional_anchor is a short tag (1-3 words). mood_descriptor is the full phrase. They describe the same emotion at two different levels of detail.
- Keep the visual concept achievable for an image model. Avoid impossible spatial relationships, hyperspecific cultural references, or anything requiring legible text.

Return only the JSON. No preamble, no markdown fences, no thinking."""


# ============================================================================
# Client protocol
# ============================================================================

class LLMClient(Protocol):
    """Minimal protocol the extractor needs from an LLM client.

    Anthropic SDK and OpenAI SDK both expose an async method that fits this
    shape with light wrapping. Pass an adapter from your existing service
    layer.
    """

    async def complete_json(self, *, model: str, prompt: str, max_tokens: int = 600) -> str:
        """Run inference and return the raw text response. Caller parses JSON."""
        ...


# ============================================================================
# Public API
# ============================================================================

async def extract_subject_block(
    *,
    pain_point: str,
    caption: str,
    brand_archetype: str,
    brand_mood: str,
    client: LLMClient,
    model: str = "claude-haiku-4-5",
    max_retries: int = 2,
) -> SubjectBlock:
    """Extract a SubjectBlock by calling a fast LLM.

    Args:
        pain_point:      the audience pain / insight the post addresses
        caption:         the post's caption (will not be sent verbatim to image model)
        brand_archetype: from BrandBible.archetype.primary
        brand_mood:      from BrandBible.visual.photographyMood
        client:          an LLMClient adapter (your service-layer wrapper)
        model:           model identifier. Default Haiku for speed/cost.
        max_retries:     how many times to retry on parse/validation failure.

    Returns:
        Validated SubjectBlock.

    Raises:
        SubjectExtractionError if all retries fail.
    """
    prompt = SUBJECT_EXTRACTION_PROMPT.format(
        pain_point=pain_point.strip(),
        caption=caption.strip(),
        brand_archetype=brand_archetype.strip(),
        brand_mood=brand_mood.strip(),
    )

    last_error: Exception | None = None

    for attempt in range(max_retries + 1):
        try:
            raw_response = await client.complete_json(
                model=model,
                prompt=prompt,
                max_tokens=600,
            )
            payload = _extract_json_object(raw_response)
            subject = SubjectBlock.model_validate(payload)
            return subject
        except (json.JSONDecodeError, ValueError) as e:
            last_error = e
            continue

    raise SubjectExtractionError(
        f"Failed to extract SubjectBlock after {max_retries + 1} attempts. "
        f"Last error: {last_error}"
    )


# ============================================================================
# Helpers
# ============================================================================

def _extract_json_object(raw: str) -> dict[str, Any]:
    """Extract the first JSON object from a string, tolerating markdown fences
    and minor model preamble.
    """
    text = raw.strip()

    # Strip markdown fences if present
    if text.startswith("```"):
        # Drop opening fence (```json or ```)
        text = text.split("\n", 1)[1] if "\n" in text else text
        # Drop closing fence
        if text.endswith("```"):
            text = text.rsplit("```", 1)[0]
        text = text.strip()

    # Find first { and last } to bracket the JSON
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise json.JSONDecodeError("No JSON object found in response", text, 0)

    return json.loads(text[start : end + 1])


# ============================================================================
# Exceptions
# ============================================================================

class SubjectExtractionError(Exception):
    """Raised when the extractor fails to produce a valid SubjectBlock after
    all retries. Caller should fall back to a default subject or raise to user.
    """
