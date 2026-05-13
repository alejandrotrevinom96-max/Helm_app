"""
ugc_consolidated.py
===================

Single-file consolidation of the 4 UGC modules for review purposes.

In production, keep these split into separate files:
  - ugc_schema.py      Pydantic models for the bundle
  - ugc_prompt.py      Prompt instructions appended for content_type=UGC
  - ugc_validator.py   Soft validation rules after Pydantic schema check
  - ugc_extractor.py   Downstream extractors (HeyGen, video editor, scheduler)

This consolidated file is the same code, organized into sections, for
end-to-end review without jumping between files.

Changes vs v1.0:
  - Hook word count cap: 10 → 9 (stricter, matches production UGC research)
  - HookSection.text max_length: 200 → 180 (realistic for 9-word hook)
  - Spoken cadence rules in prompt: explicit contraction examples
  - "Founder over coffee" framing for voice
  - "Return ONLY this JSON" hardened
  - 3 new weak openers in validator
  - Reminder line in append_ugc_schema_to_prompt pointing back to CLIENT CONTEXT

Sections:
  1. Schema             enums, sections, UGCBundle aggregate
  2. Prompt             UGC_OUTPUT_SCHEMA_INSTRUCTION + helper
  3. Validator          soft validation rules
  4. Extractor          downstream extraction utilities

Dependencies:
  - pydantic >= 2.0

Version: 1.1 (MVP Phase 1, hook tightened + cadence rules expanded)
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, field_validator


# ============================================================================
# SECTION 1: SCHEMA (originally ugc_schema.py)
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
        word_count = len(v.split())
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
        if len(v.split()) > 5:
            raise ValueError(
                f"Overlay '{v}' has {len(v.split())} words; max is 5. "
                f"Overlays longer than 5 words are an anti-pattern."
            )
        return v


class UGCMetadata(BaseModel):
    """Bundle-level metadata. The model is responsible for setting
    passes_swipe_test honestly after running its own check.
    """
    model_config = ConfigDict(extra="forbid")

    language: str = Field(default="en", min_length=2, max_length=8)
    platform: str  # tiktok, instagram, threads, linkedin, facebook
    passes_swipe_test: bool = Field(
        default=True,
        description="Self-reported by the model after running the 0.5-second swipe test.",
    )


class UGCBundle(BaseModel):
    """The complete UGC output. Single source of truth.

    Downstream consumers (see extractor section below):
      - HeyGen / TTS:        extract_script_for_heygen(bundle)
      - Video editor:        extract_overlay_track(bundle)
      - Social scheduler:    extract_caption_for_post(bundle)
      - Storyboard view:     extract_beat_breakdown(bundle)
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


# ============================================================================
# SECTION 2: PROMPT (originally ugc_prompt.py)
# ============================================================================


