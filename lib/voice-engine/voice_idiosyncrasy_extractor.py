"""
voice_idiosyncrasy_extractor.py
================================

Extracts structured voice idiosyncrasies from a client's accumulated posts.
The output is a VoiceIdiosyncrasies object that gets injected into the
generation prompt as concrete rules (not passive examples).

Recommended schedule: run nightly per (client, platform) once the client has
>= 10 posts on that platform. Re-run with sliding 30-day window to catch
voice drift.

Version: 1.0 (Phase 1.5)
"""

from __future__ import annotations

import re
import statistics
from collections import Counter
from datetime import datetime, timezone

from client_context import VoiceIdiosyncrasies, WeightedPost


# ============================================================================
# Tokenization helpers
# ============================================================================

WORD_RE = re.compile(r"\b[\w']+\b")
SENTENCE_END_RE = re.compile(r"[.!?]+")
EMOJI_RE = re.compile(
    "["
    "\U0001F300-\U0001FAFF"
    "\U00002600-\U000027BF"
    "\U0001F1E0-\U0001F1FF"
    "]"
)
EM_DASH_RE = re.compile(r"—|--|\s-\s")
ELLIPSIS_RE = re.compile(r"\.{3,}|…")
SEMICOLON_RE = re.compile(r";")
PARENTHETICAL_RE = re.compile(r"\([^)]{4,80}\)")  # Real asides, not citations

# Common filler words to track per-client preference
TRACKED_FILLERS: tuple[str, ...] = (
    "tbh", "ngl", "imo", "imho", "fwiw", "idk", "honestly",
    "literally", "actually", "anyway", "ok so", "alright", "look",
    "hot take", "real talk", "fr", "lowkey", "highkey",
)

# Common openers and closers
TRACKED_OPENERS: tuple[str, ...] = (
    "ok so", "alright", "tbh", "honestly", "look", "hot take",
    "real talk", "i've been thinking", "quick thought", "thinking about",
)

TRACKED_CLOSERS: tuple[str, ...] = (
    "anyway", "idk", "fwiw", "edit:", "tldr:", "thoughts?",
    "we'll see", "here's hoping",
)

# Hedging markers (vs precise numbers)
HEDGE_MARKERS: tuple[str, ...] = (
    "about", "around", "roughly", "approximately", "i think",
    "maybe", "give or take", "more or less", "ish", "kinda",
)

# Self-correction markers
SELF_CORRECTION_MARKERS: tuple[str, ...] = (
    "actually wait", "scratch that", "no wait", "hmm actually",
    "i meant", "what i meant", "let me restart",
)

# Profanity (mild list, expand per cultural context)
TRACKED_PROFANITY: tuple[str, ...] = (
    "shit", "fuck", "damn", "hell", "ass", "bullshit", "crap",
    "wtf", "tf", "af",
)


# ============================================================================
# Per-pattern extractors
# ============================================================================

def per_1000_words(count: int, total_words: int) -> float:
    """Normalize a count to a per-1000-words rate."""
    if total_words == 0:
        return 0.0
    return round((count / total_words) * 1000, 2)


def extract_punctuation_stats(combined_text: str, total_words: int) -> dict:
    return {
        "em_dash_per_1000_words": per_1000_words(
            len(EM_DASH_RE.findall(combined_text)), total_words
        ),
        "ellipsis_per_1000_words": per_1000_words(
            len(ELLIPSIS_RE.findall(combined_text)), total_words
        ),
        "semicolon_per_1000_words": per_1000_words(
            len(SEMICOLON_RE.findall(combined_text)), total_words
        ),
        "parenthetical_aside_per_1000_words": per_1000_words(
            len(PARENTHETICAL_RE.findall(combined_text)), total_words
        ),
    }


def extract_filler_word_frequencies(
    posts: list[str], total_posts: int
) -> dict[str, float]:
    """For each tracked filler, return % of posts that contain it at least once."""
    if total_posts == 0:
        return {}
    frequencies: dict[str, float] = {}
    for filler in TRACKED_FILLERS:
        post_count = sum(1 for p in posts if filler in p.lower())
        if post_count > 0:
            frequencies[filler] = round(post_count / total_posts, 2)
    return frequencies


def extract_opener_patterns(posts: list[str]) -> list[str]:
    """Return the openers the writer actually uses, ordered by frequency."""
    counter: Counter[str] = Counter()
    for post in posts:
        first_words = post.lower().strip()[:30]
        for opener in TRACKED_OPENERS:
            if first_words.startswith(opener):
                counter[opener] += 1
    return [opener for opener, _ in counter.most_common(5)]


def extract_closer_patterns(posts: list[str]) -> list[str]:
    counter: Counter[str] = Counter()
    for post in posts:
        last_words = post.lower().strip()[-50:]
        for closer in TRACKED_CLOSERS:
            if closer in last_words:
                counter[closer] += 1
    return [closer for closer, _ in counter.most_common(5)]


