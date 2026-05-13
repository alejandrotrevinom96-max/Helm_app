# Helm Adaptive Voice Engine — MVP Phase 1

Learning system that adapts the content generation prompt to each client over time, while keeping the static rule scaffold (`platform_tone_instructions.py`) immutable.

## Files

| File | Purpose |
|---|---|
| `client_context.py` | Pydantic models: `ClientContext`, `Override`, `Signal`, `AuditEntry`, `WeightedPost`, `BrandBible`, plus enums and maturity-stage config |
| `diff_classifier.py` | Heuristic classifier that turns a `(original, edited)` diff into structured `Signal` objects per dimension |
| `feedback_loop_service.py` | Threshold gating, cool-down enforcement, override aggregation, audit log writes, manual rollback |
| `prompt_builder.py` | Composes the final generation prompt (static scaffold + dynamic client context) and parses `<override_log>` tags from model output |

`platform_tone_instructions.py` (the static scaffold) lives one level up. Adjust import paths when you move these into your codebase.

## Dependencies

```
pydantic >= 2.0
```

That's it. Standard library handles the rest.

## Quick integration flow

```python
from client_context import ClientContext, Platform, ContentType, FeedbackTier
from diff_classifier import classify_diff
from feedback_loop_service import (
    process_signals,
    record_tiered_feedback,
    increment_post_count,
)
from prompt_builder import build_generation_prompt, parse_override_log

# 1. On every generation request:
prompt = build_generation_prompt(
    platform=Platform.LINKEDIN,
    content_type=ContentType.TEXT,
    client_context=ctx,
    pain_point="Solo founders waste 2.4 hrs/week context switching.",
)
# send prompt to model, get raw_output back
clean_draft, override_records = parse_override_log(raw_output)
# Log override_records to audit_log on your side

# 2. When user edits the draft:
signals = classify_diff(
    original=clean_draft,
    edited=user_edited_version,
    platform=Platform.LINKEDIN,
    content_type=ContentType.TEXT,
    post_id=post.id,
)

# 3. When user gives tiered feedback:
weight = record_tiered_feedback(ctx, Platform.LINKEDIN, post.id, FeedbackTier.MINOR_EDITS)
# Apply weight to signals before processing:
weighted_signals = [s.model_copy(update={"weight": s.weight * weight}) for s in signals]

# 4. Process signals into overrides:
ctx = process_signals(ctx, weighted_signals)

# 5. When post is published:
increment_post_count(ctx, Platform.LINKEDIN)

# 6. Persist ctx (Pydantic supports .model_dump_json() and .model_validate_json())
```

## What's IN this MVP

- `ClientContext` with all slots reserved (incl. those unused now, to avoid migrations later)
- Heuristic diff classifier (no LLM batch yet)
- Per-platform learning isolation
- Maturity stages: New 0-8 / Early 9-20 / Growing 21-60 / Mature 60+
- Cool-down between updates of the same dimension
- Basic audit log with rollback handles
- Tiered feedback (`publish_as_is`, `minor_edits`, `regenerate`, `discard`) with distinct weights
- `performance_proxies` captured per post (storage only, not used in prompt yet)
- `build_generation_prompt` with dynamic context + structured `<override_log>` tags
- Manual rollback by operator

## What's deferred to Phase 1.5 / 2

- LLM batch diff classifier (add when heuristics stop covering 70%+ of edits)
- Cross-platform voice fingerprint (add when first client crosses to a second platform)
- Stale override decay
- Circuit breaker (calibrate thresholds from real incidents, not guesses)
- Shadow mode for candidate rules
- Exploration sampling (10-15% of generations break established rules)
- Performance reweighting of winning/losing patterns
- Cohort comparison

## Architectural principles

1. **Static rules never mutate automatically.** `platform_tone_instructions.py` is immutable from the learning loop's perspective. Only `ClientContext` mutates.
2. **Per-platform isolation by default.** What works on TikTok doesn't bleed into LinkedIn.
3. **Audit log is invisible to the client.** Operators query it for debugging.
4. **All MVP-deferred slots exist in the data model.** Adding LLM batch / cross-platform / performance reweighting later doesn't require schema migration.

## Calibration notes (from architecture decision 2026-05-13)

- Maturity stage thresholds tuned to balance "feels alive early" with "doesn't overfit." New stage = 8 signals min so a user sees learning by post 8-12.
- Magnitude caps per stage: 5% / 10% / 20% / 40%. Numeric overrides only.
- Tiered feedback weights: publish_as_is=1.0, minor_edits=0.7, regenerate=-0.5, discard=-1.0.
- Volatility per dimension: BANNED_VOCAB and SENTENCE_CADENCE are LOW (rarely change); HOOK_LENGTH, CTA_STYLE, EMOJI_USAGE, PARAGRAPH_LENGTH are MEDIUM; HASHTAG_STRATEGY is HIGH (trends shift fast).
- Heuristic confidence: known buzzwords = 0.95+, new word removals = 0.55, hook length = 0.85, CTA shift = 0.75, paragraph length = 0.7.
