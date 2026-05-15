"""
product_bridge_intake.py
========================

LLM-driven onboarding helper. Generates a pain → product bridge map from
minimal client inputs and auto-approves every bridge that passes a
deterministic quality gate. The client never sees an approval step —
the LLM is the generator, the gate is the approver, zero human-in-the-loop.

Goal: zero friction for the client AND zero per-project operator time.
They give us 3-5 things, the system produces 6-12 production-ready
bridges, no approval UI needed.

Three layers of defense against bad bridges:
  1. The intake prompt itself (strict on buzzwords, length, concreteness).
  2. The deterministic _passes_quality_gate() (banned buzzwords from
     HUMANIZE_RULES, no pain↔bridge duplicates).
  3. The runtime matcher's confidence threshold (>=0.5) plus the F3
     authenticity smell test on the final generated post.

Recommended model: Claude Haiku 4.5. Cost per call: ~$0.005.

Usage:
    from product_bridge_intake import generate_bridge_drafts

    bridges = await generate_bridge_drafts(
        product_description="Helm is a marketing OS for solo founders...",
        audience_pains=[
            "Distribution harder than product",
            "Context switching across marketing tools",
            "AI-generated content sounds generic",
            "Inconsistent shipping cadence",
            "Brand voice drifts in AI tools",
        ],
        marketing_one_liner="One workspace for research, drafting, scheduling",
        client=haiku_client,
    )
    # `bridges` are auto-approved (pending_review=False,
    # approved_by="system:llm_intake_v1"). Drop straight into
    # BrandBible.pain_to_product_bridges and the runtime matcher will
    # use them on the next generation.
    #
    # The pending_review flag is retained on the model as a kill-switch:
    # an operator can flip a specific bridge to pending_review=True via
    # SQL / admin tool to disable it without a redeploy. The default for
    # the field stays True so any bridge constructed without going
    # through this intake (and its gate) is treated as un-vetted.

Version: 1.1 (Patch 2.1: auto-approval + quality gate)
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any, Protocol

from client_context import ProductBridge


# ============================================================================
# Deterministic quality gate (Patch 2.1)
#
# Replaces the operator-review UX with code. The client never sees an
# approval step; the LLM intake generates, this gate drops anything that
# would have failed an operator review. Three layers of defense against
# bad bridges total: (1) the strict intake prompt itself, (2) this gate,
# (3) the runtime matcher's confidence threshold + the F3 smell test on
# the final post.
#
# What we check programmatically:
#   - No banned buzzwords from HUMANIZE_RULES (single source of truth)
#   - Bridge doesn't repeat the pain verbatim (lazy LLM output)
#
# What we deliberately do NOT check (handled by Pydantic min/max_length
# on ProductBridge):
#   - Length constraints
# ============================================================================

# Mirrors HUMANIZE_RULES "Words banned" section. Whole-word match so e.g.
# "comprehensiveness" doesn't false-positive on "comprehensive". Phrases
# with spaces ("game changer", "dive into") still match because \b sits
# at the spaces.
BANNED_BUZZWORDS: tuple[str, ...] = (
    "leverage", "harness", "unlock", "empower", "elevate", "streamline",
    "seamlessly", "effortlessly", "intuitively", "robust", "comprehensive",
    "holistic", "cutting-edge", "state-of-the-art", "game-changer",
    "game changer", "dive into", "delve into",
)

_BANNED_BUZZWORD_RE = re.compile(
    r"\b(" + "|".join(re.escape(w) for w in BANNED_BUZZWORDS) + r")\b",
    re.IGNORECASE,
)


def _passes_quality_gate(pain: str, bridge: str) -> tuple[bool, str]:
    """Run the deterministic quality gate on one LLM-generated bridge.

    Returns (passed, reason). Bridges that fail are dropped silently by
    _parse_bridges — they never reach the client or the runtime matcher.
    The intake LLM is the generator; this function is the approver
    (replacing what an operator would do mentally during review).
    """
    if _BANNED_BUZZWORD_RE.search(bridge):
        return False, "contains banned buzzword"
    if bridge.strip().lower() == pain.strip().lower():
        return False, "bridge repeats pain verbatim"
    return True, "ok"


# Marker stamped onto auto-approved bridges so audit logs / future
# migrations can tell "approved by LLM intake gate" apart from "approved
# by a human operator". v1 leaves room to revise the gate criteria
# without rewriting historical rows.
AUTO_APPROVER_ID = "system:llm_intake_v1"


# ============================================================================
# Intake prompt
# ============================================================================

INTAKE_PROMPT = """You are helping onboard a new client/project to Helm. Your job is to generate a pain → product bridge map that will be used to position the product naturally in marketing posts the client publishes.

INPUTS:

PRODUCT DESCRIPTION:
{product_description}

MARKETING ONE-LINER:
{marketing_one_liner}

