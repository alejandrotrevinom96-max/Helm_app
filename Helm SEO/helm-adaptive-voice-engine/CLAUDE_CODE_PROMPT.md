# Helm Adaptive Voice Engine — Loophole Fixes Batch

Ejecutar en Claude Code. Este doc contiene 10 fixes a aplicar en el repo de Helm,
agrupados por archivo. Al final hay test plan y validation criteria.

---

## Goal

Cerrar 10 loopholes detectados en revisión sistemática del prompt engineering
del Helm Adaptive Voice Engine. Estos loopholes están permitiendo que outputs
para Reddit, X, Threads y otros canales se sientan "AI-shaped" aunque pasen
las validaciones individuales actuales.

Ningún cambio rompe APIs existentes. Todas las modificaciones son aditivas
(nuevos archivos, nuevas constantes, nuevos checks en validators existentes,
nuevas secciones en strings de prompts).

## Scope

**En scope (aplicar ahora):**
- C1: Detector "X, not Y" universal
- C2: Detector blockquote en Reddit
- C3: Detector headers simétricos paralelos
- C4: Detector CTAs templated sin contexto personal
- B1: Override de "quotable lines" rule para Reddit
- A1: AUTHENTICITY MARKERS section para Reddit
- A2: AUTHENTICITY MARKERS section para X
- A3: AUTHENTICITY MARKERS section para Threads
- A4: AUTHENTICITY MARKERS section para Instagram
- A5: AUTHENTICITY MARKERS section para LinkedIn
- A6: AUTHENTICITY MARKERS section para Facebook
- F3: Authenticity smell test via Haiku LLM call

**Out of scope (Phase 1.5+, NO hacer en este sprint):**
- E1: Voice fingerprint idiosyncrasy extractor (requiere schema change en ClientContext)
- F4: Variety injection mechanism (requiere arquitectura de A/B at generation time)
- F1: Mover humanize de reactivo a preventivo (refactor profundo del flow)

---

## Files to CREATE

Path base: `lib/voice-engine/` (o donde tengan instalado el módulo Helm Adaptive Voice Engine)

| Archivo nuevo | Propósito |
|---|---|
| `text_post_validator.py` | Validator universal para text posts (catches C1, C3, C4) |
| `authenticity_smell_test.py` | F3: mini-LLM call que evalúa autenticidad final del output |

## Files to MODIFY

| Archivo existente | Qué cambiar |
|---|---|
| `platform_tone_instructions.py` | Agregar AUTHENTICITY MARKERS por platform (A1-A6), Reddit override de quotable lines (B1), Reddit anti-pattern de blockquote (C2) |
| `ugc_validator.py` | Importar y llamar X-not-Y detector compartido (C1) |

---

## Detailed Changes

### NEW FILE 1: text_post_validator.py

Crear archivo nuevo con este contenido completo:

```python
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
```

### NEW FILE 2: authenticity_smell_test.py

Crear archivo nuevo con este contenido completo:

