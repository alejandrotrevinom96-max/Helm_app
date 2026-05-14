"""
visual_validator.py
===================

Server-side soft validation of VisualPromptIR after build_visual_prompt_ir().

Pydantic enforces the schema (field types, lengths, ranges). This module
catches the rules that depend on cross-field relationships, brand-mood
coherence, or known image-model failure patterns.

Usage:
    from visual_validator import validate_visual_prompt_ir

    failures = validate_visual_prompt_ir(ir)
    if failures:
        # Either return to operator with failure reasons, or regenerate
        # specific blocks (typically rerun extract_subject_block with
        # the failure reason as additional context)
        ...

Version: 1.0 (MVP Phase 1)
"""

from __future__ import annotations

from visual_schema import VisualPromptIR


# ============================================================================
# Constants for validation
# ============================================================================

# Words/phrases in the SubjectBlock that signal the model gave up and
# defaulted to abstraction. These produce stock-feeling output.
SUBJECT_LAZY_TERMS: tuple[str, ...] = (
    "concept of", "abstract representation",
    "generic image of", "stock photo of",
    "people doing", "person at a desk",
    "modern office", "diverse team", "happy customer",
)

# Words in main_subject that conflict with the "no text" hard rule
SUBJECT_TEXT_TERMS: tuple[str, ...] = (
    "with text", "with caption", "text overlay", "logo",
    "watermark", "title card",
)

# Mood adjective sets that conflict. If brand mood and subject mood don't
# overlap in any of these clusters, validation flags potential mismatch.
MOOD_CLUSTERS: dict[str, set[str]] = {
    "warm": {"warm", "human", "friendly", "cozy", "intimate", "natural"},
    "clinical": {"clinical", "minimal", "clean", "sterile", "precise", "technical"},
    "gritty": {"gritty", "raw", "documentary", "unfiltered", "moody", "dark"},
    "aspirational": {"aspirational", "polished", "luxe", "elegant", "refined"},
    "energetic": {"energetic", "bold", "vibrant", "dynamic", "high-energy"},
}


# ============================================================================
# Public API
# ============================================================================

def validate_visual_prompt_ir(ir: VisualPromptIR) -> list[str]:
    """Run all soft validation rules against a VisualPromptIR.

    Pydantic already enforced the schema. These checks catch logical
    inconsistencies, brand misalignment, and known image-model failure
    patterns.

    Returns:
        Empty list if all validations pass. Otherwise, list of human-readable
        failure messages. Caller can either reject + regenerate or surface to
        operator.
    """
    failures: list[str] = []

    failures.extend(_check_subject_not_lazy(ir))
    failures.extend(_check_subject_no_text_instructions(ir))
    failures.extend(_check_brand_mood_coherence(ir))
    failures.extend(_check_color_palette_size(ir))
    failures.extend(_check_negative_block_completeness(ir))
    failures.extend(_check_aspect_ratio_consistency(ir))

    return failures


# ============================================================================
# Individual checks
# ============================================================================

def _check_subject_not_lazy(ir: VisualPromptIR) -> list[str]:
    """Catches the model giving up and producing abstract/generic descriptions.

    'A concept of productivity' or 'diverse team in modern office' are signs
    the SubjectBlock extraction failed to translate the pain point and
    defaulted to stock-photo-speak.
    """
    subject_lower = ir.subject.main_subject.lower()
    for term in SUBJECT_LAZY_TERMS:
        if term in subject_lower:
            return [
                f"SubjectBlock.main_subject contains lazy phrase '{term}'. "
                f"Re-run extract_subject_block with feedback that the visual "
                f"should be specific and concrete, not abstract or stock."
            ]
    return []


def _check_subject_no_text_instructions(ir: VisualPromptIR) -> list[str]:
    """Belt-and-suspenders: Pydantic validator catches this in main_subject,
    but this check also looks at composition/setting where the validator
    doesn't run.
    """
    failures: list[str] = []
    fields_to_check = {
        "composition": ir.subject.composition,
        "setting": ir.subject.setting,
        "visual_metaphor": ir.subject.visual_metaphor or "",
    }
    for field_name, value in fields_to_check.items():
        value_lower = value.lower()
        for term in SUBJECT_TEXT_TERMS:
            if term in value_lower:
                failures.append(
                    f"SubjectBlock.{field_name} contains text-instruction "
                    f"phrase '{term}'. Text overlays are added separately. "
                    f"Remove from {field_name}."
                )
    return failures


