# Helm Adaptive Voice Engine — F1: Humanize from Reactive to Preventive

Phase 2. El refactor más profundo de los 3 deferred items. Ejecutar después de
4-6 semanas de producción con E1 y F4 en uso, para tener data sobre qué patterns
están escapando del prompt actual y necesitan reforzarse en la versión preventiva.

---

## Goal

El sistema actual usa un workflow reactivo:
1. Genera el post (modelo produce AI tells)
2. Pasa por humanize skill (limpia los tells después del hecho)
3. Devuelve al usuario

Este es un patrón de "cleanup after the fact". Tiene 3 problemas:

1. **Token cost**: el output completo se reescribe, duplicando tokens
2. **Latency**: pasada extra de LLM call (1-3 segundos)
3. **Quality risk**: humanize a veces introduce bugs (corta una palabra crítica,
   cambia tono de un párrafo, rompe un patrón intencional del cliente)

El refactor: **inyectar las reglas de humanize EN el prompt de generación** para
que el modelo nunca produzca el AI tell para empezar. La pasada de humanize se
vuelve opcional o se elimina completa.

## Hypothesis being tested

Los modelos de la generación 2025-2026 son lo suficientemente capaces para
seguir reglas explícitas durante la composición. Pre-empotrar las reglas debería
producir output con menos AI tells que el flow actual de generate-then-clean.

Si confirmamos: ahorro de ~40% en tokens y ~30% en latencia para text posts
sin pérdida de calidad.

## Risks (importante leer antes de empezar)

1. **Prompt bloat.** El prompt ya es largo. Agregar HUMANIZE_RULES (~800 tokens)
   lo extiende más. Mitigación: comprimir al mínimo viable, usar bullets cortos.

2. **Rules-fatigue.** El modelo viendo 14 secciones de reglas puede aplicarlas
   inconsistentemente. Mitigación: A/B test riguroso, medir quality lift.

3. **Loss of safety net.** El post-process humanize era una red por si el
   prompt fallaba. Removerlo significa que cualquier slip va al usuario.
   Mitigación: mantener post-process como fallback opcional behind flag durante
   transition period (4-6 semanas).

4. **Hard rules vs soft rules.** Algunas reglas de humanize (no em dashes) son
   detectables programáticamente. Otras (varied cadence, organic flow) son
   subjetivas. Mitigación: split humanize en HARD_RULES (en prompt) +
   SOFT_RULES (post-process opcional).

5. **Backward compatibility.** Los outputs comparados en A/B test pueden tener
   distintos formatos (con vs sin override_log). Mitigación: standardize output
   format antes del refactor.

## Scope

**En scope:**
- Crear `HUMANIZE_RULES` constant en `platform_tone_instructions.py`
- Extraer "hard rules" del humanize SKILL.md y formatearlas para inyección
- Agregar `inject_humanize: bool = True` flag a `build_generation_prompt`
- Mantener humanize SKILL.md intacto para uso opcional como post-process
- Crear feature flag `humanize_preventive_enabled` para rollout controlado
- A/B test infrastructure: log si humanize fue preventive, reactive, o ambos

**Out of scope (Phase 3+):**
- Eliminación completa del humanize SKILL.md (ocurre solo después de A/B win)
- Per-platform humanize variants (algunas plataformas requieren reglas más
  estrictas; punto a evaluar después de medir baseline)
- Reverse direction: si ciertos clientes prefieren MÁS AI tells (formal voice),
  permitir disable preventive

---

## Files to CREATE

| Archivo nuevo | Propósito |
|---|---|
| `humanize_rules.py` | HUMANIZE_RULES constant (extraído de SKILL.md, formateado para prompt) |

## Files to MODIFY

| Archivo existente | Qué cambiar |
|---|---|
| `platform_tone_instructions.py` | Importar HUMANIZE_RULES, integrar en PROMPT_COMPOSITION_RULES |
| `prompt_builder.py` | Agregar `inject_humanize` flag, inyectar HUMANIZE_RULES cuando True |
| `humanize SKILL.md` (en .claude/skills/) | Agregar nota al header explicando que ahora es opcional como post-process; reglas duplicadas en humanize_rules.py |