```python
"""
authenticity_smell_test.py
==========================

Final-pass authenticity check via mini-LLM call (Haiku 4.5 recommended).

Asks: "would a real founder/operator post this on [platform]?" and returns
a 0-100 score plus structured diagnostic. Runs after all platform-specific
and content-type validators pass, as a meta-check that catches outputs
that satisfy the rules but still feel AI-shaped.

Cost: ~$0.001 per call (Haiku, ~250 tokens in, ~150 tokens out).
Latency: ~1 second.
Recommended threshold: score < 70 = fail, regenerate.

Usage:
    from authenticity_smell_test import smell_test_authenticity

    result = await smell_test_authenticity(
        post_text="...",
        platform="reddit",
        content_type="text",
        client=haiku_client,
    )
    if result.score < 70:
        # Regenerate. Send result.primary_issues as feedback to next attempt.
        ...

Version: 1.0
"""

from __future__ import annotations

import json
from typing import Any, Protocol

from pydantic import BaseModel, Field


# ============================================================================
# Smell test prompt
# ============================================================================

SMELL_TEST_PROMPT = """You are evaluating whether a marketing post sounds like it was written by a real human or by AI. Be brutally honest. Bias toward marking AI-shaped content as fail; do not be charitable.

PLATFORM: {platform}
CONTENT_TYPE: {content_type}

POST:
{post_text}

Score the post 0-100 on AUTHENTICITY:
- 90-100: Reads exactly like a real founder/operator wrote it. Has natural imperfections (parentheticals, hedges, fragments, tangents).
- 70-89: Sounds mostly real with minor polish. Could pass for human.
- 50-69: Has noticeable AI tells. Feels slightly fabricated. A real reader would suspect.
- 30-49: Clearly AI-shaped. Multiple AI patterns visible.
- 0-29: Reads as pure AI output. Would never pass for human.

What to look for as AI tells:
- Em dashes used for breath-pause rhythm
- "X, not Y" chiastic constructions
- Tricolons (three parallel items, especially with crescendo)
- Symmetric parallel headers (3+ in matched form)
- Pre-constructed quotable lines (especially in blockquotes)
- Numbers without hedging (real humans say "around 9 months" not "9 months")
- Perfect closing CTAs ("specifically curious about...", "what's your take?")
- Polished structure with no tangents, asides, or self-corrections
- Lack of fragments, parentheticals, or informal markers (tbh, ngl, idk, fwiw)
- Words and phrases like: leverage, seamlessly, unlock, empower, harness, dive into, delve into

What real humans on this platform DO:
- Reddit: include "tbh", "ngl", "imo", "fwiw"; hedge numbers; parenthetical asides; sometimes end with "anyway" or trail off
- X / Threads: lowercase first letter sometimes; abandon thoughts; reply-thread feel
- LinkedIn: include specific personal details (date, name, tool); admit uncertainty
- Instagram: storytelling with parenthetical asides
- Facebook: warm conversational, less polished than LinkedIn

Output JSON:
{{
  "score": <integer 0-100>,
  "verdict": "<one of: pass, borderline, fail>",
  "primary_issues": ["<top 1-3 issues, each 1 short sentence>"],
  "what_would_make_it_human": "<one concrete suggestion, 1 sentence>"
}}

Verdict mapping: pass = score >= 70, borderline = 50-69, fail = below 50.

Return only the JSON. No commentary."""


# ============================================================================
# Result model
# ============================================================================

class SmellTestResult(BaseModel):
    """Structured output from the authenticity smell test."""
    score: int = Field(..., ge=0, le=100)
    verdict: str  # pass / borderline / fail
    primary_issues: list[str] = Field(default_factory=list)
    what_would_make_it_human: str = ""

    @property
    def passes(self) -> bool:
        return self.score >= 70


# ============================================================================
# LLM client protocol
# ============================================================================

class LLMClient(Protocol):
    async def complete_json(self, *, model: str, prompt: str, max_tokens: int = 400) -> str:
        ...


# ============================================================================
# Public API
# ============================================================================

async def smell_test_authenticity(
    *,
    post_text: str,
    platform: str,
    content_type: str,
    client: LLMClient,
    model: str = "claude-haiku-4-5",
    threshold: int = 70,
    max_retries: int = 1,
) -> SmellTestResult:
    """Run the authenticity smell test on a generated post.

    Args:
        post_text:    the final generated text to evaluate
        platform:     target platform (reddit, linkedin, x, etc.)
        content_type: target content type (text, ugc, etc.)
        client:       LLMClient adapter
        model:        model id, default Haiku for speed/cost
        threshold:    score below this is considered failure (default 70)
        max_retries:  retries on JSON parse failure

    Returns:
        SmellTestResult with score, verdict, primary issues, and suggestion.

    Raises:
        SmellTestError if all retries fail to produce valid JSON.
    """
    prompt = SMELL_TEST_PROMPT.format(
        platform=platform,
        content_type=content_type,
        post_text=post_text.strip(),
    )

    last_error: Exception | None = None

    for attempt in range(max_retries + 1):
        try:
            raw = await client.complete_json(
                model=model,
                prompt=prompt,
                max_tokens=400,
            )
            payload = _extract_json_object(raw)
            return SmellTestResult.model_validate(payload)
        except (json.JSONDecodeError, ValueError) as e:
            last_error = e
            continue

    raise SmellTestError(
        f"Failed to parse smell test result after {max_retries + 1} attempts. "
        f"Last error: {last_error}"
    )


def _extract_json_object(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text
        if text.endswith("```"):
            text = text.rsplit("```", 1)[0]
        text = text.strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise json.JSONDecodeError("No JSON object found in response", text, 0)
    return json.loads(text[start : end + 1])


