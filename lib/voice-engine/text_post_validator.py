"""
text_post_validator.py
======================

Universal validator for text posts (Reddit, LinkedIn text, X tweets, Threads,
Facebook). Catches AI patterns that the platform-specific PLATFORM_TONE rules
and the per-content-type CONTENT_TYPE_RULES don't currently cover.

Specifically catches:
  - "X, not Y" constructions (chiastic AI rhythm)
  - Blockquote pull-quotes used as crafted quotable lines
  - Symmetric parallel headers (3+ in same form)
  - Templated CTAs without personal context follow-up

Usage:
    from text_post_validator import validate_text_post

    failures = validate_text_post(text, platform="reddit")
    if failures:
        # Regenerate with failures sent back to model as context
        ...

Version: 1.0
"""

from __future__ import annotations

import re
from collections import Counter


# ============================================================================
# C1: "X, not Y" pattern detection
# ============================================================================

X_NOT_Y_PATTERNS: list[re.Pattern] = [
    # ", not X" appositive (e.g., "build, not buy", "specific decisions, not generic lessons")
    re.compile(r"[,;]\s+not\s+\w+", re.IGNORECASE),
    # "It's not X. It's Y." chiastic flip (most common AI rhythm)
    re.compile(r"\bit'?s?\s+not\s+[\w\s,'-]{2,60}[.!]\s*it'?s?\s+", re.IGNORECASE),
    # "isn't X. It's Y" / "isn't X. That's Y" / "isn't X. The Y"
    re.compile(r"\bisn'?t\s+[\w\s,'-]{2,60}[.!]\s*(it'?s|that'?s|the)\s+", re.IGNORECASE),
    # "X is the opposite of Y" (rare but distinctive)
    re.compile(r"\bis\s+(almost\s+)?the\s+opposite\s+of\s+\w+", re.IGNORECASE),
]


def count_x_not_y_patterns(text: str) -> int:
    """Count likely 'X, not Y' constructions across all known patterns."""
    return sum(len(p.findall(text)) for p in X_NOT_Y_PATTERNS)


def check_x_not_y(text: str, *, max_allowed: int = 0) -> list[str]:
    """Reject text with too many 'X, not Y' constructions.

    Default max_allowed=0 (zero tolerance for AI-coded chiasm). Override per
    platform if needed.
    """
    count = count_x_not_y_patterns(text)
    if count > max_allowed:
        return [
            f"Text contains {count} 'X, not Y' constructions (max allowed: {max_allowed}). "
            f"This is one of the most distinctive AI rhythms. Rewrite without "
            f"chiastic flips. Examples to avoid: 'specific decisions, not generic lessons', "
            f"'It's not a problem. It's a system.', 'X is the opposite of Y'."
        ]
    return []


# ============================================================================
# C2: Blockquote detection (Reddit-specific)
# ============================================================================

BLOCKQUOTE_PATTERN = re.compile(r"^>\s+", re.MULTILINE)


def check_no_blockquote(text: str) -> list[str]:
    """Reject text containing blockquote (>) lines.

    On Reddit, blockquotes are typically used by AI-generated posts to create
    pre-constructed quotable lines. Real Reddit users use blockquotes only to
    quote someone else (which doesn't apply to original posts).
    """
    if BLOCKQUOTE_PATTERN.search(text):
        return [
            "Text contains blockquote (>) lines. On Reddit, blockquotes signal "
            "a pre-constructed quotable line, which is an AI tell. Remove the "
            "blockquote and either delete the line or fold its content into "
            "the surrounding paragraph as plain prose."
        ]
    return []


# ============================================================================
# C3: Symmetric headers detector
# ============================================================================

HEADER_PATTERN = re.compile(r"^#+\s+(.+)$", re.MULTILINE)


