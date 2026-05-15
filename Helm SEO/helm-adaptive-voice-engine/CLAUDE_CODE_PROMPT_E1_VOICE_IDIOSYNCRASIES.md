# Helm Adaptive Voice Engine — E1: Voice Idiosyncrasy Extractor

Phase 1.5. Ejecutar después de que el batch de loophole fixes esté en producción
y haya 4-6 semanas de posts acumulados por cliente para extraer patterns reales.

---

## Goal

El sistema actual guarda posts pasados en `voice_fingerprint` y le pide al
modelo "match this voice". El modelo es malo en eso. Los posts pasados se
inyectan como ejemplos pero el modelo no extrae patterns estructurados
consistentes.

Este sprint construye un extractor que analiza N posts del cliente y produce
una `VoiceIdiosyncrasies` estructurada con patterns concretos (em dash usage,
filler words, sentence length, capitalization, etc.). Estas se inyectan como
**reglas concretas** en el prompt, no como ejemplos pasivos. El modelo
ejecuta reglas mejor que extrapola de ejemplos.

## Hypothesis being tested

Si reemplazamos "match this voice from these examples" con "this writer uses
em dashes 0.2 times per 1000 words, prefers fragments (40% of sentences),
opens with 'ok so' frequently", la output va a sentirse dramáticamente más
auténtico para cada cliente individual.

## Risks (importante leer antes de empezar)

1. **Overfitting a posts viejos.** Si un cliente cambia su voz, las
   idiosincrasias están desactualizadas. Mitigación: re-extraction nightly
   con sliding window de últimos 30 días.

2. **Bias from outliers.** Un post raro (rant, anuncio formal) sesga las
   stats. Mitigación: minimum N=10 posts, descartar el top y bottom 10% de
   length antes de calcular promedios.

3. **Cold start.** Cliente nuevo no tiene posts. Mitigación: idiosincrasias
   son `None` hasta que haya 10+ posts; el prompt builder hace fallback al
   comportamiento actual sin inyectar reglas.

4. **Over-application.** Modelo podría usar "tbh" en CADA post si la regla
   dice "writer uses tbh frequently". Mitigación: las reglas se inyectan
   con frecuencia explícita ("uses 'tbh' in 60% of posts, not every post")
   y un test de variety en el validator.

5. **Privacy.** Las idiosincrasias revelan patterns personales. Mitigación:
   se guardan dentro de ClientContext (mismo nivel de protección que
   brand_bible), nunca se exponen al cliente directamente, audit log
   captura cualquier mutation.

## Scope

**En scope:**
- New schema: `VoiceIdiosyncrasies` Pydantic model
- New file: `voice_idiosyncrasy_extractor.py` con statistical analysis
- ClientContext extension: nuevo field `voice_idiosyncrasies` per platform
- Background job runner: invocable manualmente o desde cron
- Integration: prompt_builder inyecta las idiosincrasias como reglas concretas
- Feature flag para A/B test antes de habilitar permanente

**Out of scope (Phase 2+):**
- ML-based extraction (usar LLM para extraer idiosincrasias en lugar de regex/stats)
- Per-content-type idiosyncrasies (writer puede tener diferente voz en LinkedIn vs X)
- Cross-client pattern aggregation para "voice typing"

---

## Files to CREATE

| Archivo nuevo | Propósito |
|---|---|
| `voice_idiosyncrasy_extractor.py` | Statistical analysis de posts; produce VoiceIdiosyncrasies |
| `voice_idiosyncrasy_job.py` | Wrapper para correr extraction como background job |

## Files to MODIFY

| Archivo existente | Qué cambiar |
|---|---|
| `client_context.py` | Add VoiceIdiosyncrasies model, agregar field a PlatformSlots |
| `prompt_builder.py` | Inyectar idiosincrasias como reglas concretas en CLIENT CONTEXT block |

---

## Detailed Changes

### NEW FILE 1: voice_idiosyncrasy_extractor.py

```python
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
```

### NEW FILE 2: voice_idiosyncrasy_job.py