class SmellTestError(Exception):
    """Raised when the smell test fails after all retries."""
```

### MODIFY: ugc_validator.py

Importar el detector compartido y agregarlo al list de checks.

**Find:** la línea `import re` (debería existir ya).

**After the `import re` line, add:**
```python
from text_post_validator import check_x_not_y
```

**Find the `validate_ugc_bundle` function. Inside it, find the line:**
```python
    failures.extend(_check_swipe_test_self_report(bundle))
```

**Add immediately after that line (before `return failures`):**
```python
    failures.extend(check_x_not_y(bundle.script_text))
    failures.extend(check_x_not_y(bundle.caption))
```

### MODIFY: platform_tone_instructions.py

Aplicar 8 ediciones. Todas son aditivas (agregar texto a strings de prompts existentes).

#### A1: Add AUTHENTICITY MARKERS to PLATFORM_TONE_INSTRUCTIONS["reddit"]

**Find this section in the Reddit string:**
```
ANTI-PATTERNS (reject and regenerate):
  - Exclamation points
```

**Insert immediately BEFORE that section, this new section:**
```
AUTHENTICITY MARKERS (mandatory for Reddit):
  - Include at least one informal marker: "tbh", "ngl", "imo", "fwiw", "idk".
    These signal real-human voice; their absence is a strong AI tell on Reddit.
  - Include at least one parenthetical aside (like this) or self-correction
    ("actually wait, that's not quite right").
  - Numbers should hedge: "about 9 months", "maybe 7 tools", "I think around X",
    "give or take". Real humans approximate; AI is unnaturally precise.
  - Acceptable to end with "anyway", "idk", or to stop abruptly without a CTA.
  - Acceptable to add an "edit:" line at the bottom (signals real engagement).
  - Avoid pre-constructed quotable lines (especially in blockquotes). Reddit
    explicitly downvotes posts that look like they were written for screenshots.
  - Maximum 2 markdown headers in the entire post. Three or more headers
    in parallel form ("What I X / What I Y / What I Z") is essay-shaped
    and reads as AI.

OVERRIDES TO CONTENT_TYPE_RULES["text"] (Reddit-specific):
  - The QUOTABLE LINES guidance from CONTENT_TYPE_RULES["text"] does NOT apply
    on Reddit. Do NOT include pre-constructed quotable lines designed for
    screenshots. Insights should emerge from concrete data and confession,
    not from crafted bumper stickers.
  - The "punchy one-word emphasis sentences" guidance is suspended on Reddit.
    Use 0 of these. They feel AI-coded in this context.

```

#### A2: Add AUTHENTICITY MARKERS to PLATFORM_TONE_INSTRUCTIONS["x"]

**Find this section in the X string:**
```
LONG-FORM (Premium only):
```

**Insert immediately BEFORE that section, this new section:**
```
AUTHENTICITY MARKERS (mandatory for X / Twitter):
  - For threads, include at least one tweet that breaks the polished arc:
    "wait, also", "actually", "hmm", or a short tangent.
  - Lowercase first letter is acceptable and often signals authenticity on X.
  - Acceptable to abandon a thought mid-tweet or end with "..." or "idk".
  - For single tweets, fragments and incomplete sentences are encouraged.
  - Replies and quote-tweets are conversational, never press releases.
  - Numbers should hedge ("around X", "like 7 tools", "maybe 200 followers").

```

#### A3: Add AUTHENTICITY MARKERS to PLATFORM_TONE_INSTRUCTIONS["threads"]

**Find this section in the Threads string:**
```
ANTI-PATTERNS (reject and regenerate):
  - Overly polished marketing copy (Threads readers smell it instantly)
```

**Insert immediately BEFORE that section, this new section:**
```
AUTHENTICITY MARKERS (mandatory for Threads):
  - Lowercase or mixed case is acceptable and often signals authenticity.
  - Acceptable to start with "ok so", "wait", "hot take:", or "thinking about".
  - Fragments, ellipses, and incomplete sentences are encouraged.
  - No need for grammatically complete sentences.
  - Acceptable to end with "idk", "anyway", or just stop.
  - Numbers should hedge.