---

## Detailed Changes

### NEW FILE: humanize_rules.py

```python
"""
humanize_rules.py
=================

The "hard rules" of the humanize skill, formatted for inline injection into
the generation prompt. Replaces the reactive post-process humanize pass for
the rules that can be expressed as concrete instructions.

The humanize SKILL.md remains available as an optional post-process fallback
for the soft rules (cadence, flow, voice nuance) that are harder to express
as instructions but easier to fix after generation.

When this module is imported and HUMANIZE_RULES is injected into a prompt:
  - The model sees the rules during composition
  - Output is structurally cleaner (fewer em dashes, no chiastic flips, etc.)
  - The post-process humanize step becomes optional or unnecessary

Version: 1.0 (Phase 2)
"""

from __future__ import annotations


HUMANIZE_RULES = """
========================================================
ANTI-AI WRITING RULES (apply during composition, not after)
========================================================

These rules apply to ALL generated content regardless of platform or content
type. Violations are anti-patterns that signal AI authorship and are rejected
by validators. Comply during composition, not as a cleanup pass.

PUNCTUATION CONSTRAINTS:
  - Em dashes (—): maximum 2 per 1000 words. Prefer periods, commas, or
    parentheses. Em dashes used for breath-pause rhythm are an AI tell.
  - Triple-hyphen breaks (---): maximum 2 per long piece. Headers or paragraph
    breaks are usually better.
  - No mid-paragraph bolding except for defined terms being introduced.
  - Smart quotes acceptable; do not mix straight and curly within one piece.

SENTENCE CONSTRUCTIONS BANNED (zero tolerance):
  - "It's not X. It's Y." chiastic flips
  - "X, not Y" appositives at end of clauses
  - "X is the opposite of Y" (any framing)
  - "isn't X. It's Y" / "isn't X. That's Y"

These rhythms are the most distinctive AI signal in text. Detect during
composition by asking: "would a human writer phrase this with the same flip?"
If you find yourself writing chiasmus, rephrase as plain prose.

TRICOLON LIMIT:
  - Maximum 1 tricolon (3 parallel items) per long piece.
  - Lists of 3+ items in bulleted form are fine; tricolons are 3 parallel
    sentences or 3 parallel clauses in a row.
  - "Build, ship, scale." / "Faster, better, stronger." are tricolons.
  - "Saves time, saves money, saves your sanity." is a tricolon.

WORDS BANNED (zero tolerance):

  Buzzwords:
    leverage, harness, unlock, empower, elevate, streamline, seamlessly,
    effortlessly, intuitively, robust, comprehensive, holistic, cutting-edge,
    state-of-the-art, game-changer

  Explainer/exploration verbs (use plain alternatives):
    dive into → look at, address
    delve into → look at, address
    unpack → explain, break down
    uncover → find, show
    navigate → handle, get through
    explore → look at

  Hedging adverbs (delete entirely; the underlying claim should stand):
    truly, genuinely, really, essentially, fundamentally, ultimately,
    frankly, honestly, literally, quite, rather, very

  Filler transitions (delete; paragraph order does the work):
    Moreover, Furthermore, Additionally, However (use "but"), Thus, Hence,
    "That said", "Having said that", "It's worth noting that",
    "It's important to note"

OPENING FLUFF (always delete):
  - "In today's fast-paced world..."
  - "In the digital age..."
  - "In the world of [X]..."
  - "Picture this:"
  - "Imagine if:"
  - "Here's the thing:"
  - "Let's break it down."
  - "Let's unpack this."

CLOSING FLUFF (delete or rewrite):
  - "At the end of the day..."
  - "At its core..."
  - "At the heart of..."
  - "In essence..."
  - "When all is said and done..."
  - "Ultimately..."

REGISTER:
  - First-person voice (I, you). Never "we" or "one" unless brand voice
    explicitly requires.
  - Specific over general (a name, a date, a tool, a number).
  - Concrete over abstract.

NUMBER HANDLING:
  - Default: hedge ("around 9 months", "about 7 tools", "I think") unless
    the post is specifically a data drop with verifiable claims.
  - Hedging is more authentic than precision in conversational posts.
  - For data drops, precision is fine but include source/method.

STRUCTURE WARNINGS:
  - Maximum 2 markdown headers per 500-word post.
  - Three or more headers in parallel form ("What I X / What I Y / What I Z")
    is essay-shaped and reads as AI.
  - One quotable line per long piece is acceptable. Do NOT pre-construct
    aphorisms designed for screenshots; insights should emerge from the
    content.

BLOCKQUOTE RULE:
  - Do NOT use blockquotes (>) for original quotes or pull-quotes.
  - Blockquotes are for citing other people's work.

CTA RULES:
  - Real CTAs include personal context, not just a templated question.
  - "What's your take?" alone = templated and AI-coded.
  - "What's your take? Asking because I'm trying X next month" = human.

If the rules conflict with a learned_overrides for a specific client (their
voice fingerprint shows they consistently use em dashes, for example), the
learned_overrides win for that client. These rules are the default baseline
when no client-specific override exists.
"""
```