UGC_OUTPUT_SCHEMA_INSTRUCTION = """
OUTPUT FORMAT (mandatory)
=========================

Return ONLY this JSON. No commentary, no markdown fences, no preamble, no
thinking tags. One JSON object, nothing else.

{
  "hook": {
    "text": "<5 to 9 spoken words, the attention grab>",
    "duration_seconds": <1.0 to 4.0>,
    "delivery": "<one of: punchy, confessional, emphatic>"
  },
  "body": [
    {
      "beat": 1,
      "text": "<one idea, supports the hook, builds toward reveal>",
      "duration_seconds": <2.0 to 15.0>,
      "delivery": "<one of: explanatory, tension, reveal, emphatic>"
    }
    // 1 to 5 beats total. Number them sequentially starting at 1.
  ],
  "cta": {
    "text": "<organic conversational ask, never a sales pitch>",
    "duration_seconds": <2.0 to 6.0>,
    "delivery": "<one of: warm, punchy>"
  },
  "overlays": [
    {
      "text": "<3 to 5 words max, all caps for emphasis is fine>",
      "trigger_at_seconds": <when in the video, measured from start>,
      "duration_seconds": <0.5 to 5.0>
    }
    // 3 to 8 overlays total
  ],
  "caption": "<1 to 3 sentences, extends the video, includes a soft CTA>",
  "hashtags": ["tag1", "tag2", "tag3"],   // 3 to 5 tags WITHOUT the # prefix
  "metadata": {
    "language": "en",
    "platform": "<the target platform, set explicitly>",
    "passes_swipe_test": true
  }
}

CRITICAL SPOKEN CADENCE RULES (apply to hook, body, and cta)
============================================================

  - Heavy contractions: I'm, you're, doesn't, can't, gonna, wanna, that's,
    here's, what's, it's. Written-out forms sound robotic on camera.
  - Sentence fragments are encouraged. People talk in fragments.
  - One clear idea per sentence. No compound clauses stitched with "and".
  - Talk like you're explaining it to another founder over coffee, not like
    you're presenting in a conference room.
  - Never use written-text language ("Today I want to discuss...",
    "In this video...", "Let's talk about...").
  - Use "I" and "you" heavily. Never "we" (company voice) or "one" (impersonal).

HOOK RULES (most important part of the entire video)
====================================================

  - 5 to 9 spoken words maximum. No exceptions.
  - Must pass the 0.5-second swipe test: would a stranger scrolling at 2am
    keep watching past the first half-second of this video? Set
    metadata.passes_swipe_test honestly based on this check.
  - Best patterns: specific confession ("I used to..."), surprising number
    ("I spent 156 hours..."), pattern interrupt ("Stop using X"), contrarian
    setup ("Everyone's wrong about Y").

DELIVERY STYLE OPTIONS
======================

  punchy          Fast, high-energy. Use for hooks and CTAs that need impact.
  explanatory     Calm, informative. Use for body beats that establish context.
  tension         Building, slightly slower. Use for body beats setting up reveal.
  reveal          The payoff moment, emphatic but not loud.
  warm            Friendly, conversational. Use for CTAs that invite reply.
  confessional    First-person admission, slightly vulnerable. Use for hooks
                  that confess ("I used to...").
  emphatic        Stressed, slow. Use sparingly for the single most important line.

OVERLAY RULES
=============

  - Reinforce the spoken word, never repeat it verbatim. If the speaker says
    "I dropped Buffer last month", a good overlay is "BUFFER" or "DROPPED".
    A bad overlay is "I dropped Buffer last month" (verbatim repeat).
  - 3 to 5 words max per overlay. Numbers, key phrases, callouts only.
  - Place overlays at moments of emphasis (numbers, key phrases, transitions).
    They should land mid-beat, not at beat boundaries.
  - trigger_at_seconds is measured from the start of the video, not the start
    of the section the overlay lands in.

CAPTION RULES
=============

  - 1 to 3 sentences max.
  - Extends the video. Acts as the post-credit scene. Add context, ask a
    question, or tease the next post.
  - Includes a soft CTA that hooks the next watch.
  - Never starts with "In this video", "Today I'm talking about", or other
    summary phrases. The caption is not a description of the video.

HASHTAG RULES
=============

  - 3 to 5 tags total.
  - Mix: 1 to 2 broad/trending + 2 to 3 niche.
  - Stored WITHOUT the # prefix (e.g., "indiehacker" not "#indiehacker").
  - All lowercase. No spaces.

VALIDATION CHECKLIST (run before returning)
============================================

  [ ] hook.text is 5 to 9 spoken words
  [ ] hook passes the 0.5-second swipe test (set passes_swipe_test honestly)
  [ ] body has 1 to 5 beats, each delivering one idea
  [ ] body beats numbered sequentially starting at 1
  [ ] cta is conversational, not a sales pitch
  [ ] overlays count is 3 to 8
  [ ] each overlay has 3 to 5 words max
  [ ] no overlay repeats spoken text verbatim
  [ ] caption extends the video instead of summarizing it
  [ ] caption length 20 to 500 chars
  [ ] 3 to 5 hashtags, mix of broad and niche, no # prefix
  [ ] script uses heavy contractions and sentence fragments
  [ ] first-person voice throughout (I/you, never we/one)
  [ ] no anti-patterns from PLATFORM_TONE triggered
  [ ] total duration (hook + body + cta) lands between 15 and 60 seconds

If any check fails, regenerate the entire bundle before returning. The bundle
will be rejected automatically by the schema validator if any field violates
the JSON schema (e.g., overlay text > 5 words, body has 6+ beats, hook > 9
words). You will get the failure reason and be asked to retry.
"""