```python
"""
voice_idiosyncrasy_job.py
==========================

Background job to extract voice idiosyncrasies for a client and persist them
to ClientContext.

Recommended schedule: nightly cron, one run per client per platform with
>= 10 posts on that platform.

Usage:
    from voice_idiosyncrasy_job import run_extraction_for_client

    await run_extraction_for_client(
        client_id=client.id,
        platform=Platform.LINKEDIN,
        context_repository=ctx_repo,
    )

Version: 1.0 (Phase 1.5)
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Protocol
from uuid import UUID

from client_context import (
    AuditEntry,
    ClientContext,
    Platform,
)
from voice_idiosyncrasy_extractor import extract_voice_idiosyncrasies


class ContextRepository(Protocol):
    """Minimal contract for the storage layer that persists ClientContexts."""

    async def get(self, client_id: UUID) -> ClientContext: ...

    async def save(self, context: ClientContext) -> None: ...


async def run_extraction_for_client(
    *,
    client_id: UUID,
    platform: Platform,
    context_repository: ContextRepository,
    operator_id: str = "system:nightly_extraction",
) -> bool:
    """Extract voice idiosyncrasies for a single (client, platform) pair
    and persist to ClientContext.

    Returns True if idiosyncrasies were updated, False if not enough posts
    or extraction returned None.
    """
    ctx = await context_repository.get(client_id)
    slots = ctx.get_platform_slots(platform)

    # Use voice_fingerprint as the source posts for extraction
    posts = slots.voice_fingerprint
    if len(posts) < 10:
        return False

    new_idiosyncrasies = extract_voice_idiosyncrasies(posts)
    if new_idiosyncrasies is None:
        return False

    previous = slots.voice_idiosyncrasies
    slots.voice_idiosyncrasies = new_idiosyncrasies

    ctx.audit_log.append(
        AuditEntry(
            action="voice_idiosyncrasies_extracted",
            platform=platform,
            previous_value=previous.model_dump() if previous else None,
            new_value=new_idiosyncrasies.model_dump(),
            operator_id=operator_id,
            notes=f"sample_size={new_idiosyncrasies.sample_size}",
        )
    )
    ctx.updated_at = datetime.now(timezone.utc)

    await context_repository.save(ctx)
    return True


async def run_extraction_for_all_clients(
    *,
    client_ids: list[UUID],
    platforms: list[Platform],
    context_repository: ContextRepository,
) -> dict[tuple[UUID, Platform], bool]:
    """Batch extraction across multiple clients and platforms. Use as the
    nightly job entry point.

    Returns a dict of (client_id, platform) -> bool indicating which combos
    were updated.
    """
    results: dict[tuple[UUID, Platform], bool] = {}
    for client_id in client_ids:
        for platform in platforms:
            try:
                updated = await run_extraction_for_client(
                    client_id=client_id,
                    platform=platform,
                    context_repository=context_repository,
                )
                results[(client_id, platform)] = updated
            except Exception:
                results[(client_id, platform)] = False
    return results
```

### MODIFY: client_context.py

**Find** the imports at the top of the file (after `from __future__ import annotations`):

**Add this new model** somewhere in the "Building blocks" section (between `BrandBible` and the maturity stage configuration):

```python
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
```

**Find** the `PlatformSlots` class:

**Add** a new field to PlatformSlots (right after `last_update_post_index`):

```python
    voice_idiosyncrasies: VoiceIdiosyncrasies | None = Field(
        default=None,
        description="Per-platform extracted voice patterns. Updated by "
                    "voice_idiosyncrasy_job. None until 10+ posts accumulate."
    )
```

### MODIFY: prompt_builder.py

**Find** the `_format_dynamic_context` function.

**At the top of that function** (right after the existing variable assignments like `voice_samples = ...`), add:

```python
    voice_idiosyncrasies = context.get_platform_slots(platform).voice_idiosyncrasies
```

**Find** the section in the lines list that starts with:
```python
    lines.append("")
    lines.append("VOICE_FINGERPRINT (writer's actual past output on this platform, sorted by weight):")
```

**Insert immediately BEFORE the VOICE_FINGERPRINT section**, this new block:

```python
    if voice_idiosyncrasies and not voice_idiosyncrasies.is_stale():
        from voice_idiosyncrasy_extractor import format_idiosyncrasies_as_prompt_rules
        lines.append("")
        lines.append(format_idiosyncrasies_as_prompt_rules(voice_idiosyncrasies))
```

This makes the WRITER VOICE PROFILE section appear before the raw voice samples,
so the model sees the structured rules first and uses the samples as
illustration of those rules.

---

## Test plan

### Test 1: Schema validation
```python
from client_context import VoiceIdiosyncrasies
from datetime import datetime, timezone

# Valid construction
v = VoiceIdiosyncrasies(
    sample_size=15,
    em_dash_per_1000_words=0.2,
    ellipsis_per_1000_words=3.5,
    semicolon_per_1000_words=0.0,
    parenthetical_aside_per_1000_words=4.0,
    lowercase_first_letter_ratio=0.3,
    avg_sentence_length_words=8.5,
    fragment_ratio=0.4,
    profanity_per_1000_words=0.5,
    emoji_per_post=0.2,
    hedging_ratio=0.7,
    self_correction_count=2,
)
assert v.sample_size == 15
assert v.is_stale() is False

# Invalid construction (sample_size < 10)
try:
    VoiceIdiosyncrasies(sample_size=5, ...)
    assert False, "Should have raised"
except Exception:
    pass
```

