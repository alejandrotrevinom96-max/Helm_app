"""
feedback_loop_service.py
========================

Update logic for the Helm Adaptive Voice Engine learning loop (MVP Phase 1).

Takes a ClientContext + a batch of new Signals, decides which updates to apply
based on maturity-stage thresholds, cool-down state, and feedback tier weights.
Logs every change to the audit log with rollback handles.

MVP scope:
  - Maturity-stage threshold gating
  - Cool-down enforcement
  - Per-dimension update logic (banned_vocab, hook_length, cta_style, etc.)
  - Audit log writes with rollback handles
  - Manual rollback by operator
  - Tiered feedback weighting

Deferred to Phase 1.5+:
  - Circuit breaker (calibrate after observing real incidents)
  - Auto-rollback on regression (needs performance data)
  - Stale override decay
  - Shadow mode
  - Performance reweighting of winning/losing patterns

Version: 1.0 (MVP Phase 1)
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from client_context import (
    AuditEntry,
    ClientContext,
    Dimension,
    FEEDBACK_TIER_WEIGHTS,
    FeedbackTier,
    MATURITY_STAGE_CONFIG,
    Override,
    Platform,
    PlatformSlots,
    Signal,
    Volatility,
)


# ============================================================================
# Per-dimension volatility defaults
# ============================================================================

DIMENSION_VOLATILITY: dict[Dimension, Volatility] = {
    Dimension.BANNED_VOCAB: Volatility.LOW,          # Once banned, near-immutable
    Dimension.MANDATORY_SIGNALS: Volatility.LOW,
    Dimension.SENTENCE_CADENCE: Volatility.LOW,      # Voice signature, drifts slowly
    Dimension.TONE_INTENSITY: Volatility.LOW,
    Dimension.HOOK_LENGTH: Volatility.MEDIUM,
    Dimension.CTA_STYLE: Volatility.MEDIUM,
    Dimension.PARAGRAPH_LENGTH: Volatility.MEDIUM,
    Dimension.EMOJI_USAGE: Volatility.MEDIUM,
    Dimension.HASHTAG_STRATEGY: Volatility.HIGH,     # Trends shift fast
}


# ============================================================================
# Magnitude caps per stage
# ============================================================================

MAGNITUDE_CAP_MULTIPLIER: dict[str, float] = {
    "very_low": 0.05,   # New stage: max 5% drift per update
    "low": 0.10,        # Early stage: max 10%
    "medium": 0.20,     # Growing stage: max 20%
    "normal": 0.40,     # Mature stage: max 40%
}


# ============================================================================
# Public API
# ============================================================================

def process_signals(
    context: ClientContext,
    signals: list[Signal],
    operator_id: str | None = None,
) -> ClientContext:
    """Main entry point: process a batch of signals against a ClientContext.

    Mutates the context in place: updates learned_overrides where thresholds
    are met, writes to the audit log, and returns the updated context.

    Cool-down is enforced per (platform, dimension): if an update was applied
    recently, further updates to that dimension are blocked until
    cool_down_posts have passed.

    Args:
        context:     the ClientContext to update (mutated in place)
        signals:     batch of signals to process
        operator_id: optional, attaches operator identity to audit entries
                     when this is a manual or operator-triggered update

    Returns:
        The mutated ClientContext (same instance).
    """
    if not signals:
        return context

    # Group signals by (platform, dimension)
    grouped: dict[tuple[Platform, Dimension], list[Signal]] = defaultdict(list)
    for signal in signals:
        grouped[(signal.platform, signal.dimension)].append(signal)

    for (platform, dimension), dim_signals in grouped.items():
        slots = context.get_platform_slots(platform)
        stage = slots.maturity_stage
        config = MATURITY_STAGE_CONFIG[stage]

        # Gate 1: stage allows updates to this dimension?
        if not _is_dimension_allowed(dimension, config):
            continue

        # Gate 2: cool-down expired?
        if _in_cool_down(slots, dimension, config["cool_down_posts"]):
            continue

        # Gate 3: enough weighted signal volume?
        weighted_count = sum(s.weight * s.confidence for s in dim_signals)
        if weighted_count < config["min_signals_for_update"]:
            continue

        # All gates passed. Derive new override value and apply.
        previous_override = slots.learned_overrides.get(dimension)
        previous_value = previous_override.value if previous_override else None

        new_value = _derive_override_value(dimension, dim_signals, previous_override)
        if new_value is None:
            continue

        # Apply magnitude cap (no-op for non-numeric dimensions)
        capped_value = _apply_magnitude_cap(
            previous_value, new_value, config["magnitude_cap"]
        )

        # Build / update the override
        new_override = Override(
            dimension=dimension,
            platform=platform,
            value=capped_value,
            volatility=DIMENSION_VOLATILITY.get(dimension, Volatility.MEDIUM),
            confidence=min(1.0, weighted_count / 10.0),
            sample_count=(previous_override.sample_count if previous_override else 0) + len(dim_signals),
            last_validated=datetime.now(timezone.utc),
            last_updated=datetime.now(timezone.utc),
            source_signal_ids=[s.id for s in dim_signals],
        )

        slots.learned_overrides[dimension] = new_override
        slots.last_update_post_index[dimension] = slots.post_count

        # Audit log
        context.audit_log.append(
            AuditEntry(
                action="override_updated",
                platform=platform,
                dimension=dimension,
                previous_value=previous_value,
                new_value=capped_value,
                triggering_signals=[s.id for s in dim_signals],
                operator_id=operator_id,
                notes=(
                    f"stage={stage.value} signals={len(dim_signals)} "
                    f"weighted={weighted_count:.2f} cap={config['magnitude_cap']}"
                ),
            )
        )

    context.updated_at = datetime.now(timezone.utc)
    return context


def rollback_override(
    context: ClientContext,
    platform: Platform,
    dimension: Dimension,
    operator_id: str,
    reason: str | None = None,
) -> ClientContext:
    """Manual rollback by operator. Removes the current override and logs it.

    Used when the operator notices an override producing bad output and wants
    to revert without waiting for the auto-rollback infrastructure (Phase 2+).
    """
    slots = context.get_platform_slots(platform)
    previous_override = slots.learned_overrides.pop(dimension, None)

    context.audit_log.append(
        AuditEntry(
            action="override_rolled_back",
            platform=platform,
            dimension=dimension,
            previous_value=previous_override.value if previous_override else None,
            new_value=None,
            operator_id=operator_id,
            notes=reason,
        )
    )
    context.updated_at = datetime.now(timezone.utc)
    return context


def record_tiered_feedback(
    context: ClientContext,
    platform: Platform,
    post_id: UUID,
    tier: FeedbackTier,
) -> float:
    """Record tiered feedback for a post. Returns the weight that should be
    applied to any signals derived from this post.

    Caller responsibility: when the user gives feedback on a post, call this
    first, then pass the returned weight into any Signal objects derived from
    the same post's diff.
    """
    weight = FEEDBACK_TIER_WEIGHTS[tier]

    context.audit_log.append(
        AuditEntry(
            action="tiered_feedback_recorded",
            platform=platform,
            notes=f"post_id={post_id} tier={tier.value} weight={weight}",
        )
    )

    return weight


def increment_post_count(context: ClientContext, platform: Platform) -> None:
    """Increment the post count for a platform. Call after a post is published.

    Post count drives maturity stage progression. Increment must happen exactly
    once per published post.
    """
    slots = context.get_platform_slots(platform)
    slots.post_count += 1
    context.updated_at = datetime.now(timezone.utc)


# ============================================================================
# Internal helpers
# ============================================================================

def _is_dimension_allowed(dimension: Dimension, config: dict[str, Any]) -> bool:
    allowed = config["allowed_dimensions"]
    if allowed in ("all", "all_individual"):
        return True
    if isinstance(allowed, list):
        return dimension in allowed
    return False


def _in_cool_down(
    slots: PlatformSlots, dimension: Dimension, cool_down_posts: int
) -> bool:
    last_update = slots.last_update_post_index.get(dimension)
    if last_update is None:
        return False
    return (slots.post_count - last_update) < cool_down_posts


def _derive_override_value(
    dimension: Dimension,
    signals: list[Signal],
    current_override: Override | None,
) -> Any | None:
    """Aggregate signals into a new override value.

    Strategy varies by dimension:
      banned_vocab        union of removed words/phrases (set behavior)
      hook_length         weighted average of edited_hook_words
      cta_style           majority vote on preferred_style
      emoji_usage         weighted average of edited_emoji_count
      hashtag_strategy    weighted average of edited_hashtag_count
      paragraph_length    weighted average of edited_avg_words
    """
    if dimension == Dimension.BANNED_VOCAB:
        existing: set[str] = set()
        if current_override and isinstance(current_override.value, list):
            existing = set(current_override.value)
        for s in signals:
            word = s.value_delta.get("removed_word")
            phrase = s.value_delta.get("removed_phrase")
            if word:
                existing.add(word)
            if phrase:
                existing.add(phrase)
        return sorted(existing)

    if dimension == Dimension.HOOK_LENGTH:
        return _weighted_average_int(signals, "edited_hook_words")

    if dimension == Dimension.CTA_STYLE:
        question_votes = sum(
            s.weight for s in signals if s.value_delta.get("preferred_style") == "question"
        )
        statement_votes = sum(
            s.weight for s in signals if s.value_delta.get("preferred_style") == "statement"
        )
        return "question" if question_votes > statement_votes else "statement"

    if dimension == Dimension.EMOJI_USAGE:
        return _weighted_average_int(signals, "edited_emoji_count")

    if dimension == Dimension.HASHTAG_STRATEGY:
        return _weighted_average_int(signals, "edited_hashtag_count")

    if dimension == Dimension.PARAGRAPH_LENGTH:
        return _weighted_average_float(signals, "edited_avg_words")

    return None


def _weighted_average_int(signals: list[Signal], key: str) -> int | None:
    total_weight = sum(s.weight for s in signals if key in s.value_delta)
    if total_weight == 0:
        return None
    weighted_sum = sum(s.value_delta[key] * s.weight for s in signals if key in s.value_delta)
    return round(weighted_sum / total_weight)


def _weighted_average_float(signals: list[Signal], key: str) -> float | None:
    total_weight = sum(s.weight for s in signals if key in s.value_delta)
    if total_weight == 0:
        return None
    weighted_sum = sum(s.value_delta[key] * s.weight for s in signals if key in s.value_delta)
    return round(weighted_sum / total_weight, 1)


def _apply_magnitude_cap(
    previous_value: Any,
    new_value: Any,
    cap_label: str,
) -> Any:
    """Limit how much a numeric override can change in a single update.

    For non-numeric dimensions (banned_vocab, cta_style), no cap applied
    because those are inherently bounded by their type.
    """
    multiplier = MAGNITUDE_CAP_MULTIPLIER.get(cap_label, 0.20)

    if not isinstance(previous_value, (int, float)) or not isinstance(new_value, (int, float)):
        return new_value

    if previous_value == 0:
        # No baseline to cap against. Return as-is.
        return new_value

    max_delta = abs(previous_value) * multiplier
    actual_delta = new_value - previous_value

    if abs(actual_delta) <= max_delta:
        return new_value

    direction = 1 if actual_delta > 0 else -1
    capped = previous_value + (max_delta * direction)
    return round(capped) if isinstance(new_value, int) else round(capped, 1)
