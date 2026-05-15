"""
ugc_schema.py
=============

JSON schema for the UGC (scripted video) output bundle.

The model returns a single structured object containing everything downstream
consumers need:
  - hook                 (0-3s, the attention grab)
  - body                 (3-45s, broken into 1-5 beats)
  - cta                  (3-5s, conversational ask)
  - overlays             (3-8 on-screen text snippets with timing)
  - caption              (post description for the platform)
  - hashtags             (3-5 mix of broad and niche, no # prefix in storage)
  - metadata             (language, platform, swipe-test self-report)

This schema is validated server-side after generation. Validation failures
trigger regeneration with the failure reasons sent back to the model.

Replaces the previous flat {opening, body, closing} JSON. Existing consumers
that called the old shape need to be migrated; ugc_extractor.py handles the
HeyGen flat-string extraction.

Version: 1.0
"""

from __future__ import annotations

import re
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, field_validator


# ============================================================================
# Word-counting helper
# ============================================================================
#
# Hotfix — both word-count validators used `len(v.split())`, which counts
# EVERY whitespace-separated token. That includes pure-emoji tokens like
# ❌ or ✅. So an overlay like "BUFFER ❌ NOTION ❌ FIGMA ❌" (three brand
# names plus three pictogram markers — exactly the "BRAND ❌" pattern
# ugc_validator.py explicitly recommends) was rejected as "6 words; max
# is 5" and the entire video generation failed.
#
# `_count_lexical_words` only counts tokens that contain at least one
# letter or digit (Unicode-aware). Pictogram-only tokens (emoji, dashes,
# bullets, arrows) don't increment the count.
#
#   "BUFFER ❌ NOTION ❌ FIGMA ❌"  → 3 (was 6)
#   "I dropped Buffer last month"  → 5 (unchanged)
#   "$1M in 6 months"              → 4 (unchanged — digits count)
#   "❌"                            → 0 (was 1; pure pictograms aren't
#                                       a word)
#
# Mirrored in lib/voice-engine/ugc-schema.ts (countLexicalWords) so the
# TS and Python paths agree.
_LEXICAL_CHAR_RE = re.compile(r"[^\W_]", re.UNICODE)


def _count_lexical_words(text: str) -> int:
    return sum(1 for token in text.split() if _LEXICAL_CHAR_RE.search(token))


# ============================================================================
# Enums
# ============================================================================

class DeliveryStyle(str, Enum):
    """How the line should be performed on camera or by TTS.

    Used by HeyGen / TTS engines that support delivery hints, and by
    post-production for editing decisions (cut on emphasis, slow on tension).
    """
    PUNCHY = "punchy"               # Fast, high-energy, attention-grabbing
    EXPLANATORY = "explanatory"     # Calm, informative
    TENSION = "tension"             # Building toward a reveal, slightly slower
    REVEAL = "reveal"               # The payoff moment, emphatic but controlled
    WARM = "warm"                   # Friendly, conversational close
    CONFESSIONAL = "confessional"   # First-person admission, slightly vulnerable
    EMPHATIC = "emphatic"           # Stressed, slow. Use sparingly.


# ============================================================================
# Sections
# ============================================================================

class HookSection(BaseModel):
    """The first 0-3 seconds. Single most important piece of the bundle.

    Must pass the 0.5-second swipe test: would a stranger keep watching past
    the first half-second?
    """
    model_config = ConfigDict(extra="forbid")

    text: str = Field(..., min_length=10, max_length=180)
    duration_seconds: float = Field(..., ge=1.0, le=4.0)
    delivery: DeliveryStyle

    @field_validator("text")
    @classmethod
    def hook_word_count(cls, v: str) -> str:
        # Lexical word count (alphanumeric tokens only). See module docstring.
        word_count = _count_lexical_words(v)
        if word_count > 9:
            raise ValueError(
                f"Hook has {word_count} words. Maximum is 9 spoken words. "
                f"Current hook: '{v}'. Trim it aggressively."
            )
        return v


class BodyBeat(BaseModel):
    """One beat of the body section. Beats run sequentially (1, 2, 3...).

    Each beat delivers exactly one idea and ends on tension or specificity
    that pulls the viewer to the next beat.
    """
    model_config = ConfigDict(extra="forbid")

    beat: int = Field(..., ge=1, le=5)
    text: str = Field(..., min_length=20, max_length=400)
    duration_seconds: float = Field(..., ge=2.0, le=15.0)
    delivery: DeliveryStyle