### Test 2: Extraction with synthetic posts
```python
from voice_idiosyncrasy_extractor import extract_voice_idiosyncrasies
from client_context import WeightedPost

posts = [
    WeightedPost(
        post_id=uuid4(),
        platform=Platform.LINKEDIN,
        content_type=ContentType.TEXT,
        text="ok so I dropped buffer last month. Wasted ~$200 on it tbh. Anyway.",
        posted_at=datetime.now(timezone.utc),
        quality_score=1.0,
        weight=0.9,
    ),
    # ... 14 more posts with similar patterns
]

idio = extract_voice_idiosyncrasies(posts)
assert idio is not None
assert "tbh" in idio.common_filler_words
assert idio.lowercase_first_letter_ratio > 0.5  # mostly lowercase
assert "ok so" in idio.common_openers
assert "anyway" in idio.common_closers
```

### Test 3: Cold start (< 10 posts)
```python
posts = [WeightedPost(...) for _ in range(5)]
idio = extract_voice_idiosyncrasies(posts)
assert idio is None
```

### Test 4: Outlier trimming
Inject 20 posts where 2 are 10x the average length (rant outliers). Verify
the extracted stats are not skewed by the outliers.

### Test 5: Format as prompt rules
```python
from voice_idiosyncrasy_extractor import format_idiosyncrasies_as_prompt_rules

text = format_idiosyncrasies_as_prompt_rules(idio)
assert "WRITER VOICE PROFILE" in text
assert "PUNCTUATION PATTERNS" in text
assert "tbh" in text  # if present in idio
assert len(text) < 3000  # Reasonable size for prompt injection
```

### Test 6: Background job end-to-end
```python
from voice_idiosyncrasy_job import run_extraction_for_client

# Set up a test ClientContext with 15 posts in voice_fingerprint
# Run the job
updated = await run_extraction_for_client(
    client_id=test_client.id,
    platform=Platform.LINKEDIN,
    context_repository=test_repo,
)
assert updated is True

# Verify the context now has voice_idiosyncrasies populated
ctx = await test_repo.get(test_client.id)
slots = ctx.get_platform_slots(Platform.LINKEDIN)
assert slots.voice_idiosyncrasies is not None
assert slots.voice_idiosyncrasies.sample_size >= 10

# Verify audit log has the entry
last_entry = ctx.audit_log[-1]
assert last_entry.action == "voice_idiosyncrasies_extracted"
```

### Test 7: Prompt builder integration
```python
prompt = build_generation_prompt(
    platform=Platform.LINKEDIN,
    content_type=ContentType.TEXT,
    client_context=ctx_with_idiosyncrasies,
    pain_point="...",
)
assert "WRITER VOICE PROFILE" in prompt
assert "PUNCTUATION PATTERNS" in prompt
```

---

## Validation criteria

- [ ] 2 archivos nuevos compilan sin errores
- [ ] Schema validation passes (test 1)
- [ ] Extraction returns valid VoiceIdiosyncrasies for 15-post sample (test 2)
- [ ] Cold start returns None for 5-post sample (test 3)
- [ ] Outlier trimming works (test 4)
- [ ] Format function returns < 3000 char text (test 5)
- [ ] End-to-end job persists to context + audit log (test 6)
- [ ] Prompt builder integrates the new section when idiosyncrasies present (test 7)
- [ ] Existing tests for client_context.py and prompt_builder.py still pass

## Rollout plan

1. Ship behind feature flag `voice_idiosyncrasies_enabled` (default False)
2. Run nightly job in production for 2 weeks. Monitor extraction success rate
   and audit log for unexpected mutations.
3. A/B test: 50% of generations with idiosyncrasies injected, 50% without.
   Measure quality lift (smell test scores, user edit rates, regeneration counts).
4. If A/B shows >10% improvement in quality, flip flag to True for all clients.
5. If no improvement or regression, investigate prompt formatting before
   rolling back.

## Out of scope (next phases)

- LLM-based extraction (use Haiku to extract richer patterns than regex)
- Per-content-type idiosyncrasies (writer differs LinkedIn vs TikTok content)
- Cross-client clustering for "voice typing"
- Decay logic for old patterns (currently re-extraction overwrites cleanly)