### MODIFY: platform_tone_instructions.py

**Find** the import section near the top of the file.

**Add** at the top of the file (after `from __future__`):

```python
from humanize_rules import HUMANIZE_RULES
```

**Find** the `PROMPT_COMPOSITION_RULES` constant.

**Modify** the closing of `PROMPT_COMPOSITION_RULES` to include a reference
to HUMANIZE_RULES. At the end of the existing string (right before the closing
`"""`), add:

```python
ANTI-AI WRITING RULES:
  Apply the HUMANIZE_RULES (injected separately into the prompt) to all
  generated output. These rules take precedence over content_type defaults
  for stylistic choices but are subordinate to learned_overrides for any
  given client.

  When the HUMANIZE_RULES conflict with PLATFORM_TONE rules (e.g., LinkedIn
  saying "use bold for impact" vs HUMANIZE saying "no mid-paragraph bolding"),
  HUMANIZE wins by default unless learned_overrides for the client say
  otherwise.
```

### MODIFY: prompt_builder.py

**Find** the `build_generation_prompt` function signature.

**Modify** to add the `inject_humanize` parameter:

```python
def build_generation_prompt(
    *,
    platform: Platform,
    content_type: ContentType,
    client_context: ClientContext,
    pain_point: str,
    target_sub: str | None = None,
    include_examples: bool = True,
    inject_humanize: bool = True,  # NEW
) -> str:
```

**Find** the line at the very end where the prompt string is composed (the
`return f"""...."""` line).

**Add an import** at the top of the function:

```python
    from humanize_rules import HUMANIZE_RULES
```

**Modify** the final prompt assembly to optionally include HUMANIZE_RULES near
the start (right after PROMPT_COMPOSITION_RULES, before BRAND_BIBLE):

```python
    humanize_section = ""
    if inject_humanize:
        humanize_section = f"\n\n{HUMANIZE_RULES}\n"

    return f"""{PROMPT_COMPOSITION_RULES}{humanize_section}

CLIENT CONTEXT (apply strongly, this is the client-specific intelligence):
{dynamic_context}

...rest of existing prompt...
"""
```

### MODIFY: humanize SKILL.md

**Add** a new section at the top of SKILL.md (right after the frontmatter):

