# Helm Adaptive Voice Engine — F4: Variety Injection Mechanism

Phase 1.5. Ejecutar después de E1 (idiosyncrasies) si E1 ya entró a producción,
o en paralelo si los equipos están separados.

---

## Goal

El sistema actual genera la respuesta más segura cada vez. El modelo recibe un
prompt rico y produce el output que mejor satisface ese prompt. Resultado: una
voz consistente pero predecible. Real founders no postean igual cada día. Su
feed tiene rangos: ensayos largos, shitposts de 2 líneas, takes contrarian,
preguntas vulnerables, data drops.

Este sprint introduce variation injection: 10-15% de las generations el sistema
fuerza una variación deliberada de archetype ("shitpost mode", "contrarian
mode", "vulnerable mode") que sobreescribe los content_type rules normales y
produce un output cualitativamente distinto.

## Hypothesis being tested

Si el feed de un cliente tiene 9 posts estructurados y polished, su 10mo post
debería ser estructuralmente diferente para sentirse humano. La variety
injection automatiza esto sin pedirle al cliente que cambie el comportamiento.

## Risks (importante leer)

1. **El cliente puede pensar que la variety es "weird".** Mitigación: variety
   solo se aplica cuando hay ya >= 5 posts en el platform; permite el operator
   apagar variety per-cliente; A/B test antes de habilitar permanente.

2. **Hard de medir success.** Variety por sí mismo no es una métrica. La señal
   real es engagement diferenciado por archetype. Mitigación: tracking de
   archetype + engagement por post para medir post-hoc.

3. **Conflicto con learned_overrides.** Si el cliente prefiere cierta voz
   y variety injection le da otra, el feedback loop puede confundirse.
   Mitigación: variety mode posts no se cuentan para learned_overrides
   updates (marcados con flag `is_variety=True` en signals).

4. **Probabilistic injection causes inconsistency.** El mismo cliente puede
   generar 3 variety posts en 1 semana por azar. Mitigación: cooldown de 3
   posts entre variety injections.

## Scope

**En scope:**
- `PostArchetype` enum (8 archetypes)
- `variety_injector.py`: lógica de selection + injection
- `VARIETY_MODE_INSTRUCTIONS` dict con 1 instrucción concreta por archetype
- ClientContext extension: `recent_post_archetypes` per platform (sliding window 10)
- ClientContext extension: `variety_config` per platform
- Integration en `build_generation_prompt`: detect + inject variety mode
- Telemetry: log de variety injection en audit log

**Out of scope (Phase 2+):**
- Per-archetype performance tracking (necesita analytics layer)
- ML-based archetype selection (necesita post-hoc data)
- User-configurable archetype preferences ("never shitpost on LinkedIn")

---

## Files to CREATE

| Archivo nuevo | Propósito |
|---|---|
| `variety_injector.py` | PostArchetype enum, variety selection logic, mode instructions |

## Files to MODIFY

| Archivo existente | Qué cambiar |
|---|---|
| `client_context.py` | Add PostArchetype enum, ArchetypeUsage model, VarietyConfig model, fields en PlatformSlots |
| `prompt_builder.py` | Detectar si esta generation requiere variety, inyectar VARIETY MODE instruction al final del prompt |

---

## Detailed Changes

### NEW FILE: variety_injector.py

```python
"""
variety_injector.py
====================

Probabilistic variety injection for content generation.

The system tracks which post archetypes a client has used recently, and
periodically (10-15% of generations) forces a deliberate variation: a
"variety mode" instruction that overrides the default content_type rules
and produces a structurally different output.

Default behavior:
  - 15% probability of variety injection per generation
  - Cooldown: 3 normal generations between variety injections
  - Selection: prefer archetypes not used in the last 10 posts
  - First 5 posts on a platform: no variety injection (cold start)

Version: 1.0 (Phase 1.5)
"""

from __future__ import annotations

import random
from datetime import datetime, timezone

from client_context import (
    ArchetypeUsage,
    PlatformSlots,
    PostArchetype,
    VarietyConfig,
)


# ============================================================================
# Variety mode instructions
#
# When the variety injector decides to fire, it picks an archetype and the
# corresponding instruction below gets appended to the generation prompt.
# These instructions OVERRIDE the default content_type rules for that one
# generation.
# ============================================================================

VARIETY_MODE_INSTRUCTIONS: dict[PostArchetype, str] = {

    PostArchetype.SHITPOST: """
==============================================
VARIETY MODE: SHITPOST (override default rules)
==============================================

This generation is a shitpost. Override the default CONTENT_TYPE_RULES and
PLATFORM_TONE structure rules. For this one post only:

  - Maximum 50 words total. Hard cap.
  - No headers, no bullets, no structure.
  - One single observation, not a structured argument.
  - Lowercase first letter is mandatory.
  - Fragmentary sentences only. Acceptable to end mid-thought.
  - No CTA. No question. No call to engage.
  - Acceptable to be slightly absurd or self-deprecating.

The point: shitposts are observations someone has at 2am that they ship
without polishing. Do not polish.

Examples of shape (not content):
  - "the marketing tool that finally made me happy is the one i deleted"
  - "spent 3 hours optimizing my analytics dashboard. zero people read it."
  - "every founder writes the same linkedin post on tuesday and i hate that i'm one of them"
""",

    PostArchetype.CONTRARIAN: """
==============================================
VARIETY MODE: CONTRARIAN (override default rules)
==============================================

This generation takes a contrarian position. Override the default tone
toward warmth/balance. For this one post only:

  - Open with the unpopular take in the first 10 words.
  - Acceptable openers: "hot take:", "unpopular opinion:", "everyone's wrong about X",
    "I'm going to get pushback for this but"
  - Do NOT soften the take in the body. The take is the thesis.
  - Body should defend the take with one specific reason or example, not three.
  - End with a challenge or restatement, not a polite question.
  - Acceptable to acknowledge that some readers will disagree.

The point: contrarian posts move the needle because they take a position.
Do not hedge. Do not "balance perspectives". Take the side and defend it.
""",

    PostArchetype.VULNERABLE: """
==============================================
VARIETY MODE: VULNERABLE (override default rules)
==============================================

This generation is a vulnerable confession. Override the default tone
toward authority/confidence. For this one post only:

  - Open with admission, not a hook. Examples: "I lost $X last month",
    "I've been hiding this for 6 months", "I think I made the wrong call"
  - First-person throughout. Specific failure or doubt, not generic struggle.
  - No "lessons learned" section. Vulnerable posts don't tie up neatly.
  - Acceptable to admit you don't know what to do next.
  - End in uncertainty, not resolution.

The point: vulnerable posts build trust because they break the polish.
Do not turn vulnerability into a teaching moment.
""",

    PostArchetype.DATA_DROP: """
==============================================
VARIETY MODE: DATA_DROP (override default rules)
==============================================

This generation is data-forward. Override the default story-led structure.
For this one post only:

  - Open with a specific number in the first 8 words.
  - Body is 80% numbers/data, 20% interpretation.
  - Use bullet points for the numbers (this is one case where bullets win).
  - Each number needs context (timeframe, sample size, source).
  - Numbers should not be hedged in this mode. Precision is the value.
  - End with the most surprising number, not a CTA.

The point: data drops earn engagement because they reduce the reader's
uncertainty. Lead with the number. Defend it with method.
""",

    PostArchetype.STORY: """
==============================================
VARIETY MODE: STORY (override default rules)
==============================================

This generation is narrative-driven. Override the default insight-first
structure. For this one post only:

  - Open with a specific scene: time, place, action. "It was 2am. Tuesday."
  - Body unfolds chronologically. No flashbacks, no jumps.
  - Use sensory details (what you saw, what you heard, what you felt).
  - One climactic moment, then a brief resolution.
  - The "lesson" emerges from the story, not stated directly.
  - End on the resolution, not on a generalization.

The point: stories engage because they let the reader inhabit a moment.
Show the moment. Trust the reader to extract the meaning.
""",

    PostArchetype.QUESTION: """
==============================================
VARIETY MODE: QUESTION (override default rules)
==============================================

This generation is genuinely asking the audience. Override the default
"I have an insight" framing. For this one post only:

  - Open with the question itself in the first line.
  - Provide 2-4 sentences of context for WHY you're asking.
  - Acceptable to admit you don't know the answer.
  - Do NOT include your own preliminary opinion (that biases the responses).
  - End with the question repeated or a "genuinely asking" marker.

The point: real questions earn replies because the reader can contribute.
Stated opinions disguised as questions get ignored.
""",

    PostArchetype.OBSERVATION: """
==============================================
VARIETY MODE: OBSERVATION (override default rules)
==============================================

This generation is a quick noticing. Override the default fully-developed
argument structure. For this one post only:

  - Maximum 100 words total.
  - Open with the observation itself ("I noticed", "weird thing", "thinking about how").
  - One observation, not three.
  - No CTA. The observation IS the post.
  - Acceptable to leave it slightly open-ended.

The point: observations earn engagement because they invite the reader to
notice the same thing. Do not over-explain.
""",

    PostArchetype.META: """
==============================================
VARIETY MODE: META (override default rules)
==============================================

This generation reflects on the work itself. Override the default subject-
focused framing. For this one post only:

  - Topic is the writer's relationship with the work (writing, marketing,
    building, posting).
  - First-person, present-tense.
  - Acceptable to be slightly philosophical without being grandiose.
  - Do NOT include a tactical takeaway. Meta posts don't teach tactics.
  - End on the tension or the question of the meta-observation.

The point: meta posts work because they signal self-awareness. Do not
turn the meta into a productivity tip.
""",
}


# ============================================================================
# Selection + injection logic
# ============================================================================

MIN_POSTS_BEFORE_VARIETY = 5


def should_inject_variety(
    slots: PlatformSlots,
    config: VarietyConfig,
    rng: random.Random | None = None,
) -> bool:
    """Decide whether this generation should inject variety mode.

    Returns False if:
      - variety is disabled per config
      - client has < MIN_POSTS_BEFORE_VARIETY on this platform (cold start)
      - cooldown is active (recent variety post within last cooldown_after_variety posts)
      - probabilistic roll fails

    The rng arg lets tests inject deterministic randomness.
    """
    if not config.enabled:
        return False
    if slots.post_count < MIN_POSTS_BEFORE_VARIETY:
        return False

    # Cooldown check
    recent = slots.recent_post_archetypes[-config.cooldown_after_variety:]
    if any(usage.was_variety_injected for usage in recent):
        return False

    rng = rng or random
    return rng.random() < config.injection_probability


def select_variety_archetype(
    slots: PlatformSlots,
    config: VarietyConfig,
    rng: random.Random | None = None,
) -> PostArchetype:
    """Pick which variety archetype to inject.

    Strategy: prefer archetypes NOT used in the recent sliding window. If all
    archetypes have been used, pick the least recently used one.
    """
    rng = rng or random
    recent_window = slots.recent_post_archetypes[-config.sliding_window_size:]
    recent_archetypes = {usage.archetype for usage in recent_window}

    all_archetypes = set(PostArchetype)
    available = all_archetypes - recent_archetypes

    if available:
        return rng.choice(sorted(available, key=lambda a: a.value))

    # All archetypes used recently. Pick least recently used.
    last_used: dict[PostArchetype, datetime] = {}
    for usage in recent_window:
        last_used[usage.archetype] = usage.used_at

    return min(last_used.keys(), key=lambda a: last_used[a])


def get_variety_instruction(archetype: PostArchetype) -> str:
    """Return the prompt-injection text for the given archetype."""
    return VARIETY_MODE_INSTRUCTIONS.get(archetype, "")


def record_archetype_usage(
    slots: PlatformSlots,
    archetype: PostArchetype,
    was_variety_injected: bool,
    config: VarietyConfig,
) -> None:
    """Append a new ArchetypeUsage to the sliding window. Mutates in place."""
    slots.recent_post_archetypes.append(
        ArchetypeUsage(
            archetype=archetype,
            used_at=datetime.now(timezone.utc),
            was_variety_injected=was_variety_injected,
        )
    )
    # Trim to window size
    max_window = max(config.sliding_window_size * 2, 20)
    if len(slots.recent_post_archetypes) > max_window:
        slots.recent_post_archetypes = slots.recent_post_archetypes[-max_window:]
```

### MODIFY: client_context.py

**Add** these to the enums section:

```python
class PostArchetype(str, Enum):
    """High-level post type that the variety injector tracks and rotates.

    Most posts are ESSAY (the structured default). Variety injection forces
    a different archetype to break the predictable pattern in a feed.
    """
    ESSAY = "essay"           # Default: structured, headed, with insights
    SHITPOST = "shitpost"     # Very short, casual, fragmentary
    CONTRARIAN = "contrarian" # Unpopular take
    OBSERVATION = "observation"  # Quick noticing, < 100 words
    VULNERABLE = "vulnerable" # Personal admission, no resolution
    DATA_DROP = "data_drop"   # Number/stat heavy
    STORY = "story"           # Narrative chronological
    QUESTION = "question"     # Genuinely asking
    META = "meta"             # Reflecting on the work itself
```

**Add** these models in the building blocks section:

```python
class ArchetypeUsage(BaseModel):
    """Record of one post's archetype, tracked in a per-platform sliding window
    for variety injection logic.
    """
    model_config = ConfigDict(frozen=True)

    archetype: PostArchetype
    used_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    was_variety_injected: bool = Field(
        default=False,
        description="True if this archetype was selected by the variety injector "
                    "rather than emerging organically from the generation. Used "
                    "for cooldown logic and for excluding from learned_overrides "
                    "feedback signals."
    )


class VarietyConfig(BaseModel):
    """Per-platform configuration for variety injection."""
    model_config = ConfigDict(extra="forbid")

    enabled: bool = True
    injection_probability: float = Field(default=0.15, ge=0.0, le=0.5,
                                         description="Probability per generation. "
                                                     "0.15 = 15% of generations get variety.")
    sliding_window_size: int = Field(default=10, ge=3, le=30,
                                     description="How many recent posts to consider "
                                                 "when selecting the next archetype.")
    cooldown_after_variety: int = Field(default=3, ge=1, le=10,
                                        description="Number of normal generations "
                                                    "required between variety injections.")
```

**In** `PlatformSlots`, add these fields (after `voice_idiosyncrasies` from E1):

```python
    recent_post_archetypes: list[ArchetypeUsage] = Field(
        default_factory=list,
        description="Sliding window of last N post archetypes for this platform. "
                    "Used by variety_injector to track diversity and select next "
                    "variety mode."
    )
    variety_config: VarietyConfig = Field(
        default_factory=VarietyConfig,
        description="Per-platform variety injection configuration. Operator can "
                    "disable variety per platform if a client doesn't want it."
    )
```

### MODIFY: prompt_builder.py

**Find** the `build_generation_prompt` function.

**At the top of the function** (before any prompt assembly), add:

```python
    from variety_injector import (
        get_variety_instruction,
        record_archetype_usage,
        select_variety_archetype,
        should_inject_variety,
    )
    from client_context import PostArchetype

    slots = client_context.get_platform_slots(platform)
    variety_archetype: PostArchetype | None = None
    variety_instruction = ""

    if should_inject_variety(slots, slots.variety_config):
        variety_archetype = select_variety_archetype(slots, slots.variety_config)
        variety_instruction = get_variety_instruction(variety_archetype)
```

**Find** the line where the prompt is returned (something like `return f"""...prompt..."""`):

**Modify** to append the variety instruction at the end:

```python
    base_prompt = f"""...existing prompt..."""

    if variety_instruction:
        base_prompt = f"{base_prompt}\n\n{variety_instruction}"

    return base_prompt
```

Note: `record_archetype_usage` should be called by the caller AFTER the post is
actually published (not at prompt build time), because we want to track what
was actually shipped, not what was generated.

---

## Test plan

### Test 1: Cold start no variety
```python
slots = PlatformSlots(post_count=3)
config = VarietyConfig(enabled=True, injection_probability=1.0)  # Force 100%
assert should_inject_variety(slots, config) is False  # Cold start blocks
```

### Test 2: Variety enabled with sufficient posts
```python
slots = PlatformSlots(post_count=10)
config = VarietyConfig(enabled=True, injection_probability=1.0)
rng = random.Random(42)  # Deterministic
assert should_inject_variety(slots, config, rng=rng) is True
```

### Test 3: Cooldown blocks variety
```python
slots = PlatformSlots(post_count=10)
slots.recent_post_archetypes = [
    ArchetypeUsage(archetype=PostArchetype.SHITPOST, was_variety_injected=True),
    ArchetypeUsage(archetype=PostArchetype.ESSAY, was_variety_injected=False),
    ArchetypeUsage(archetype=PostArchetype.ESSAY, was_variety_injected=False),
]
config = VarietyConfig(enabled=True, injection_probability=1.0, cooldown_after_variety=3)
assert should_inject_variety(slots, config) is False  # Recent variety blocks
```

### Test 4: Selection prefers unused archetypes
```python
slots = PlatformSlots(post_count=10)
slots.recent_post_archetypes = [
    ArchetypeUsage(archetype=PostArchetype.SHITPOST, was_variety_injected=False),
    ArchetypeUsage(archetype=PostArchetype.CONTRARIAN, was_variety_injected=False),
]
config = VarietyConfig(sliding_window_size=10)
selected = select_variety_archetype(slots, config, rng=random.Random(42))
assert selected not in (PostArchetype.SHITPOST, PostArchetype.CONTRARIAN)
```

### Test 5: All instructions exist
```python
for archetype in PostArchetype:
    instruction = get_variety_instruction(archetype)
    assert len(instruction) > 100
    assert "VARIETY MODE" in instruction
```

### Test 6: Integration end-to-end
```python
ctx = ClientContext(...)  # set up with > 5 posts
slots = ctx.get_platform_slots(Platform.LINKEDIN)
slots.variety_config = VarietyConfig(injection_probability=1.0)

# Force variety to fire
prompt = build_generation_prompt(
    platform=Platform.LINKEDIN,
    content_type=ContentType.TEXT,
    client_context=ctx,
    pain_point="...",
)
# Verify VARIETY MODE appears in the prompt
assert "VARIETY MODE" in prompt
```

### Test 7: Telemetry
After integration, verify that variety injections appear in audit_log when the
generation completes successfully. (This requires the calling code to call
`record_archetype_usage` after publish.)

---

## Validation criteria

- [ ] variety_injector.py compiles without errors
- [ ] All 8 PostArchetype values have a corresponding VARIETY_MODE_INSTRUCTIONS entry
- [ ] Cold start (post_count < 5) never triggers variety
- [ ] Cooldown logic blocks consecutive variety injections
- [ ] Selection prefers unused archetypes when available
- [ ] Selection falls back to least-recently-used when all used
- [ ] build_generation_prompt appends VARIETY MODE block when injected
- [ ] Existing tests for prompt_builder.py still pass (variety injection at 0% by default in test fixtures)

## Rollout plan

1. Ship with `injection_probability=0.0` (variety completely disabled by default).
2. Manually enable variety_config.injection_probability=0.15 for 3-5 test
   clients who agree to be in pilot.
3. After 4 weeks, review:
   - Did the variety posts get more or less engagement than baseline?
   - Did the test clients ask "what is this weird post"?
   - Did the variety posts produce useful audit signals?
4. If positive, enable variety with default 0.10 (lower than initial pilot)
   for all new clients. Existing clients keep current setting unless they opt in.
5. Calibrate per-archetype probability over time (some archetypes might
   underperform; weight selection toward the ones that work).

## Out of scope (next phases)

- Per-archetype performance tracking (engagement vs baseline)
- Adaptive selection (weight archetypes by their measured performance)
- User-configurable archetype preferences ("never shitpost on LinkedIn")
- Multi-archetype combinations (e.g., "vulnerable shitpost")
- Cross-platform archetype coordination (don't shitpost on TikTok same day
  you shitpost on X)