def extract_lowercase_first_letter_ratio(posts: list[str]) -> float:
    """Ratio of posts that start with a lowercase letter."""
    if not posts:
        return 0.0
    lowercase_starts = sum(
        1 for p in posts
        if p.strip() and p.strip()[0].islower()
    )
    return round(lowercase_starts / len(posts), 2)


def extract_sentence_stats(combined_text: str) -> dict:
    """Average sentence length and fragment ratio."""
    sentences = [s.strip() for s in SENTENCE_END_RE.split(combined_text) if s.strip()]
    if not sentences:
        return {"avg_sentence_length_words": 0, "fragment_ratio": 0.0}

    lengths = [len(WORD_RE.findall(s)) for s in sentences]
    avg_len = round(statistics.mean(lengths), 1)

    # Fragment heuristic: <= 4 words AND no verb suffix in common verbs
    fragment_count = sum(1 for length in lengths if length <= 4)
    fragment_ratio = round(fragment_count / len(sentences), 2)

    return {
        "avg_sentence_length_words": avg_len,
        "fragment_ratio": fragment_ratio,
    }


def extract_emoji_patterns(posts: list[str], total_posts: int) -> dict:
    if total_posts == 0:
        return {"emoji_per_post": 0.0, "common_emojis": []}
    all_emojis: list[str] = []
    for post in posts:
        all_emojis.extend(EMOJI_RE.findall(post))
    counter = Counter(all_emojis)
    return {
        "emoji_per_post": round(len(all_emojis) / total_posts, 2),
        "common_emojis": [emoji for emoji, _ in counter.most_common(5)],
    }


def extract_profanity_stats(combined_text: str, total_words: int) -> dict:
    text_lower = combined_text.lower()
    used: list[str] = []
    total_count = 0
    for word in TRACKED_PROFANITY:
        count = len(re.findall(rf"\b{re.escape(word)}\b", text_lower))
        if count > 0:
            used.append(word)
            total_count += count
    return {
        "profanity_per_1000_words": per_1000_words(total_count, total_words),
        "common_profanity": used,
    }


def extract_hedging_ratio(combined_text: str) -> float:
    """Ratio of numerical references that are hedged.

    Counts: number of numbers preceded or followed (within 3 words) by a
    hedge marker, divided by total numbers. Returns 0-1.
    """
    text_lower = combined_text.lower()
    numbers = list(re.finditer(r"\b\d+(?:[.,]\d+)?\b", text_lower))
    if not numbers:
        return 0.0

    hedged_count = 0
    for match in numbers:
        # Look 30 chars before for hedge markers
        window_start = max(0, match.start() - 30)
        window = text_lower[window_start : match.end()]
        if any(marker in window for marker in HEDGE_MARKERS):
            hedged_count += 1
    return round(hedged_count / len(numbers), 2)


def extract_self_correction_count(combined_text: str) -> int:
    text_lower = combined_text.lower()
    return sum(1 for marker in SELF_CORRECTION_MARKERS if marker in text_lower)


# ============================================================================
# Public API
# ============================================================================

MIN_POSTS_FOR_EXTRACTION = 10
TRIM_PERCENT = 0.10  # Trim top/bottom 10% by length to remove outliers


def extract_voice_idiosyncrasies(
    posts: list[WeightedPost],
    *,
    min_posts: int = MIN_POSTS_FOR_EXTRACTION,
) -> VoiceIdiosyncrasies | None:
    """Run statistical analysis on a list of past posts and produce
    structured voice idiosyncrasies.

    Returns None if there aren't enough posts to extract reliable patterns.
    Caller should fall back to baseline behavior in that case.
    """
    if len(posts) < min_posts:
        return None

    # Trim outliers by post length
    posts_by_length = sorted(posts, key=lambda p: len(p.text))
    trim_n = int(len(posts_by_length) * TRIM_PERCENT)
    if trim_n > 0:
        trimmed = posts_by_length[trim_n:-trim_n]
    else:
        trimmed = posts_by_length

    if len(trimmed) < min_posts:
        return None

    texts = [p.text for p in trimmed]
    combined_text = "\n\n".join(texts)
    total_words = len(WORD_RE.findall(combined_text))

    punctuation = extract_punctuation_stats(combined_text, total_words)
    sentence_stats = extract_sentence_stats(combined_text)
    emoji_stats = extract_emoji_patterns(texts, len(trimmed))
    profanity_stats = extract_profanity_stats(combined_text, total_words)

    return VoiceIdiosyncrasies(
        sample_size=len(trimmed),
        last_extracted=datetime.now(timezone.utc),
        em_dash_per_1000_words=punctuation["em_dash_per_1000_words"],
        ellipsis_per_1000_words=punctuation["ellipsis_per_1000_words"],
        semicolon_per_1000_words=punctuation["semicolon_per_1000_words"],
        parenthetical_aside_per_1000_words=punctuation["parenthetical_aside_per_1000_words"],
        lowercase_first_letter_ratio=extract_lowercase_first_letter_ratio(texts),
        common_filler_words=extract_filler_word_frequencies(texts, len(trimmed)),
        avg_sentence_length_words=sentence_stats["avg_sentence_length_words"],
        fragment_ratio=sentence_stats["fragment_ratio"],
        profanity_per_1000_words=profanity_stats["profanity_per_1000_words"],
        common_profanity=profanity_stats["common_profanity"],
        emoji_per_post=emoji_stats["emoji_per_post"],
        common_emojis=emoji_stats["common_emojis"],
        common_openers=extract_opener_patterns(texts),
        common_closers=extract_closer_patterns(texts),
        hedging_ratio=extract_hedging_ratio(combined_text),
        self_correction_count=extract_self_correction_count(combined_text),
    )


