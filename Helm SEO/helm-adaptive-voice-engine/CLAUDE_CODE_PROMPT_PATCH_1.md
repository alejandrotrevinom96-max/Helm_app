# Helm Adaptive Voice Engine — Patch 1: Loophole Fixes Round 2

Patch posterior al CLAUDE_CODE_PROMPT.md inicial. Cierra 5 gaps específicos
que se descubrieron después del primer Reddit post real generado con la
nueva pipeline.

---

## Goal

El batch original cerró C1-C4 + B1 + A1-A6 + F3. En producción, un post real
de Reddit todavía dejó pasar 5 patterns AI:

1. `"it's not a plan, it's a costume"` — chiastic flip con coma como separator
   (el regex actual requiere período)
2. `"Not a content calendar. Not a funnel diagram. You, writing..."` — tricolon
   sin detector en código (solo en humanize SKILL.md)
3. Cero "tbh/ngl/fwiw/imo" en un Reddit post — la regla AUTHENTICITY MARKERS
   está en el prompt pero no enforced en validator
4. 4 markdown headers en un Reddit post — la regla "max 2 headers" está en el
   prompt pero no enforced en validator
5. `"Specifically: did anyone..."` — variant de templated CTA no incluido en list

Este patch agrega 4 funciones nuevas y modifica 2 constantes en
`text_post_validator.py`. Sin nuevos archivos. Sin schema changes.

## Scope

**En scope:**
- Fix #1: Regex de check_x_not_y acepta coma como separator chiastic
- Fix #2: Nueva función `check_tricolon` (3+ frases consecutivas paralelas)
- Fix #3: Nueva función `check_authenticity_markers` (Reddit requiere ≥1 marker)
- Fix #4: Nueva función `check_max_headers` (per-platform max)
- Fix #5: Expandir TEMPLATED_CTAS + nueva función `check_cta_specifically_opener`

**Out of scope:**
- Detección de parallelism subtle ("X feels like Y, A feels like B"). El smell
  test (F3) cubre esto mejor que regex.
- Per-platform variants de las nuevas funciones. Empezar con defaults sensatos.

---

## Files to MODIFY

| Archivo | Cambios |
|---|---|
| `text_post_validator.py` | 4 funciones nuevas, 2 constantes nuevas, 1 regex actualizado, validate_text_post() expandido |

Solo un archivo modificado. Sin archivos nuevos.

---

## Detailed Changes

### Fix #1: check_x_not_y regex acepta coma

**Find** la lista `X_NOT_Y_PATTERNS` (cerca del inicio de `text_post_validator.py`):

```python
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
```

**Replace** with:

```python
X_NOT_Y_PATTERNS: list[re.Pattern] = [
    # ", not X" appositive (e.g., "build, not buy", "specific decisions, not generic lessons")
    re.compile(r"[,;]\s+not\s+\w+", re.IGNORECASE),
    # "It's not X. It's Y." OR "It's not X, it's Y." chiastic flip
    # (PATCH 1: now accepts comma as separator, was previously only [.!])
    re.compile(r"\bit'?s?\s+not\s+[\w\s'-]{2,60}[.!,]\s*it'?s?\s+", re.IGNORECASE),
    # "isn't X. It's Y" / "isn't X, It's Y" / "isn't X. That's Y"
    # (PATCH 1: same fix as above, now accepts comma)
    re.compile(r"\bisn'?t\s+[\w\s'-]{2,60}[.!,]\s*(it'?s|that'?s|the)\s+", re.IGNORECASE),
    # "X is the opposite of Y" (rare but distinctive)
    re.compile(r"\bis\s+(almost\s+)?the\s+opposite\s+of\s+\w+", re.IGNORECASE),
]
```

Note: I also removed the comma `,` from the inner character class `[\w\s,'-]`
to avoid catastrophic backtracking. The comma is now reserved for the separator
position only.

### Fix #2: Add check_tricolon function

**Find** the line that says `# C2: Blockquote detection` (or wherever the C2
section starts).

**Insert immediately BEFORE** that section (so check_tricolon lives between C1
and C2):

```python
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
```

### Fix #3: Add check_authenticity_markers function

**Find** the section header for `C4: Templated CTA detector`.

**Insert immediately BEFORE** that section:

```python
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
```

### Fix #4: Add check_max_headers function

