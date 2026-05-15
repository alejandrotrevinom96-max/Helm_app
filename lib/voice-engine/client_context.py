"""
client_context.py
=================

Data models for the Helm Adaptive Voice Engine v1.0 (MVP Phase 1).

Defines the ClientContext aggregate and all supporting types: Signal, Override,
AuditEntry, WeightedPost, PerformanceProxy, BrandBible.

This module is the foundation. diff_classifier, feedback_loop_service, and
prompt_builder all import from here.

Architectural notes:
  - All slots reserved up front (even those unused in MVP) to avoid migration
    later. cross_platform_voice, performance_proxies usage in prompt, and
    shadow mode all have placeholders.
  - learned_overrides is per-platform per-dimension to prevent cross-platform
    contamination.
  - Audit log captures every state change with rollback handle for invisible
    debugging by operators.

Dependencies:
  - pydantic >= 2.0

Version: 1.0 (MVP Phase 1)
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field


# ============================================================================
# Enums
# ============================================================================

class Platform(str, Enum):
    INSTAGRAM = "instagram"
    LINKEDIN = "linkedin"
    X = "x"
    THREADS = "threads"
    FACEBOOK = "facebook"
    REDDIT = "reddit"
    TIKTOK = "tiktok"


class ContentType(str, Enum):
    UGC = "ugc"
    CAROUSEL = "carousel"
    PHOTO = "photo"
    TEXT = "text"


class Dimension(str, Enum):
    """Learnable dimensions per platform.

    Adding a new dimension requires updating the diff classifier and the
    feedback loop service to handle it. Don't add casually.
    """
    BANNED_VOCAB = "banned_vocab"
    MANDATORY_SIGNALS = "mandatory_signals"
    HOOK_LENGTH = "hook_length"
    CTA_STYLE = "cta_style"
    SENTENCE_CADENCE = "sentence_cadence"
    EMOJI_USAGE = "emoji_usage"
    HASHTAG_STRATEGY = "hashtag_strategy"
    TONE_INTENSITY = "tone_intensity"
    PARAGRAPH_LENGTH = "paragraph_length"


class MaturityStage(str, Enum):
    NEW = "new"          # 0-8 posts on this platform
    EARLY = "early"      # 9-20 posts
    GROWING = "growing"  # 21-60 posts
    MATURE = "mature"    # 60+ posts


class FeedbackTier(str, Enum):
    PUBLISH_AS_IS = "publish_as_is"  # weight 1.0
    MINOR_EDITS = "minor_edits"      # weight 0.7
    REGENERATE = "regenerate"        # weight -0.5
    DISCARD = "discard"              # weight -1.0


class Volatility(str, Enum):
    """Per-dimension volatility tag. Affects decay rate and update thresholds."""
    LOW = "low"        # Voice signature, banned vocab. Rarely change.
    MEDIUM = "medium"  # Hook length, CTA style. Drift over months.
    HIGH = "high"      # Trend dimensions (hashtags, sound trends). Drift weekly.


class SignalSource(str, Enum):
    EDIT_DIFF = "edit_diff"
    EXPLICIT_FEEDBACK = "explicit_feedback"
    TIERED_RATING = "tiered_rating"
    LIKE_DISLIKE = "like_dislike"
    PERFORMANCE_PROXY = "performance_proxy"  # Reserved for Phase 2


class PostArchetype(str, Enum):
    """High-level post type that the variety injector tracks and rotates.

    Most posts are ESSAY (the structured default). Variety injection forces
    a different archetype to break the predictable pattern in a feed.
    """
    ESSAY = "essay"           # Default: structured, headed, with insights
    SHITPOST = "shitpost"     # Very short, casual, fragmentary
    CONTRARIAN = "contrarian"  # Unpopular take
    OBSERVATION = "observation"  # Quick noticing, < 100 words
    VULNERABLE = "vulnerable"  # Personal admission, no resolution
    DATA_DROP = "data_drop"   # Number/stat heavy
    STORY = "story"           # Narrative chronological
    QUESTION = "question"     # Genuinely asking
    META = "meta"             # Reflecting on the work itself


# ============================================================================
# Building blocks
# ============================================================================

class Signal(BaseModel):
    """A single learning signal captured from user behavior or performance.

    Signals are the input to the feedback loop. They get aggregated into
    Override updates after crossing maturity-stage thresholds.
    """
    model_config = ConfigDict(frozen=True)

    id: UUID = Field(default_factory=uuid4)
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    source: SignalSource
    platform: Platform
    content_type: ContentType
    dimension: Dimension
    value_delta: dict[str, Any]
    confidence: float = Field(ge=0.0, le=1.0, default=1.0)
    weight: float = 1.0
    post_id: UUID | None = None
    notes: str | None = None


class Override(BaseModel):
    """A learned rule that overrides a default for a (platform, dimension) tuple."""
    dimension: Dimension
    platform: Platform
    value: Any
    volatility: Volatility = Volatility.MEDIUM
    confidence: float = Field(ge=0.0, le=1.0, default=0.5)
    sample_count: int = 0
    last_validated: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    last_updated: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    source_signal_ids: list[UUID] = Field(default_factory=list)

    def is_stale(self, max_days: int = 90) -> bool:
        delta = datetime.now(timezone.utc) - self.last_validated
        return delta.days >= max_days


class AuditEntry(BaseModel):
    """Record of a state change. Invisible to client; operators query for debugging."""
    model_config = ConfigDict(frozen=True)

    id: UUID = Field(default_factory=uuid4)
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    action: str
    platform: Platform | None = None
    dimension: Dimension | None = None
    previous_value: Any = None
    new_value: Any = None
    triggering_signals: list[UUID] = Field(default_factory=list)
    operator_id: str | None = None
    notes: str | None = None


class WeightedPost(BaseModel):
    """A past post stored in voice_fingerprint or winning/losing patterns.

    The weight combines quality signal (e.g., publish_as_is = high) with
    recency decay (newer posts weighted more).
    """
    post_id: UUID
    platform: Platform
    content_type: ContentType
    text: str
    posted_at: datetime
    quality_score: float = Field(ge=0.0, le=1.0)
    weight: float = Field(ge=0.0, le=1.0)

    def recency_factor(self, half_life_days: int = 75) -> float:
        delta = datetime.now(timezone.utc) - self.posted_at
        days = max(delta.days, 0)
        return 0.5 ** (days / half_life_days)


class PerformanceProxy(BaseModel):
    """Engagement metrics per post. Captured Day 1 in MVP, not used in prompt yet."""
    post_id: UUID
    platform: Platform
    captured_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    impressions: int | None = None
    likes: int | None = None
    replies: int | None = None
    saves: int | None = None
    shares: int | None = None
    clicks: int | None = None
    notes: str | None = None

    def like_rate(self) -> float | None:
        if self.impressions and self.impressions > 0 and self.likes is not None:
            return self.likes / self.impressions
        return None


class VoiceIdiosyncrasies(BaseModel):
    """Statistical voice patterns extracted from a client's past posts.

    Generated by voice_idiosyncrasy_extractor.py from N >= 10 posts.
    Injected into the prompt as concrete rules (not passive examples) by
    prompt_builder.py.

    Per-platform: each platform has its own VoiceIdiosyncrasies because a
    writer's voice on LinkedIn differs from their voice on TikTok.
    """
    model_config = ConfigDict(extra="forbid")

    sample_size: int = Field(..., ge=10)
    last_extracted: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    # Punctuation patterns
    em_dash_per_1000_words: float = Field(..., ge=0)
    ellipsis_per_1000_words: float = Field(..., ge=0)
    semicolon_per_1000_words: float = Field(..., ge=0)
    parenthetical_aside_per_1000_words: float = Field(..., ge=0)

    # Capitalization
    lowercase_first_letter_ratio: float = Field(..., ge=0, le=1)

    # Vocabulary
    common_filler_words: dict[str, float] = Field(default_factory=dict)  # word -> % of posts
    common_profanity: list[str] = Field(default_factory=list)
    profanity_per_1000_words: float = Field(..., ge=0)

    # Sentence structure
    avg_sentence_length_words: float = Field(..., ge=0)
    fragment_ratio: float = Field(..., ge=0, le=1)

    # Emoji patterns
    emoji_per_post: float = Field(..., ge=0)
    common_emojis: list[str] = Field(default_factory=list)

    # Greeting/sign-off patterns
    common_openers: list[str] = Field(default_factory=list)
    common_closers: list[str] = Field(default_factory=list)

    # Numbers
    hedging_ratio: float = Field(..., ge=0, le=1)

    # Self-correction
    self_correction_count: int = Field(..., ge=0)

    def is_stale(self, max_days: int = 30) -> bool:
        delta = datetime.now(timezone.utc) - self.last_extracted
        return delta.days >= max_days


class ProductBridge(BaseModel):
    """A pain → product bridge entry. Generated by the LLM intake during
    onboarding; reviewed and approved by an operator before being applied
    by the runtime matcher.

    Per-project (lives inside BrandBible inside ClientContext, fully isolated).
    """
    model_config = ConfigDict(extra="forbid")

    pain: str = Field(..., min_length=10, max_length=200,
                      description="The audience pain this bridge addresses. "
                                  "E.g., 'Distribution harder than building'.")
    bridge: str = Field(..., min_length=20, max_length=500,
                        description="How the product fits the answer to this pain. "
                                    "1-2 sentences, woven-into-narrative ready.")
    pending_review: bool = Field(default=True,
                                 description="Kill-switch flag. Matcher ignores "
                                             "bridges where this is True. Default "
                                             "True is defensive: any bridge "
                                             "constructed outside the intake's "
                                             "quality gate is treated as un-vetted. "
                                             "product_bridge_intake.py sets this "
                                             "False after the gate passes. An "
                                             "operator can also flip a specific "
                                             "live bridge True from SQL/admin to "
                                             "disable it without a redeploy.")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    approved_at: datetime | None = Field(default=None)
    approved_by: str | None = Field(default=None)


class BrandBible(BaseModel):
    """The static brand definition the client provides at onboarding.

    Some fields can be updated by the learning loop (banned_phrases,
    mandatory_signals) with safeguards. Others (audience, pillars) are
    operator-managed and not auto-mutated.
    """
    voice: str
    audience: str
    positioning: str
    pillars: list[str]
    banned_phrases: list[str] = Field(default_factory=list)
    mandatory_signals: list[str] = Field(default_factory=list)
    examples_loved: list[str] = Field(default_factory=list)
    examples_hated: list[str] = Field(default_factory=list)

    # Phase 2 (Patch 2): per-project pain → product bridges.
    # Generated by product_bridge_intake.py at onboarding, applied by
    # product_bridge_matcher.py at generation time.
    pain_to_product_bridges: list[ProductBridge] = Field(
        default_factory=list,
        description="Pain → product bridge map. Each ProductBridge connects an "
                    "audience pain to how the client's product fits the answer. "
                    "Per-project, fully isolated. Generated by LLM intake, "
                    "approved by operator. Matched at runtime by LLM."
    )


# ============================================================================
# F4: Variety injection models
# ============================================================================

class ArchetypeUsage(BaseModel):
    """Record of one post's archetype, tracked in a per-platform sliding window
    for variety injection logic.
    """
    model_config = ConfigDict(frozen=True)

    archetype: PostArchetype
    used_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    was_variety_injected: bool = Field(
        default=False,
        description="True if this archetype was selected by the variety injector "
                    "rather than emerging organically from the generation. Used "
                    "for cooldown logic and for excluding from learned_overrides "
                    "feedback signals."
    )


class VarietyConfig(BaseModel):
    """Per-platform configuration for variety injection."""
    model_config = ConfigDict(extra="forbid")

    enabled: bool = True
    injection_probability: float = Field(default=0.15, ge=0.0, le=0.5,
                                         description="Probability per generation. "
                                                     "0.15 = 15% of generations get variety.")
    sliding_window_size: int = Field(default=10, ge=3, le=30,
                                     description="How many recent posts to consider "
                                                 "when selecting the next archetype.")
    cooldown_after_variety: int = Field(default=3, ge=1, le=10,
                                        description="Number of normal generations "
                                                    "required between variety injections.")


# ============================================================================
# Maturity stage configuration
# ============================================================================

# Per-platform, per-stage thresholds. Tuned for MVP Phase 1: conservative early,
# more aggressive at maturity.
MATURITY_STAGE_CONFIG: dict[MaturityStage, dict[str, Any]] = {
    MaturityStage.NEW: {
        "post_range": (0, 8),
        "min_signals_for_update": 8,
        "magnitude_cap": "very_low",
        "allowed_dimensions": [Dimension.BANNED_VOCAB, Dimension.MANDATORY_SIGNALS],
        "cool_down_posts": 3,
    },
    MaturityStage.EARLY: {
        "post_range": (9, 20),
        "min_signals_for_update": 6,
        "magnitude_cap": "low",
        "allowed_dimensions": "all_individual",
        "cool_down_posts": 2,
    },
    MaturityStage.GROWING: {
        "post_range": (21, 60),
        "min_signals_for_update": 5,
        "magnitude_cap": "medium",
        "allowed_dimensions": "all",
        "cool_down_posts": 2,
    },
    MaturityStage.MATURE: {
        "post_range": (60, None),
        "min_signals_for_update": 4,
        "magnitude_cap": "normal",
        "allowed_dimensions": "all",
        "cool_down_posts": 1,
    },
}


def stage_for_post_count(post_count: int) -> MaturityStage:
    if post_count <= 8:
        return MaturityStage.NEW
    if post_count <= 20:
        return MaturityStage.EARLY
    if post_count <= 60:
        return MaturityStage.GROWING
    return MaturityStage.MATURE


# ============================================================================
# Tiered feedback weights
# ============================================================================

FEEDBACK_TIER_WEIGHTS: dict[FeedbackTier, float] = {
    FeedbackTier.PUBLISH_AS_IS: 1.0,
    FeedbackTier.MINOR_EDITS: 0.7,
    FeedbackTier.REGENERATE: -0.5,
    FeedbackTier.DISCARD: -1.0,
}


# ============================================================================
# ClientContext (main aggregate)
# ============================================================================

class PlatformSlots(BaseModel):
    """Per-platform learning state for a single client on a single platform."""
    voice_fingerprint: list[WeightedPost] = Field(default_factory=list)
    winning_patterns: list[WeightedPost] = Field(default_factory=list)
    losing_patterns: list[WeightedPost] = Field(default_factory=list)
    learned_overrides: dict[Dimension, Override] = Field(default_factory=dict)
    performance_proxies: list[PerformanceProxy] = Field(default_factory=list)
    post_count: int = 0
    last_update_post_index: dict[Dimension, int] = Field(default_factory=dict)

    # Phase 1.5 — E1: per-platform extracted voice patterns. Updated by
    # voice_idiosyncrasy_job. None until 10+ posts accumulate.
    voice_idiosyncrasies: VoiceIdiosyncrasies | None = Field(
        default=None,
        description="Per-platform extracted voice patterns. Updated by "
                    "voice_idiosyncrasy_job. None until 10+ posts accumulate."
    )

    # Phase 1.5 — F4: variety injection state. Sliding window of recent
    # archetypes used for diversity tracking + per-platform config.
    recent_post_archetypes: list[ArchetypeUsage] = Field(
        default_factory=list,
        description="Sliding window of last N post archetypes for this platform. "
                    "Used by variety_injector to track diversity and select next "
                    "variety mode."
    )
    variety_config: VarietyConfig = Field(
        default_factory=VarietyConfig,
        description="Per-platform variety injection configuration. Operator can "
                    "disable variety per platform if a client doesn't want it."
    )

    @property
    def maturity_stage(self) -> MaturityStage:
        return stage_for_post_count(self.post_count)


class ClientContext(BaseModel):
    """Top-level aggregate for a single client's learning state.

    Stored per client_id. Loaded on every generation request; updated by the
    feedback loop service after signals are processed.
    """
    client_id: UUID
    brand_bible: BrandBible

    # Per-platform learning slots. Each platform isolated.
    platforms: dict[Platform, PlatformSlots] = Field(default_factory=dict)

    # Reserved for Phase 1.5+ (cross-platform voice fingerprint).
    cross_platform_voice: list[WeightedPost] = Field(default_factory=list)

    # Anti-samples tagged per dimension. Cross-platform applicable for voice
    # dimensions; per-platform for format dimensions.
    anti_samples: dict[Dimension, list[WeightedPost]] = Field(default_factory=dict)

    audit_log: list[AuditEntry] = Field(default_factory=list)

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    def get_platform_slots(self, platform: Platform) -> PlatformSlots:
        if platform not in self.platforms:
            self.platforms[platform] = PlatformSlots()
        return self.platforms[platform]

    def get_voice_samples(
        self,
        platform: Platform,
        max_count: int = 8,
    ) -> list[WeightedPost]:
        slots = self.get_platform_slots(platform)
        return sorted(slots.voice_fingerprint, key=lambda p: p.weight, reverse=True)[:max_count]

    def get_recent_winning_patterns(
        self,
        platform: Platform,
        window_days: int = 45,
        min_count: int = 5,
        max_count: int = 20,
    ) -> list[WeightedPost]:
        slots = self.get_platform_slots(platform)
        cutoff = datetime.now(timezone.utc).timestamp() - (window_days * 86400)
        eligible = [p for p in slots.winning_patterns if p.posted_at.timestamp() >= cutoff]
        eligible.sort(key=lambda p: p.weight, reverse=True)
        if len(eligible) >= min_count:
            return eligible[:max_count]
        return slots.winning_patterns[:max_count]

    def get_recent_losing_patterns(
        self,
        platform: Platform,
        window_days: int = 45,
        min_count: int = 5,
        max_count: int = 20,
    ) -> list[WeightedPost]:
        slots = self.get_platform_slots(platform)
        cutoff = datetime.now(timezone.utc).timestamp() - (window_days * 86400)
        eligible = [p for p in slots.losing_patterns if p.posted_at.timestamp() >= cutoff]
        eligible.sort(key=lambda p: p.weight, reverse=True)
        if len(eligible) >= min_count:
            return eligible[:max_count]
        return slots.losing_patterns[:max_count]

    def get_anti_samples_for(
        self,
        dimension: Dimension,
        max_count: int = 10,
    ) -> list[WeightedPost]:
        return self.anti_samples.get(dimension, [])[:max_count]
