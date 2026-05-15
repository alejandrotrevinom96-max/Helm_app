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
    # "It's not X. It's Y." OR "It's not X, it's Y." chiastic flip
    # (PATCH 1: now accepts comma as separator, was previously only [.!])
    # The inner character class drops the comma to avoid catastrophic
    # backtracking — comma is now reserved for the separator position.
    re.compile(r"\bit'?s?\s+not\s+[\w\s'-]{2,60}[.!,]\s*it'?s?\s+", re.IGNORECASE),
    # "isn't X. It's Y" / "isn't X, It's Y" / "isn't X. That's Y"
    # (PATCH 1: same fix as above, now accepts comma)
    re.compile(r"\bisn'?t\s+[\w\s'-]{2,60}[.!,]\s*(it'?s|that'?s|the)\s+", re.IGNORECASE),
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
# C5 (Patch 1): Tricolon detection
# ============================================================================

# Words that don't carry sentence meaning, used to skip when comparing openers
TRICOLON_IGNORE_WORDS: set[str] = {
    "the", "a", "an", "this", "that", "these", "those",
}


def check_tricolon(text: str) -> list[str]:
    """Detect 3+ consecutive sentences forming a tricolon (parallel structure).

    Catches the AI rhythm of stacking 3 short parallel sentences for emphasis:
      "Not a content calendar. Not a funnel diagram. You, writing..."
      "It's faster. It's cleaner. It's free."
      "Build. Ship. Scale."

    Detection signals (any one is enough):
      A. 3+ adjacent sentences sharing the same first significant word
      B. 3+ adjacent sentences all <= 5 words AND structurally parallel

    Tricolons are an AI-coded rhetorical device. Real human writing uses them
    occasionally; AI uses them constantly.
    """
    # Split into sentences. Use lookbehind to keep separators out of results.
    sentences = re.split(r"(?<=[.!?])\s+", text)
    sentences = [s.strip() for s in sentences if s.strip()]

    if len(sentences) < 3:
        return []

    # Sliding window of 3 consecutive sentences
    for i in range(len(sentences) - 2):
        window = sentences[i:i + 3]

        # Get first significant word of each
        first_words: list[str] = []
        for s in window:
            tokens = re.findall(r"\b[\w']+\b", s.lower())
            for token in tokens:
                if token not in TRICOLON_IGNORE_WORDS:
                    first_words.append(token)
                    break
            else:
                first_words.append("")

        # Signal A: same first significant word
        if len(set(first_words)) == 1 and first_words[0]:
            return [
                f"Tricolon detected: 3 consecutive sentences all start with "
                f"'{first_words[0]}'. Example: \"{window[0]}\" / "
                f"\"{window[1]}\" / \"{window[2]}\". "
                f"Tricolons are an AI-coded rhetorical device. "
                f"Trim to 2 items or rewrite as prose."
            ]

        # Signal B: all very short (<= 5 words) AND structurally similar
        word_counts = [len(re.findall(r"\b[\w']+\b", s)) for s in window]
        if all(c <= 5 for c in word_counts):
            # Structurally parallel if all start with same POS-like first word
            # (we approximate POS by first word category)
            if len(set(first_words)) <= 2 and all(first_words):
                return [
                    f"Tricolon detected: 3 short parallel sentences. "
                    f"Example: \"{window[0]}\" / \"{window[1]}\" / \"{window[2]}\". "
                    f"Trim to 2 items or rewrite as prose."
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
# C6 (Patch 1): Authenticity markers per platform
# ============================================================================

AUTHENTICITY_MARKERS_BY_PLATFORM: dict[str, tuple[str, ...]] = {
    "reddit": ("tbh", "ngl", "imo", "imho", "fwiw", "idk", "honestly", "lowkey"),
    "threads": ("tbh", "ngl", "imo", "idk", "ok so", "wait", "actually", "lowkey"),
    "x": ("tbh", "ngl", "lol", "imo", "fr", "ok so", "wait"),
    # Instagram, LinkedIn, Facebook: no hard requirement (different culture)
}


def check_authenticity_markers(text: str, platform: str | None = None) -> list[str]:
    """For platforms with strong informal-marker culture, ensure at least one
    is present.

    Real Reddit/Threads/X users signal in-group with markers like 'tbh', 'ngl',
    'imo'. AI output rarely includes these unless explicitly prompted, and even
    then often skips them. This check enforces the AUTHENTICITY MARKERS rule
    that lives in PLATFORM_TONE_INSTRUCTIONS but isn't programmatically enforced.

    Returns empty list for platforms not in the map (no hard requirement).
    """
    if platform is None:
        return []
    markers = AUTHENTICITY_MARKERS_BY_PLATFORM.get(platform.lower())
    if not markers:
        return []

    text_lower = text.lower()
    found = [m for m in markers if m in text_lower]
    if not found:
        return [
            f"Text contains zero authenticity markers for {platform} "
            f"(expected at least one of: {', '.join(markers[:5])}, ...). "
            f"Real users on {platform} signal authenticity with informal "
            f"markers. Add at least one naturally to the post."
        ]
    return []


# ============================================================================
# C7 (Patch 1): Max headers per platform
# ============================================================================

MAX_HEADERS_BY_PLATFORM: dict[str, int] = {
    "reddit": 2,
    "linkedin": 2,
    "x": 0,
    "threads": 0,
    "facebook": 1,
    "instagram": 0,
}


def check_max_headers(
    text: str,
    platform: str | None = None,
    max_override: int | None = None,
) -> list[str]:
    """Reject if text has more markdown headers than the platform allows.

    Real social posts have minimal structure. Essay-style posts with 3-5
    headers signal AI authorship even when individually each header reads
    fine.

    Defaults: Reddit/LinkedIn 2, Facebook 1, X/Threads/Instagram 0.
    Override per call with max_override if needed.
    """
    headers = HEADER_PATTERN.findall(text)
    n = len(headers)

    if max_override is not None:
        max_allowed = max_override
    elif platform:
        max_allowed = MAX_HEADERS_BY_PLATFORM.get(platform.lower(), 5)
    else:
        max_allowed = 5

    if n > max_allowed:
        return [
            f"Text has {n} markdown headers; max for "
            f"{platform or 'this context'} is {max_allowed}. "
            f"Real {platform or 'social'} posts have minimal structure. "
            f"Convert excess headers to paragraph breaks or remove."
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
    "specifically curious",          # PATCH 1: variant
    "specifically asking",           # PATCH 1: variant
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


def check_cta_specifically_opener(text: str) -> list[str]:
    """Detect 'Specifically:' style transitional openers in the final paragraph.

    AI uses 'Specifically:' to add precision to a question that already exists,
    but the construction itself is an AI tell. Real users either ask the
    question directly or add the precision inline.

    Examples that fail:
      "What's your take? Specifically: did anyone crack X?"
      "Curious. Specifically curious about Y."

    Examples that pass:
      "What's your take? Did anyone crack X?"
      "Curious if anyone has tried Y."
    """
    last_para = text.strip().split("\n\n")[-1].strip()
    last_lower = last_para.lower()

    # Look for 'Specifically' followed by colon, comma, or "curious"/"asking"
    if re.search(r"\bspecifically[\s,:]", last_lower):
        return [
            "CTA section contains 'Specifically:' or 'specifically curious' "
            "transitional opener. This is an AI-coded precision marker. "
            "Either ask the question directly or add the precision inline "
            "without the 'specifically' bridge."
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
    enforce_no_tricolon: bool = True,                 # PATCH 1
    enforce_authenticity_markers: bool = True,        # PATCH 1
    enforce_max_headers: bool = True,                 # PATCH 1
    enforce_no_specifically_opener: bool = True,      # PATCH 1
    max_headers_override: int | None = None,          # PATCH 1
) -> list[str]:
    """Run all text-post-level checks against generated content.

    Args:
        text:                            the generated post text (markdown OK)
        platform:                        target platform. Affects defaults.
        x_not_y_max:                     max 'X, not Y' patterns allowed (default 0)
        enforce_no_blockquote:           if True, reject any blockquote.
                                         Default True for Reddit, False elsewhere.
        enforce_no_symmetric_headers:    if True, reject 3+ parallel headers.
        enforce_no_templated_cta:        if True, reject templated CTA endings.
        enforce_no_tricolon:             PATCH 1. If True, reject 3+ parallel
                                         consecutive sentences.
        enforce_authenticity_markers:    PATCH 1. If True, require >=1 marker
                                         on platforms in
                                         AUTHENTICITY_MARKERS_BY_PLATFORM.
        enforce_max_headers:             PATCH 1. If True, reject when header
                                         count exceeds MAX_HEADERS_BY_PLATFORM.
        enforce_no_specifically_opener:  PATCH 1. If True, reject "Specifically:"
                                         CTA bridge.
        max_headers_override:            PATCH 1. Override the per-platform max
                                         header count.

    Returns:
        Empty list if all checks pass. Otherwise list of failure messages.
    """
    failures: list[str] = []

    # C1 — universal
    failures.extend(check_x_not_y(text, max_allowed=x_not_y_max))

    # C5 — universal (PATCH 1)
    if enforce_no_tricolon:
        failures.extend(check_tricolon(text))

    # C2 — Reddit by default, optional elsewhere
    if enforce_no_blockquote is None:
        enforce_no_blockquote = (platform == "reddit") if platform else False
    if enforce_no_blockquote:
        failures.extend(check_no_blockquote(text))

    # C3 — universal
    if enforce_no_symmetric_headers:
        failures.extend(check_symmetric_headers(text))

    # C7 — per platform (PATCH 1)
    if enforce_max_headers:
        failures.extend(check_max_headers(text, platform=platform,
                                          max_override=max_headers_override))

    # C4 — universal
    if enforce_no_templated_cta:
        failures.extend(check_templated_cta(text))

    # C4b — universal (PATCH 1)
    if enforce_no_specifically_opener:
        failures.extend(check_cta_specifically_opener(text))

    # C6 — per platform (PATCH 1)
    if enforce_authenticity_markers:
        failures.extend(check_authenticity_markers(text, platform=platform))

    return failures