KEY AUDIENCE PAIN POINTS (the topics this client's content will address):
{pain_points_block}

YOUR TASK:

For each audience pain point, generate a 1-2 sentence "bridge" that explains how the product fits into the answer. Plus generate 2-4 ADDITIONAL bridges for adjacent pains the client likely also addresses (use the product description and marketing one-liner to infer).

Each bridge MUST:
- Be specific (not generic positioning like "X helps founders win")
- Connect the pain to a concrete product capability
- Sound natural when woven into a marketing post (not corporate)
- Avoid: "leverage", "seamlessly", "unlock", "empower", "harness", "robust", "comprehensive", "holistic", "game-changer"
- Be written in present tense, third person about the product
- Be 20-200 chars long

EXAMPLES OF GOOD BRIDGES (study the shape, do not copy content):

Pain: "Distribution harder than building the product"
Bridge: "Helm handles the social media layer (X, LinkedIn) so the founder can spend time on the higher-ROI distribution channels: podcasts, communities, partnerships."

Pain: "Generic AI content that sounds like ChatGPT"
Bridge: "Helm learns the founder's voice fingerprint from past posts and applies it to every draft, so output sounds like one specific person, not a model averaged across millions."

EXAMPLES OF BAD BRIDGES (avoid this shape):

Pain: "Distribution is hard"
Bad bridge: "Helm leverages AI to streamline your marketing workflow seamlessly." (Generic, full of buzzwords, says nothing concrete.)

Pain: "AI content sounds generic"
Bad bridge: "Helm provides a comprehensive solution that empowers founders." (No concrete connection to the pain.)

OUTPUT SCHEMA (return ONLY this JSON, no commentary):

{{
  "bridges": [
    {{
      "pain": "<exact pain wording, copy from input or rephrase slightly>",
      "bridge": "<1-2 sentence bridge connecting product to pain>"
    }},
    ...
  ]
}}

Generate 8-12 bridges total. Cover all the input pains plus 2-4 inferred adjacent pains.

Return only the JSON. No preamble, no markdown fences, no thinking."""


# ============================================================================
# Client protocol
# ============================================================================

class LLMClient(Protocol):
    async def complete_json(self, *, model: str, prompt: str, max_tokens: int = 2000) -> str:
        ...


# ============================================================================
# Public API
# ============================================================================

async def generate_bridge_drafts(
    *,
    product_description: str,
    audience_pains: list[str],
    marketing_one_liner: str,
    client: LLMClient,
    model: str = "claude-haiku-4-5",
    max_retries: int = 2,
) -> list[ProductBridge]:
    """Generate auto-approved ProductBridges for a project.

    The LLM produces 8-12 candidates; the deterministic quality gate
    (_passes_quality_gate) drops any that contain banned buzzwords or
    repeat the pain verbatim. Survivors come back as approved:
    pending_review=False, approved_at=now, approved_by="system:llm_intake_v1".

    The caller drops the returned list straight into
    BrandBible.pain_to_product_bridges; the runtime matcher will use
    them on the next generation with no further approval step.

    Args:
        product_description: 2-5 sentence description of the client's product
        audience_pains:      list of 3-7 key pain points the audience cares about
        marketing_one_liner: client's marketing tagline / value prop
        client:              LLMClient adapter
        model:               LLM model id
        max_retries:         retries on JSON parse failure

    Returns:
        List of auto-approved ProductBridge. Length depends on how many
        candidates the LLM produces AND how many survive the gate (could
        be 0 if every candidate had a buzzword, though the intake prompt
        explicitly forbids them).

    Raises:
        BridgeIntakeError on repeated parse failure.
    """
    if not audience_pains:
        raise ValueError("audience_pains cannot be empty")
    if len(audience_pains) > 10:
        # Cap to keep prompt size reasonable
        audience_pains = audience_pains[:10]

    pain_points_block = "\n".join(f"- {p.strip()}" for p in audience_pains)

    prompt = INTAKE_PROMPT.format(
        product_description=product_description.strip(),
        marketing_one_liner=marketing_one_liner.strip(),
        pain_points_block=pain_points_block,
    )

    last_error: Exception | None = None

    for attempt in range(max_retries + 1):
        try:
            raw = await client.complete_json(
                model=model,
                prompt=prompt,
                max_tokens=2000,
            )
            payload = _extract_json_object(raw)
            return _parse_bridges(payload)
        except (json.JSONDecodeError, ValueError, KeyError) as e:
            last_error = e
            continue

    raise BridgeIntakeError(
        f"Failed to generate bridge drafts after {max_retries + 1} attempts. "
        f"Last error: {last_error}"
    )


# ============================================================================
# Helpers
# ============================================================================

def _parse_bridges(payload: dict[str, Any]) -> list[ProductBridge]:
    """Convert the LLM's JSON output into auto-approved ProductBridges.

    Each candidate is run through _passes_quality_gate(); candidates that
    fail are dropped silently (they never reach the caller, the DB, or
    the runtime matcher). Candidates that pass come back with
    pending_review=False + approved_at=now + approved_by="system:llm_intake_v1".
    """
    raw_bridges = payload.get("bridges", [])
    if not isinstance(raw_bridges, list):
        raise ValueError("Expected 'bridges' to be a list")

    now = datetime.now(timezone.utc)
    result: list[ProductBridge] = []
    for entry in raw_bridges:
        if not isinstance(entry, dict):
            continue
        pain = entry.get("pain", "").strip()
        bridge = entry.get("bridge", "").strip()
        if not pain or not bridge:
            continue
        passed, _reason = _passes_quality_gate(pain, bridge)
        if not passed:
            # Silently drop. We deliberately do not surface failures —
            # the client never knew about this candidate; the LLM will
            # have produced 8-12 so losing 1-2 to the gate is fine.
            continue
        try:
            result.append(ProductBridge(
                pain=pain,
                bridge=bridge,
                pending_review=False,
                approved_at=now,
                approved_by=AUTO_APPROVER_ID,
            ))
        except Exception:
            # Pydantic validation failure (e.g., length out of range).
            # Drop and move on.
            continue

    return result


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
        raise json.JSONDecodeError("No JSON object found", text, 0)
    return json.loads(text[start : end + 1])


class BridgeIntakeError(Exception):
    """Raised when bridge intake fails after all retries."""