def _check_brand_mood_coherence(ir: VisualPromptIR) -> list[str]:
    """The mood_descriptor and emotional_anchor in SubjectBlock should be in
    the same emotional cluster as the brand mood. A 'warm and human' brand
    should not produce 'cold and clinical' subject moods.

    Heuristic: if the subject mood matches a cluster, the brand mood should
    too (or at least not be in a directly opposite cluster).
    """
    brand_mood = ir.brand.mood.lower()
    brand_cluster = _mood_to_cluster(brand_mood)

    if brand_cluster is None:
        return []

    failures: list[str] = []
    opposing_pairs = (
        ("warm", "clinical"),
        ("warm", "gritty"),
        ("aspirational", "gritty"),
    )

    # Check mood_descriptor against brand mood
    subject_mood = ir.subject.mood_descriptor.lower()
    subject_cluster = _mood_to_cluster(subject_mood)
    if subject_cluster:
        for a, b in opposing_pairs:
            if {subject_cluster, brand_cluster} == {a, b}:
                failures.append(
                    f"Brand mood '{ir.brand.mood}' (cluster: {brand_cluster}) and "
                    f"subject mood_descriptor '{ir.subject.mood_descriptor}' "
                    f"(cluster: {subject_cluster}) are in opposing emotional "
                    f"clusters. Re-run extract_subject_block with brand mood "
                    f"as a stronger constraint."
                )
                break

    # Check emotional_anchor against brand mood (if present)
    if ir.subject.emotional_anchor:
        anchor = ir.subject.emotional_anchor.lower()
        anchor_cluster = _mood_to_cluster(anchor)
        if anchor_cluster:
            for a, b in opposing_pairs:
                if {anchor_cluster, brand_cluster} == {a, b}:
                    failures.append(
                        f"Brand mood '{ir.brand.mood}' (cluster: {brand_cluster}) "
                        f"and subject emotional_anchor '{ir.subject.emotional_anchor}' "
                        f"(cluster: {anchor_cluster}) are in opposing emotional "
                        f"clusters."
                    )
                    break

    return failures


def _check_color_palette_size(ir: VisualPromptIR) -> list[str]:
    """A color palette of 0 or 1 colors gives the image model no real
    direction; 6+ creates muddy output.
    """
    n = len(ir.brand.color_palette)
    if n == 0:
        return [
            "BrandBlock.color_palette is empty. Image will use Flux defaults "
            "and won't reflect brand. Add 1-5 colors from BrandBible."
        ]
    if n > 5:
        return [
            f"BrandBlock.color_palette has {n} colors. More than 5 produces "
            f"muddy output. Trim to 3-4 most representative colors."
        ]
    return []


def _check_negative_block_completeness(ir: VisualPromptIR) -> list[str]:
    """The default NegativeBlock has the critical AI-image anti-patterns. If
    a caller overrode it and removed all the defaults, flag it.
    """
    critical_avoids = {"text in image", "watermark", "distorted hands or faces"}
    avoid_set = {term.lower() for term in ir.negative.avoid_terms}
    missing = critical_avoids - avoid_set
    if missing:
        return [
            f"NegativeBlock missing critical anti-patterns: {sorted(missing)}. "
            f"These are nearly always wanted unless the brand intentionally "
            f"uses them. Re-add or confirm intentional override."
        ]
    return []


def _check_aspect_ratio_consistency(ir: VisualPromptIR) -> list[str]:
    """Aspect ratio in PlatformBlock should match the canonical mapping for
    (platform, content_type). Mismatches usually mean the caller passed a
    custom override; flag for confirmation.
    """
    from platform_visual_language import get_aspect_ratio

    try:
        expected = get_aspect_ratio(ir.platform.platform, ir.platform.content_type)
    except ValueError:
        # No mapping exists for this platform/content_type. Skip.
        return []

    if ir.platform.aspect_ratio != expected:
        return [
            f"PlatformBlock.aspect_ratio is {ir.platform.aspect_ratio.value} "
            f"but canonical mapping for ({ir.platform.platform}, "
            f"{ir.platform.content_type}) is {expected.value}. Confirm "
            f"intentional override or regenerate with default."
        ]
    return []


# ============================================================================
# Internal helpers
# ============================================================================

def _mood_to_cluster(mood_text: str) -> str | None:
    """Map a free-text mood descriptor to one of the known mood clusters.

    Returns the cluster name if any cluster keyword appears in the mood
    text, otherwise None.
    """
    mood_lower = mood_text.lower()
    for cluster_name, keywords in MOOD_CLUSTERS.items():
        if any(kw in mood_lower for kw in keywords):
            return cluster_name
    return None