```

#### A4: Add AUTHENTICITY MARKERS to PLATFORM_TONE_INSTRUCTIONS["instagram"]

**Find this section in the Instagram string:**
```
ANTI-PATTERNS (reject and regenerate):
  - "Excited to share", "Thrilled to announce", "Humbled to"
```

**Insert immediately BEFORE that section, this new section:**
```
AUTHENTICITY MARKERS (mandatory for Instagram captions):
  - Caption should include at least one parenthetical aside or specific personal
    detail (a date, a place, a name, a tool).
  - Acceptable to use lowercase or mixed case throughout.
  - Voice should feel like a story being told to one specific friend, not
    narrated to an audience.
  - Numbers should hedge or have specific context ("3 weeks ago", "about 200").
  - Acceptable to break the caption with a line like "anyway" or "idk why
    I'm sharing this but".

```

#### A5: Add AUTHENTICITY MARKERS to PLATFORM_TONE_INSTRUCTIONS["linkedin"]

**Find this section in the LinkedIn string:**
```
ANTI-PATTERNS (reject and regenerate):
  - "Excited to announce", "Thrilled to share", "I'm humbled to..."
```

**Insert immediately BEFORE that section, this new section:**
```
AUTHENTICITY MARKERS (mandatory for LinkedIn):
  - Include at least one specific personal detail: a real date, a real name,
    a real city, a specific tool, a specific dollar amount with context.
  - Acceptable to admit uncertainty ("I'm not sure if this is right but",
    "honestly still figuring this out", "could be wrong").
  - Numbers should be defensible: include source, context, or method
    ("based on the last 30 posts", "I time-tracked it for 2 weeks").
  - Maximum 2 headers per post (LinkedIn long-form rarely uses headers).
  - Avoid pre-constructed quotable lines that are clearly designed for
    screenshots. Insights should emerge from the story, not be bumper stickers.

```

#### A6: Add AUTHENTICITY MARKERS to PLATFORM_TONE_INSTRUCTIONS["facebook"]

**Find this section in the Facebook string:**
```
ANTI-PATTERNS (reject and regenerate):
  - Sharp X-style takes (feel out of place on Facebook)
```

**Insert immediately BEFORE that section, this new section:**
```
AUTHENTICITY MARKERS (mandatory for Facebook):
  - Include at least one specific personal detail (where, when, who).
  - Conversational warmth over editorial polish.
  - Acceptable to ramble slightly or include a side anecdote.
  - Numbers should hedge ("about", "around", "I think").

```

#### B1: Already covered by the "OVERRIDES TO CONTENT_TYPE_RULES" subsection in A1 above.

#### C2: Already covered by the AUTHENTICITY MARKERS subsection in A1 (last bullet about blockquotes).

---

## Integration: where to call the new validators

In your generation pipeline, after a post is generated, add these validation
steps in this order:

```python
from text_post_validator import validate_text_post
from authenticity_smell_test import smell_test_authenticity

# Step 1: Universal text post validation (fast, no LLM call)
text_failures = validate_text_post(
    text=generated_post,
    platform=platform,
)
if text_failures:
    # Regenerate with text_failures sent as feedback
    ...

# Step 2: Authenticity smell test (slower, costs ~$0.001)
smell_result = await smell_test_authenticity(
    post_text=generated_post,
    platform=platform,
    content_type=content_type,
    client=haiku_client,
)
if smell_result.score < 70:
    # Regenerate with smell_result.primary_issues sent as feedback
    ...

# If both pass, return the post to the user
return generated_post
```

For UGC bundles, the X-not-Y check is now built into validate_ugc_bundle().
For text posts (Reddit, LinkedIn text, X tweets, Threads, Facebook), call
validate_text_post() before smell_test_authenticity().

---

## Test plan

Ejecutar cada una de estas verificaciones después de aplicar todos los fixes.

### Test 1: X-not-Y detector
Crear un post de prueba con el siguiente contenido y correr `validate_text_post`.
Debe regresar al menos 1 failure mencionando "X, not Y".

```
The skill that got you to a working product is almost the opposite of the
skill that gets people to use it. It's not a productivity problem. It's a
systems problem. Writing in public about specific decisions, not generic
lessons.
```

Esperado: count de patterns >= 3 (chiastic flip + opposite-of construction
+ ", not Y" appositive).

### Test 2: Blockquote detector for Reddit
Correr `validate_text_post(text, platform="reddit")` con:

```
> The skill that got you to a working product is the opposite of the skill
that gets people to use it.