```markdown
## Status: post-process fallback (Phase 2+)

As of Phase 2 of the Helm Adaptive Voice Engine, the rules in this skill
have been duplicated into `humanize_rules.py` and are injected directly
into generation prompts as `HUMANIZE_RULES`. The model is expected to comply
during composition, eliminating the need for a post-process pass.

This skill is now used as:
  1. **Optional post-process fallback** when generated output still slips
     past validators (rare in practice).
  2. **Operator manual cleanup** when reviewing edge-case outputs.
  3. **Reference documentation** for what the rules are and why.

The hard rules (em dashes, banned words, banned constructions) are enforced
preventively via HUMANIZE_RULES in the prompt. The soft rules (varied cadence,
organic flow, voice nuance) remain in this skill for cases where post-process
cleanup is needed.

When invoking this skill on a draft:
  - If the draft was generated with `inject_humanize=True`, expect minimal
    cleanup needed. Most violations indicate prompt fatigue or model failure
    to follow the embedded rules.
  - If the draft was generated with `inject_humanize=False`, run the full
    skill as before.
```

The rest of the SKILL.md content stays unchanged (the rules and patterns are
the same; they just live in two places now: the prompt for prevention, and
the skill for cleanup).

---

## A/B test plan

This is the most important part of F1. Without rigorous A/B test we don't know
if the refactor actually improves quality. Suggested protocol:

### Setup

For 4 weeks, run two parallel pipelines on every generation request:

- **Variant A (control):** generate with `inject_humanize=False`, then run the
  humanize SKILL as post-process. (Current production behavior.)
- **Variant B (treatment):** generate with `inject_humanize=True`, no
  post-process humanize. (New preventive behavior.)

For each request, randomly assign 50/50. Log:

- `total_tokens_used` (input + output)
- `total_latency_ms`
- `text_post_validator failures` count
- `smell_test_score` (from F3 authenticity smell test)
- `user_action`: published_as_is | edited | regenerated | discarded

### Success criteria

To ship preventive permanently, Variant B must show:

1. **Equal or better validator pass rate.** Variant B's text_post_validator
   failures should be <= Variant A's (same or fewer AI tells slipping past).

2. **Equal or better smell test scores.** Mean smell test score for Variant B
   must be >= Variant A's (within 5 points).

3. **Equal or lower user edit rate.** % of posts that user_action=edited or
   regenerated must be <= Variant A's.

4. **Token savings >= 25%.** Variant B should use significantly fewer tokens
   per generation (no second LLM pass for humanize).

5. **Latency savings >= 20%.** Variant B should complete faster.

If any of 1-3 regress vs control, do NOT ship preventive. Investigate which
patterns are slipping past the embedded rules and reinforce them in
HUMANIZE_RULES before re-testing.

If 1-3 are equal or better AND 4-5 are met, ship preventive as default. Keep
post-process humanize available behind a flag for 6 weeks as fallback, then
deprecate.

### Test harness

```python
import random
from prompt_builder import build_generation_prompt

async def generate_with_ab_test(client_context, pain_point, platform, content_type):
    variant = "B" if random.random() < 0.5 else "A"

    if variant == "A":
        prompt = build_generation_prompt(
            client_context=client_context,
            pain_point=pain_point,
            platform=platform,
            content_type=content_type,
            inject_humanize=False,
        )
        raw_output = await call_model(prompt)
        humanized_output = await run_humanize_skill(raw_output)
        final_output = humanized_output
    else:  # B
        prompt = build_generation_prompt(
            client_context=client_context,
            pain_point=pain_point,
            platform=platform,
            content_type=content_type,
            inject_humanize=True,
        )
        raw_output = await call_model(prompt)
        final_output = raw_output  # No post-process

    # Always run validators on final output
    failures = validate_text_post(final_output, platform=platform)
    smell = await smell_test_authenticity(final_output, platform, content_type, client)

    log_ab_test_result(
        variant=variant,
        prompt_tokens=count_tokens(prompt),
        output_tokens=count_tokens(final_output),
        latency_ms=duration_ms,
        validator_failures=len(failures),
        smell_score=smell.score,
    )

    return final_output
```

---

## Test plan (unit-level, before A/B)

### Test 1: HUMANIZE_RULES is non-empty and readable
```python
from humanize_rules import HUMANIZE_RULES
assert len(HUMANIZE_RULES) > 1500
assert "Em dashes" in HUMANIZE_RULES
assert "leverage" in HUMANIZE_RULES
assert "X, not Y" in HUMANIZE_RULES
```

