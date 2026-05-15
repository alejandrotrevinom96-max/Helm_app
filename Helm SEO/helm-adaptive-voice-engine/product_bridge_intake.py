"""
product_bridge_intake.py
========================

LLM-driven onboarding helper. Generates a draft pain → product bridge map
from minimal client inputs. The operator reviews and approves the result.

Goal: zero friction for the client. They give us 3-5 things, we generate
8-12 bridges, operator approves. Done in under 10 minutes per project.

Recommended model: Claude Haiku 4.5. Cost per call: ~$0.005.

Usage:
    from product_bridge_intake import generate_bridge_drafts

    drafts = await generate_bridge_drafts(
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
    # drafts is a list of ProductBridge with pending_review=True
    # Operator reviews, edits, marks approved=True

Version: 1.0 (Phase 2 / Patch 2)
"""

from __future__ import annotations

import json
from typing import Any, Protocol

from client_context import ProductBridge


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
    """Generate a draft list of ProductBridges for operator review.

    All returned ProductBridges have `pending_review=True`. The operator must
    approve each one (set approved_at + approved_by) before the runtime matcher
    will use it.

    Args:
        product_description: 2-5 sentence description of the client's product
        audience_pains:      list of 3-7 key pain points the audience cares about
        marketing_one_liner: client's marketing tagline / value prop
        client:              LLMClient adapter
        model:               LLM model id
        max_retries:         retries on JSON parse failure

    Returns:
        List of ProductBridge with pending_review=True.

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
    """Convert the LLM's JSON output into a list of ProductBridge with
    pending_review=True.
    """
    raw_bridges = payload.get("bridges", [])
    if not isinstance(raw_bridges, list):
        raise ValueError("Expected 'bridges' to be a list")

    result: list[ProductBridge] = []
    for entry in raw_bridges:
        if not isinstance(entry, dict):
            continue
        pain = entry.get("pain", "").strip()
        bridge = entry.get("bridge", "").strip()
        if not pain or not bridge:
            continue
        try:
            result.append(ProductBridge(
                pain=pain,
                bridge=bridge,
                pending_review=True,
            ))
        except Exception:
            # Skip entries that fail Pydantic validation
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
