"""
diff_classifier.py
==================

Heuristic diff classifier for the Helm Adaptive Voice Engine v1.0.

Compares an originally-generated draft against the user's edited version,
extracts structured Signal objects per dimension. Heuristics only in MVP;
LLM batch classifier deferred to Phase 1.5.

Coverage target: heuristics handle ~70-80% of common edit patterns. Diffs
that don't match any heuristic produce no signals in MVP (the queue stub for
the future LLM batch is in place but the consumer is not built yet).

Version: 1.0 (MVP Phase 1, heuristics only)
"""

from __future__ import annotations

import re
from uuid import UUID

from client_context import (
    ContentType,
    Dimension,
    Platform,
    Signal,
    SignalSource,
)


# ============================================================================
# Banned vocab heuristic targets
# ============================================================================

# Words/phrases the system already knows tend to get edited out. These get
# higher confidence detection. Other removed words produce signals with lower
# confidence (so they don't move banned_vocab until many samples confirm).
COMMON_AI_BUZZWORDS: set[str] = {
    "leverage", "harness", "unlock", "empower", "elevate", "streamline",
    "seamlessly", "effortlessly", "intuitively", "robust", "comprehensive",
    "holistic", "synergy", "navigate", "explore", "embark",
    # Multi-word phrases handled separately below.
}

COMMON_AI_PHRASES: list[str] = [
    "excited to share", "excited to announce", "thrilled to share",
    "thrilled to announce", "humbled to", "humbled by",
    "dive into", "delve into", "unpack", "uncover",
    "game-changer", "cutting-edge", "state-of-the-art",
    "in today's fast-paced world", "in the digital age",
    "at the end of the day", "at its core", "at the heart of",
    "it's worth noting that", "let's break it down", "let's unpack",
]


# ============================================================================
# Tokenization helpers
# ============================================================================

WORD_RE = re.compile(r"\b[\w']+\b")
EMOJI_RE = re.compile(
    "["
    "\U0001F300-\U0001FAFF"
    "\U00002600-\U000027BF"
    "\U0001F1E0-\U0001F1FF"
    "]"
)
HASHTAG_RE = re.compile(r"#\w+")


def tokenize_words(text: str) -> list[str]:
    return WORD_RE.findall(text.lower())


def count_emojis(text: str) -> int:
    return len(EMOJI_RE.findall(text))


def count_hashtags(text: str) -> int:
    return len(HASHTAG_RE.findall(text))


def split_paragraphs(text: str) -> list[str]:
    return [p.strip() for p in text.split("\n\n") if p.strip()]


def first_line(text: str) -> str:
    return text.strip().split("\n")[0] if text.strip() else ""


def first_sentence(text: str) -> str:
    text = text.strip()
    if not text:
        return ""
    match = re.search(r"[.!?](\s|$)", text)
    return text[: match.end()].strip() if match else text


# ============================================================================
# Heuristics
# ============================================================================

def detect_hook_length_change(
    original: str, edited: str, platform: Platform, content_type: ContentType
) -> Signal | None:
    orig_hook = first_sentence(first_line(original))
    edited_hook = first_sentence(first_line(edited))

    orig_words = len(tokenize_words(orig_hook))
    edited_words = len(tokenize_words(edited_hook))

    if orig_words == 0 or abs(edited_words - orig_words) < 2:
        return None

    return Signal(
        source=SignalSource.EDIT_DIFF,
        platform=platform,
        content_type=content_type,
        dimension=Dimension.HOOK_LENGTH,
        value_delta={
            "original_hook_words": orig_words,
            "edited_hook_words": edited_words,
            "delta": edited_words - orig_words,
        },
        confidence=0.85,
    )


def detect_banned_vocab_changes(
    original: str, edited: str, platform: Platform, content_type: ContentType
) -> list[Signal]:
    """Detect single words removed in the edit. Multi-word phrases handled separately."""
    orig_words = set(tokenize_words(original))
    edited_words = set(tokenize_words(edited))
    removed = orig_words - edited_words

    signals: list[Signal] = []
    for word in removed:
        is_known_buzzword = word in COMMON_AI_BUZZWORDS
        signals.append(
            Signal(
                source=SignalSource.EDIT_DIFF,
                platform=platform,
                content_type=content_type,
                dimension=Dimension.BANNED_VOCAB,
                value_delta={
                    "removed_word": word,
                    "is_known_buzzword": is_known_buzzword,
                },
                confidence=0.95 if is_known_buzzword else 0.55,
            )
        )
    return signals


def detect_banned_phrase_changes(
    original: str, edited: str, platform: Platform, content_type: ContentType
) -> list[Signal]:
    """Detect known multi-word AI phrases removed in the edit."""
    orig_lower = original.lower()
    edited_lower = edited.lower()

    signals: list[Signal] = []
    for phrase in COMMON_AI_PHRASES:
        in_orig = phrase in orig_lower
        in_edited = phrase in edited_lower
        if in_orig and not in_edited:
            signals.append(
                Signal(
                    source=SignalSource.EDIT_DIFF,
                    platform=platform,
                    content_type=content_type,
                    dimension=Dimension.BANNED_VOCAB,
                    value_delta={
                        "removed_phrase": phrase,
                        "is_known_buzzword": True,
                    },
                    confidence=0.98,
                )
            )
    return signals