def check_symmetric_headers(text: str, *, threshold: int = 3) -> list[str]:
    """Detect 3+ headers in parallel form (same starting word OR same length).

    Symmetric headers signal essay-style structure transplanted from a doc
    template, which reads as AI-shaped on social platforms.
    """
    headers = HEADER_PATTERN.findall(text)
    if len(headers) < threshold:
        return []

    # Check 1: Same starting word
    starting_words = [h.lower().strip().split()[0] for h in headers if h.strip()]
    starting_counts = Counter(starting_words)
    if any(c >= threshold for c in starting_counts.values()):
        repeated_word = next(w for w, c in starting_counts.items() if c >= threshold)
        return [
            f"Text has {threshold}+ headers all starting with '{repeated_word}'. "
            f"Symmetric parallel headers ('What X / What Y / What Z') signal "
            f"essay-style structure that reads as AI-shaped. Rewrite headers "
            f"with varied syntactic patterns or remove some headers entirely."
        ]

    # Check 2: Same word count
    word_lens = [len(h.split()) for h in headers]
    len_counts = Counter(word_lens)
    if any(c >= threshold for c in len_counts.values()):
        repeated_len = next(l for l, c in len_counts.items() if c >= threshold)
        return [
            f"Text has {threshold}+ headers all exactly {repeated_len} words long. "
            f"Headers in matched parallel structure signal templated essay form. "
            f"Vary header lengths and structures, or remove some entirely."
        ]

    return []


# ============================================================================
# C4: Templated CTA detector
# ============================================================================

TEMPLATED_CTAS: tuple[str, ...] = (
    "what's your take",
    "whats your take",
    "what worked for you",
    "anyone else seeing this",
    "anyone else?",
    "specifically curious about",
    "drop a comment if",
    "agree or disagree",
    "what am i missing",
    "let me know your thoughts",
    "thoughts?",
    "what do you think?",
    "what's your experience",
    "have you seen this",
)


def check_templated_cta(text: str) -> list[str]:
    """Detect AI-templated CTA closures with no personal context follow-up.

    Real CTAs from humans usually have a follow-up clause that adds personal
    context ("What worked for you? I'm trying X next" or "What do you think?
    Genuinely asking, building this for myself"). AI templates end clean.
    """
    last_para = text.strip().split("\n\n")[-1].strip().lower()
    # Strip common trailing markdown like links
    last_para_clean = re.sub(r"\[.*?\]\(.*?\)", "", last_para).strip()

    for cta in TEMPLATED_CTAS:
        # Templated CTA at the very end with no follow-up
        if last_para_clean.endswith(cta + "?") or last_para_clean.endswith(cta + "."):
            return [
                f"Text ends with templated CTA '{cta}' with no personal context "
                f"follow-up. Real CTAs from humans add 1 personal clause after "
                f"(reason, vulnerability, specific ask). Either add a follow-up "
                f"sentence or rewrite the CTA in the writer's specific voice."
            ]
    return []


# ============================================================================
# Public API
# ============================================================================

def validate_text_post(
    text: str,
    *,
    platform: str | None = None,
    x_not_y_max: int = 0,
    enforce_no_blockquote: bool | None = None,
    enforce_no_symmetric_headers: bool = True,
    enforce_no_templated_cta: bool = True,
) -> list[str]:
    """Run all text-post-level checks against generated content.

    Args:
        text:                          the generated post text (markdown OK)
        platform:                      target platform. Affects defaults.
        x_not_y_max:                   max 'X, not Y' patterns allowed (default 0)
        enforce_no_blockquote:         if True, reject any blockquote.
                                       Default True for Reddit, False elsewhere.
        enforce_no_symmetric_headers:  if True, reject 3+ parallel headers.
        enforce_no_templated_cta:      if True, reject templated CTA endings.

    Returns:
        Empty list if all checks pass. Otherwise list of failure messages.
    """
    failures: list[str] = []

    # C1 — universal
    failures.extend(check_x_not_y(text, max_allowed=x_not_y_max))

    # C2 — Reddit by default, optional elsewhere
    if enforce_no_blockquote is None:
        enforce_no_blockquote = (platform == "reddit") if platform else False
    if enforce_no_blockquote:
        failures.extend(check_no_blockquote(text))

    # C3 — universal
    if enforce_no_symmetric_headers:
        failures.extend(check_symmetric_headers(text))

    # C4 — universal
    if enforce_no_templated_cta:
        failures.extend(check_templated_cta(text))

    return failures