def append_ugc_schema_to_prompt(base_prompt: str, target_platform: str) -> str:
    """Append the UGC bundle schema instructions to a base generation prompt.

    Use only when content_type=UGC. For other content types, the base prompt's
    instructions for output format apply (free-form text + override_log tags).

    Args:
        base_prompt:     the prompt produced by build_generation_prompt()
        target_platform: the platform string (tiktok, instagram, threads,
                         linkedin, facebook). Injected into metadata.platform
                         so the model can't accidentally set it to something
                         else.

    Returns:
        The full prompt with UGC schema instructions appended, plus a
        reminder pointing back to the CLIENT CONTEXT block at the top of
        the base prompt so the model doesn't lose the per-client signal
        when reading the schema instructions at the end.
    """
    return f"""{base_prompt}

{UGC_OUTPUT_SCHEMA_INSTRUCTION}

The metadata.platform field MUST be set to "{target_platform}".

IMPORTANT: The CLIENT CONTEXT (BRAND_BIBLE, VOICE_FINGERPRINT, LEARNED_OVERRIDES,
WINNING_UGC_EXAMPLES and ANTI_SAMPLES) appears at the top of this prompt.
Use them to override the defaults in this schema while staying within the hard
limits (9-word hook, 5-word overlays, etc.).
The final bundle must sound like THIS specific founder, not generic UGC content.
"""


# ============================================================================
# SECTION 3: VALIDATOR (originally ugc_validator.py)
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
    a good overlay is "BUFFER". A bad overlay is "I dropped Buffer last month".

    Only flags overlays with 3+ words that appear verbatim, since 1-2 word
    callouts (like "BUFFER") legitimately echo single words from the script.
    """
    spoken_lower = bundle.script_text.lower()
    failures: list[str] = []
    for i, overlay in enumerate(bundle.overlays, 1):
        overlay_lower = overlay.text.lower().strip()
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


# ============================================================================
# SECTION 4: EXTRACTOR (originally ugc_extractor.py)
# ============================================================================


def extract_script_for_heygen(bundle: UGCBundle) -> str:
    """Concatenate hook + body beats + CTA into a single string for TTS.

    Spaces between sections; no SSML tags in MVP. Phase 1.5 can add SSML
    delivery hints if HeyGen's API supports them on the relevant voice.

    Drop-in replacement for the previous extractScriptText() that read
    {opening, body, closing}. Behavior: hook + body in beat order + cta.
    """
    return bundle.script_text


def extract_overlay_track(bundle: UGCBundle) -> list[dict]:
    """Return overlay timing data formatted for video editor import."""
    return [
        {
            "text": o.text,
            "start_seconds": o.trigger_at_seconds,
            "end_seconds": o.trigger_at_seconds + o.duration_seconds,
            "duration_seconds": o.duration_seconds,
        }
        for o in bundle.overlays
    ]


def extract_caption_for_post(bundle: UGCBundle, include_hashtags: bool = True) -> str:
    """Format the caption for social media post upload."""
    if not include_hashtags or not bundle.hashtags:
        return bundle.caption

    hashtag_block = " ".join(f"#{tag}" for tag in bundle.hashtags)
    return f"{bundle.caption}\n\n{hashtag_block}"


def extract_hashtag_list(bundle: UGCBundle, with_prefix: bool = True) -> list[str]:
    """Return hashtags as a list, optionally with the # prefix added back."""
    if with_prefix:
        return [f"#{tag}" for tag in bundle.hashtags]
    return list(bundle.hashtags)


def extract_beat_breakdown(bundle: UGCBundle) -> list[dict]:
    """Return a beat-by-beat breakdown including running timing."""
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


def extract_full_export(bundle: UGCBundle) -> dict:
    """Return everything: script, overlays, caption, hashtags, beat breakdown."""
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


# ============================================================================
# End of consolidated UGC module v1.1
# ============================================================================