**Insert immediately BEFORE** the `# C4: Templated CTA detector` section
(after check_authenticity_markers from Fix #3):

```python
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
```

### Fix #5: Expand TEMPLATED_CTAS + add check_cta_specifically_opener

**Find** the `TEMPLATED_CTAS` constant.

**Replace** with:

```python
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
```

**Find** the `check_templated_cta` function.

**Insert immediately AFTER** that function:

```python
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
```

### Update validate_text_post to call all new checks

**Find** the `validate_text_post` function.

**Replace** with:

```python
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
```

---

## Test plan

### Test 1: Comma-separated chiastic flip

```python
text = "If your distribution plan requires you to become a different person to execute it, it's not a plan, it's a costume."
failures = check_x_not_y(text)
assert len(failures) >= 1
assert "X, not Y" in failures[0] or "constructions" in failures[0]
```

### Test 2: Tricolon detection

```python
# Same first word
text = "Not a content calendar. Not a funnel diagram. Not a buyer persona."
failures = check_tricolon(text)
assert len(failures) >= 1
assert "tricolon" in failures[0].lower()

# Short parallel
text = "Build. Ship. Scale."
failures = check_tricolon(text)
assert len(failures) >= 1

# Single sentence (no tricolon)
text = "Build it."
failures = check_tricolon(text)
assert failures == []

# 2 parallel sentences (not tricolon)
text = "Build it. Ship it."
failures = check_tricolon(text)
assert failures == []
```

### Test 3: Authenticity markers required

```python
# Reddit post with no markers
text = "Spent 14 months building. Distribution is harder than I thought. Numbers below."
failures = check_authenticity_markers(text, platform="reddit")
assert len(failures) >= 1
assert "tbh" in failures[0]

# Reddit post with marker
text = "Spent 14 months building. Distribution is harder than I thought tbh."
failures = check_authenticity_markers(text, platform="reddit")
assert failures == []

# LinkedIn (no requirement)
text = "Some clean LinkedIn copy without tbh."
failures = check_authenticity_markers(text, platform="linkedin")
assert failures == []
```

### Test 4: Max headers per platform

```python
text = """
## What flopped
content
## What worked
content
## The lesson
content
"""

# Reddit caps at 2, this has 3
failures = check_max_headers(text, platform="reddit")
assert len(failures) >= 1

# Same text on LinkedIn caps at 2, also fails
failures = check_max_headers(text, platform="linkedin")
assert len(failures) >= 1

# Same text with no platform default cap = 5, passes
failures = check_max_headers(text)
assert failures == []

# Override
failures = check_max_headers(text, max_override=10)
assert failures == []
```

### Test 5: Specifically opener detection

```python
# Bad: Specifically: as transitional
text = "What worked for you? Specifically: did anyone crack a channel?"
failures = check_cta_specifically_opener(text)
assert len(failures) >= 1

# Bad: specifically curious
text = "Curious about distribution. Specifically curious about cold DMs."
failures = check_cta_specifically_opener(text)
assert len(failures) >= 1

# Good: direct question
text = "What worked for you? Did anyone crack a channel?"
failures = check_cta_specifically_opener(text)
assert failures == []
```

### Test 6: End-to-end on the failed Reddit post

Take the actual Reddit post that slipped through (from the conversation that
prompted this patch). Run `validate_text_post(text, platform="reddit")`.
Verify failures detected:

- 1+ X-not-Y failure (catches "it's not a plan, it's a costume")
- 1+ tricolon failure (catches "Not X. Not Y. You...")
- 1+ authenticity marker failure (no tbh/ngl/etc.)
- 1+ max headers failure (4 headers, max is 2)
- 1+ specifically opener failure (Specifically: did anyone)

Expected: 5+ failures total. After regeneration with feedback, post should
pass cleanly.

### Test 7: Existing tests still pass

Run all 7 tests from the original CLAUDE_CODE_PROMPT.md test plan. They should
still pass. The new checks are additive and use new functions; existing
behavior is unchanged.

---

## Validation criteria

- [ ] text_post_validator.py compiles without errors
- [ ] All 5 new functions exist: check_tricolon, check_authenticity_markers,
      check_max_headers, check_cta_specifically_opener (and the modified
      check_x_not_y still works)
- [ ] X_NOT_Y_PATTERNS regex now matches comma-separated chiasm
- [ ] TEMPLATED_CTAS contains the new "specifically curious" and
      "specifically asking" entries
- [ ] validate_text_post accepts the 4 new flag parameters with correct
      defaults
- [ ] Tests 1-6 pass
- [ ] Test 7 (regression on original test plan) passes

## Rollout

1. Ship the patch to production.
2. Run for 1 week. Monitor:
   - Tasa de regeneraciones por failure de cada nuevo check
   - Falsos positivos reportados (operator marca un check como too strict)
3. Si tasa de failures > 50% sostenido en alguno de los nuevos checks,
   calibrar threshold:
   - check_authenticity_markers: tal vez el set de markers para Reddit es
     demasiado angosto, expandir
   - check_max_headers: si LinkedIn legítimamente usa 3 headers a veces,
     subir cap a 3
   - check_tricolon: si está cazando false positives en data_drop posts,
     agregar exception por VarietyMode
4. Si tasa de smell test scores sube significativamente (Haiku detectando
   menos AI tells), confirmar que los fixes están haciendo su trabajo.

## Out of scope (not in this patch)

- **Subtle parallel detection** (e.g., "X feels like A, Y feels like B").
  Demasiado difícil para regex sin generar false positives en frases
  completamente naturales. Confiar en el smell test (F3) para esto.
- **VarietyMode-aware exceptions.** En modo data_drop el check de tricolon
  puede ser demasiado estricto (las listas de números son tricolon-shaped por
  diseño). Por ahora tolerar esto; si se vuelve issue, agregar parameter
  `variety_mode` a `check_tricolon` que relaja el check para data_drop.
- **Per-subreddit authenticity markers.** Algunos subs (r/Entrepreneur)
  toleran menos jerga que otros (r/indiehackers). Por ahora un set único
  para Reddit; calibrar después con data.