def format_idiosyncrasies_as_prompt_rules(idio: VoiceIdiosyncrasies) -> str:
    """Format a VoiceIdiosyncrasies object as concrete rules text for the
    generation prompt. The model receives this as the WRITER VOICE PROFILE
    section and applies these patterns rather than passively imitating examples.
    """
    lines = [
        f"WRITER VOICE PROFILE (analyzed from last {idio.sample_size} posts):",
        "",
        "PUNCTUATION PATTERNS:",
        f"  - Em dashes: {idio.em_dash_per_1000_words} per 1000 words "
        f"({_describe_frequency(idio.em_dash_per_1000_words, 'em_dash')})",
        f"  - Ellipsis: {idio.ellipsis_per_1000_words} per 1000 words "
        f"({_describe_frequency(idio.ellipsis_per_1000_words, 'ellipsis')})",
        f"  - Semicolons: {idio.semicolon_per_1000_words} per 1000 words",
        f"  - Parenthetical asides: {idio.parenthetical_aside_per_1000_words} per 1000 words",
        "",
        "STRUCTURE:",
        f"  - Average sentence length: {idio.avg_sentence_length_words} words",
        f"  - Fragment ratio: {int(idio.fragment_ratio * 100)}% of sentences are fragments",
        f"  - Lowercase first letter: {int(idio.lowercase_first_letter_ratio * 100)}% of posts",
        "",
        "VOCABULARY:",
    ]

    if idio.common_filler_words:
        filler_lines = [
            f"    - '{word}': used in {int(freq * 100)}% of posts"
            for word, freq in sorted(idio.common_filler_words.items(),
                                     key=lambda x: x[1], reverse=True)[:5]
        ]
        lines.append("  - Filler words used:")
        lines.extend(filler_lines)
    else:
        lines.append("  - No tracked filler words found.")

    if idio.common_profanity:
        lines.append(
            f"  - Profanity: {idio.profanity_per_1000_words} per 1000 words; "
            f"common: {', '.join(idio.common_profanity)}"
        )
    else:
        lines.append("  - No profanity in tracked sample.")

    lines.extend([
        "",
        "EMOJI:",
        f"  - {idio.emoji_per_post} emojis per post on average",
    ])
    if idio.common_emojis:
        lines.append(f"  - Common emojis: {' '.join(idio.common_emojis)}")

    lines.extend([
        "",
        "OPENERS / CLOSERS:",
    ])
    if idio.common_openers:
        lines.append(f"  - Common openers: {', '.join(idio.common_openers)}")
    if idio.common_closers:
        lines.append(f"  - Common closers: {', '.join(idio.common_closers)}")

    lines.extend([
        "",
        "NUMBERS AND CORRECTIONS:",
        f"  - Number hedging: {int(idio.hedging_ratio * 100)}% of numbers are hedged "
        f"('about X', 'around Y'). Match this hedge ratio.",
        f"  - Self-correction frequency: {idio.self_correction_count} occurrences in sample.",
        "",
        "APPLICATION RULES:",
        "  - Match these patterns approximately, not mechanically. If em dash usage",
        "    is 0.2 per 1000 words, use 0 in a 500-word post (matches the rate).",
        "  - Filler words appear in % of posts, not every post. Vary use.",
        "  - Lowercase first letter ratio is per post; use it as a probabilistic guide.",
    ])

    return "\n".join(lines)


def _describe_frequency(per_1000: float, kind: str) -> str:
    """Human-readable frequency description."""
    if per_1000 == 0:
        return "never used"
    if per_1000 < 0.5:
        return "very rare"
    if per_1000 < 2:
        return "occasional"
    if per_1000 < 5:
        return "moderate"
    return "frequent"