class CTASection(BaseModel):
    """The closing 3-5 seconds. Conversational ask, never a sales pitch."""
    model_config = ConfigDict(extra="forbid")

    text: str = Field(..., min_length=10, max_length=200)
    duration_seconds: float = Field(..., ge=2.0, le=6.0)
    delivery: DeliveryStyle


class Overlay(BaseModel):
    """An on-screen text overlay. Reinforces the spoken word, never repeats it.

    trigger_at_seconds is measured from the start of the video (not the start
    of the section it lands in). Post-production uses this to place text on
    the timeline.
    """
    model_config = ConfigDict(extra="forbid")

    text: str = Field(..., min_length=1, max_length=40)
    trigger_at_seconds: float = Field(..., ge=0.0)
    duration_seconds: float = Field(..., ge=0.5, le=5.0)

    @field_validator("text")
    @classmethod
    def overlay_word_count(cls, v: str) -> str:
        # Lexical word count — emoji like ❌ ✅ → don't inflate the count.
        # ugc_validator.py explicitly recommends "BRAND ❌" shapes;
        # counting the pictogram made that pattern un-shippable.
        word_count = _count_lexical_words(v)
        if word_count > 5:
            raise ValueError(
                f"Overlay '{v}' has {word_count} words; max is 5. "
                f"Overlays longer than 5 words are an anti-pattern."
            )
        return v


class UGCMetadata(BaseModel):
    """Bundle-level metadata. The model is responsible for setting passes_swipe_test
    honestly after running its own check.
    """
    model_config = ConfigDict(extra="forbid")

    language: str = Field(default="en", min_length=2, max_length=8)
    platform: str  # tiktok, instagram, threads, linkedin, facebook
    passes_swipe_test: bool = Field(
        default=True,
        description="Self-reported by the model after running the 0.5-second swipe test.",
    )


# ============================================================================
# UGCBundle (top-level)
# ============================================================================

class UGCBundle(BaseModel):
    """The complete UGC output. Single source of truth.

    Downstream consumers:
      - HeyGen / TTS:        ugc_extractor.extract_script_for_heygen(bundle)
      - Video editor:        ugc_extractor.extract_overlay_track(bundle)
      - Social scheduler:    ugc_extractor.extract_caption_for_post(bundle)
      - Storyboard view:     ugc_extractor.extract_beat_breakdown(bundle)
    """
    model_config = ConfigDict(extra="forbid")

    hook: HookSection
    body: list[BodyBeat] = Field(..., min_length=1, max_length=5)
    cta: CTASection
    overlays: list[Overlay] = Field(default_factory=list, min_length=3, max_length=8)
    caption: str = Field(..., min_length=20, max_length=500)
    hashtags: list[str] = Field(default_factory=list, min_length=3, max_length=5)
    metadata: UGCMetadata

    @property
    def total_duration_seconds(self) -> float:
        """Sum of hook + all body beats + cta. Used for validation."""
        return (
            self.hook.duration_seconds
            + sum(b.duration_seconds for b in self.body)
            + self.cta.duration_seconds
        )

    @property
    def script_text(self) -> str:
        """Flat concatenated script for HeyGen / TTS engines.

        Order: hook + body beats (in beat order) + cta. Spaces between sections.
        """
        parts = [self.hook.text]
        parts.extend(b.text for b in self.body)
        parts.append(self.cta.text)
        return " ".join(parts)

    @field_validator("body")
    @classmethod
    def body_beats_sequential(cls, v: list[BodyBeat]) -> list[BodyBeat]:
        """Beats must be numbered 1, 2, 3... in order. Catches model errors
        where it skips a beat number or ships them out of order.
        """
        for i, beat in enumerate(v, 1):
            if beat.beat != i:
                raise ValueError(
                    f"Body beats must be sequential starting from 1 "
                    f"(got beat={beat.beat} at position {i})."
                )
        return v

    @field_validator("hashtags")
    @classmethod
    def hashtags_format(cls, v: list[str]) -> list[str]:
        """Hashtags stored without the # prefix; spaces not allowed."""
        cleaned: list[str] = []
        for tag in v:
            if tag.startswith("#"):
                raise ValueError(
                    f"Hashtag '{tag}' should be stored without the # prefix. "
                    f"The # is added at extraction time."
                )
            if " " in tag:
                raise ValueError(f"Hashtag '{tag}' contains a space.")
            cleaned.append(tag.lower().strip())
        return cleaned