That's the part that broke me.
```

Esperado: 1 failure mencionando blockquote en Reddit.

### Test 3: Symmetric headers detector
Correr `validate_text_post` con un post que tenga estos headers:

```
## What I got wrong

content...

## What I learned

content...

## What's still hard

content...
```

Esperado: 1 failure mencionando 3+ headers starting with "What".

### Test 4: Templated CTA detector
Correr `validate_text_post` con un post que termine en:

```
Specifically curious about your experience.
```

Esperado: 1 failure mencionando templated CTA sin follow-up.

Y luego correr con un post que termine en:

```
What worked for you? Honestly asking, I'm trying X next month and want to
not waste the time.
```

Esperado: 0 failures (templated CTA con follow-up personal context).

### Test 5: Smell test happy path
Correr `smell_test_authenticity` con un post de calidad humana real (uno
que escribiste tú a mano). Score esperado: >= 70.

Después correr con el post de Reddit problemático que descubrimos
(el que tiene blockquote, headers simétricos, "X, not Y" patterns).
Score esperado: <= 60.

### Test 6: AUTHENTICITY MARKERS sections present in prompts
Imprimir `PLATFORM_TONE_INSTRUCTIONS["reddit"]` y verificar que contiene
el string "AUTHENTICITY MARKERS". Repetir para x, threads, instagram,
linkedin, facebook.

### Test 7: End-to-end Reddit regeneration
Generar un post para Reddit con el sistema completo (build_generation_prompt
con content_type=text, platform=reddit). Correr todos los validators.
Output esperado: 0 failures, smell test score >= 70.

Si después de 2 retries el output sigue fallando, marcar el test como
calibration issue y abrir issue para revisar prompts.

---

## Validation criteria

Antes de mergear:

- [ ] Los 2 archivos nuevos compilan sin errores
- [ ] `ugc_validator.py` imports `check_x_not_y` correctamente
- [ ] Los 6 platform strings en `platform_tone_instructions.py` contienen "AUTHENTICITY MARKERS"
- [ ] Reddit string contiene "OVERRIDES TO CONTENT_TYPE_RULES" subsection
- [ ] Reddit string contiene la regla de "Maximum 2 markdown headers"
- [ ] Tests 1-7 pasan
- [ ] No se rompen tests existentes del módulo UGC ni del módulo visual

## Out of scope (no hacer en este sprint)

Documentar en backlog para Phase 1.5 / 2:

- E1: Voice fingerprint idiosyncrasy extractor. Requiere:
  - Schema change en SubjectBlock para almacenar idiosincrasias estructuradas
    (ellipsis usage, semicolon avoidance, "tbh"/"ngl" preference, etc.)
  - Job nocturno que analiza últimos 20 posts del cliente y extrae patterns
  - Inyección de las idiosincrasias en el prompt como rules concretas

- F4: Variety injection mechanism. Requiere:
  - Architecture decision sobre cómo forzar variación deliberada
  - Probabilistic rule perturbation (10-15% de generations rompen una regla)
  - Telemetry para medir si variety injection mejora o empeora performance

- F1: Mover humanize de reactivo a preventivo. Requiere:
  - Refactor del flow de generación
  - Las reglas de humanize embebidas en los prompts de generación
  - Eliminación del paso de "post-process humanize"
  - Re-evaluación de todo el output con la nueva arquitectura

Cuando vaya cualquiera de estos a sprint, abrir su propio Claude Code prompt
con análisis de risks y migration plan.

---

## Notas finales

- El smell test (F3) agrega ~1s de latencia y ~$0.001 por post generado.
  A volumen MVP es trivial. Si latency se vuelve issue en producción,
  considerar correrlo como check asíncrono que solo bloquea si falla.
- Los validators C1-C4 son síncronos y rápidos (< 10ms total).
- Si un cliente legítimamente quiere usar blockquotes en Reddit (rara vez),
  agregar parameter `enforce_no_blockquote=False` al call de validate_text_post
  per-cliente.
- Después de 2 semanas en producción, revisar:
  - Tasa de failures de cada check (¿alguno está demasiado estricto?)
  - Distribución de smell test scores (¿70 es el threshold correcto o
    necesitamos calibrar?)
  - Tiempo promedio de regeneración por failure