def detect_emoji_count_change(
    original: str, edited: str, platform: Platform, content_type: ContentType
) -> Signal | None:
    orig_count = count_emojis(original)
    edited_count = count_emojis(edited)

    if orig_count == edited_count:
        return None

    return Signal(
        source=SignalSource.EDIT_DIFF,
        platform=platform,
        content_type=content_type,
        dimension=Dimension.EMOJI_USAGE,
        value_delta={
            "original_emoji_count": orig_count,
            "edited_emoji_count": edited_count,
            "delta": edited_count - orig_count,
        },
        confidence=0.9,
    )


def detect_hashtag_count_change(
    original: str, edited: str, platform: Platform, content_type: ContentType
) -> Signal | None:
    orig_count = count_hashtags(original)
    edited_count = count_hashtags(edited)

    if orig_count == edited_count:
        return None

    return Signal(
        source=SignalSource.EDIT_DIFF,
        platform=platform,
        content_type=content_type,
        dimension=Dimension.HASHTAG_STRATEGY,
        value_delta={
            "original_hashtag_count": orig_count,
            "edited_hashtag_count": edited_count,
            "delta": edited_count - orig_count,
        },
        confidence=0.9,
    )


def detect_cta_pattern_shift(
    original: str, edited: str, platform: Platform, content_type: ContentType
) -> Signal | None:
    """Detect if the CTA shifted from statement to question or vice versa."""
    orig_last = original.strip().split("\n")[-1] if original.strip() else ""
    edited_last = edited.strip().split("\n")[-1] if edited.strip() else ""

    orig_is_question = orig_last.rstrip().endswith("?")
    edited_is_question = edited_last.rstrip().endswith("?")

    if orig_is_question == edited_is_question:
        return None

    return Signal(
        source=SignalSource.EDIT_DIFF,
        platform=platform,
        content_type=content_type,
        dimension=Dimension.CTA_STYLE,
        value_delta={
            "original_was_question": orig_is_question,
            "edited_is_question": edited_is_question,
            "preferred_style": "question" if edited_is_question else "statement",
        },
        confidence=0.75,
    )


def detect_paragraph_length_change(
    original: str, edited: str, platform: Platform, content_type: ContentType
) -> Signal | None:
    orig_paragraphs = split_paragraphs(original)
    edited_paragraphs = split_paragraphs(edited)

    if not orig_paragraphs or not edited_paragraphs:
        return None

    orig_avg = sum(len(tokenize_words(p)) for p in orig_paragraphs) / len(orig_paragraphs)
    edited_avg = sum(len(tokenize_words(p)) for p in edited_paragraphs) / len(edited_paragraphs)

    if abs(edited_avg - orig_avg) < 5:
        return None

    return Signal(
        source=SignalSource.EDIT_DIFF,
        platform=platform,
        content_type=content_type,
        dimension=Dimension.PARAGRAPH_LENGTH,
        value_delta={
            "original_avg_words": round(orig_avg, 1),
            "edited_avg_words": round(edited_avg, 1),
            "delta": round(edited_avg - orig_avg, 1),
        },
        confidence=0.7,
    )


# ============================================================================
# Main entry point
# ============================================================================

SINGLE_SIGNAL_HEURISTICS = [
    detect_hook_length_change,
    detect_emoji_count_change,
    detect_hashtag_count_change,
    detect_cta_pattern_shift,
    detect_paragraph_length_change,
]


def classify_diff(
    *,
    original: str,
    edited: str,
    platform: Platform,
    content_type: ContentType,
    post_id: UUID | None = None,
) -> list[Signal]:
    """Run all heuristics on a (original, edited) pair and return signals.

    Args:
        original:     the draft as generated by the model
        edited:       the draft as the user saved it
        platform:     target platform of the post
        content_type: content type of the post
        post_id:      optional, links signal to its source post for audit

    Returns:
        List of Signal objects, one per detected change pattern. Empty list if
        no heuristic matched (the diff will not produce learning signals in MVP).
    """
    if original.strip() == edited.strip():
        return []

    signals: list[Signal] = []

    # Multi-signal heuristics (one diff can produce many signals)
    signals.extend(detect_banned_vocab_changes(original, edited, platform, content_type))
    signals.extend(detect_banned_phrase_changes(original, edited, platform, content_type))

    # Single-signal heuristics
    for heuristic in SINGLE_SIGNAL_HEURISTICS:
        signal = heuristic(original, edited, platform, content_type)
        if signal:
            signals.append(signal)

    # Attach post_id if provided (Signal is frozen, so we copy)
    if post_id:
        signals = [s.model_copy(update={"post_id": post_id}) for s in signals]

    # Stub: queue unclassified diffs for future LLM batch
    if not signals:
        _enqueue_for_llm_batch(original, edited, platform, content_type)

    return signals


def _enqueue_for_llm_batch(
    original: str,
    edited: str,
    platform: Platform,
    content_type: ContentType,
) -> None:
    """Stub for Phase 1.5 LLM batch classifier.

    In MVP: no-op. Diffs without heuristic matches don't produce signals.
    In Phase 1.5: persist (original, edited, platform, content_type) to a
    job queue. A nightly worker runs an LLM classifier and emits supplemental
    signals into the feedback loop.
    """
    return None