### Test 2: Prompt builder includes HUMANIZE_RULES when inject_humanize=True
```python
prompt = build_generation_prompt(
    platform=Platform.LINKEDIN,
    content_type=ContentType.TEXT,
    client_context=test_ctx,
    pain_point="...",
    inject_humanize=True,
)
assert "ANTI-AI WRITING RULES" in prompt
assert "Em dashes" in prompt
```

### Test 3: Prompt builder excludes HUMANIZE_RULES when inject_humanize=False
```python
prompt = build_generation_prompt(
    ...,
    inject_humanize=False,
)
assert "ANTI-AI WRITING RULES" not in prompt
```

### Test 4: Backward compatibility with existing callers
```python
# Old calls without inject_humanize parameter still work (default True)
prompt = build_generation_prompt(
    platform=Platform.LINKEDIN,
    content_type=ContentType.TEXT,
    client_context=test_ctx,
    pain_point="...",
)
assert "ANTI-AI WRITING RULES" in prompt  # Default True
```

### Test 5: HUMANIZE_RULES doesn't conflict with platform_tone strings
```python
for platform_string in PLATFORM_TONE_INSTRUCTIONS.values():
    # No accidental duplication of rule headers
    assert platform_string.count("ANTI-AI WRITING RULES") == 0
```

### Test 6: Token budget check
```python
prompt = build_generation_prompt(...)
total_tokens = count_tokens(prompt)
# Reasonable upper bound. If we exceed, prompt is bloated.
assert total_tokens < 8000
```

---

## Validation criteria

- [ ] humanize_rules.py compiles and exports HUMANIZE_RULES
- [ ] HUMANIZE_RULES contains all critical sections (punctuation, banned
      constructions, banned words, opening fluff, closing fluff, register,
      structure, blockquote, CTA)
- [ ] platform_tone_instructions.py imports HUMANIZE_RULES
- [ ] PROMPT_COMPOSITION_RULES references HUMANIZE_RULES injection
- [ ] build_generation_prompt accepts inject_humanize=True/False
- [ ] All 6 unit tests pass
- [ ] A/B test infrastructure logs all 5 success criteria metrics
- [ ] Existing tests for prompt_builder.py and ugc_validator.py still pass

## Rollout plan (sequential, do not skip)

1. **Week 1:** Ship code with `inject_humanize=True` as default but feature
   flag `humanize_preventive_enabled=False` globally. Verify nothing breaks
   in production. Manual test 20 generations.

2. **Week 2:** Enable `humanize_preventive_enabled=True` for 5% of traffic via
   A/B random assignment. Log metrics for 7 days.

3. **Week 3-4:** Expand A/B to 50/50 if Week 2 metrics are stable. Collect
   4 weeks of data on all 5 success criteria.

4. **Week 5:** Analyze A/B results. Decide:
   - If all success criteria met: ship preventive as default for all clients
   - If criteria not met: investigate which rules slipped, reinforce HUMANIZE_RULES,
     re-test in another 4 weeks
   - If unclear: extend A/B for 4 more weeks with larger sample

5. **Week 6+ (only after green light):** Make `humanize_preventive_enabled` the
   default. Keep post-process humanize available behind flag for 6 weeks.
   Deprecate post-process after that.

## Out of scope (next phases)

- Per-platform HUMANIZE_RULES variants (e.g., Reddit gets stricter rules,
  LinkedIn slightly looser). Evaluate after baseline is shipped.
- Dynamic rule selection based on detected output quality (if smell test
  score is low, inject extra-strict rules on regen).
- LLM-driven rule extraction (analyze rejected outputs to learn new rules
  that should be added to HUMANIZE_RULES).
- Complete removal of humanize SKILL.md (only after 6 weeks of stable
  preventive behavior with no need for fallback).
- Per-content-type HUMANIZE_RULES (UGC may need different rules than text
  posts; defer until measured).
