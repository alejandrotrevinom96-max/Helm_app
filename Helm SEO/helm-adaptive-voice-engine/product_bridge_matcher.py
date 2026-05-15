"""
product_bridge_matcher.py
=========================

LLM-driven runtime matcher. Per generation, takes the post's pain_point and
the client's available ProductBridges; returns the best semantic match (or
None if nothing fits well enough).

Recommended model: Claude Haiku 4.5. Cost per call: ~$0.001.
Recommended threshold: confidence >= 0.5 to apply the bridge.

Usage:
    from product_bridge_matcher import match_bridge_for_pain

    match = await match_bridge_for_pain(
        pain_point="Distribution harder than building",
        available_bridges=[bridge1, bridge2, bridge3, ...],
        client=haiku_client,
    )

    if match.matched_bridge:
        # Inject match.matched_bridge into the prompt as PRODUCT_RELEVANCE
        ...
    else:
        # No bridge applies. Skip product positioning for this post.
        ...

Version: 1.0 (Phase 2 / Patch 2)
"""

from __future__ import annotations

import json
from typing import Any, Protocol

from pydantic import BaseModel, Field

from client_context import ProductBridge


# ============================================================================
# Match result
# ============================================================================

class BridgeMatch(BaseModel):
    """Result from product_bridge_matcher. If matched_bridge is None, no
    bridge applied to this post (caller should skip product positioning).
    """
    matched_pain: str | None = None
    matched_bridge: str | None = None
    confidence: float = Field(ge=0.0, le=1.0, default=0.0)
    reasoning: str = ""

    @property
    def applies(self) -> bool:
        return self.matched_bridge is not None and self.confidence >= 0.5


# ============================================================================
# Matcher prompt
# ============================================================================

MATCHER_PROMPT = """You are helping a marketing system decide whether to mention a client's product in a generated post. Your job is to match the post's pain point against the client's available pain → product bridges.

POST'S PAIN POINT (what the post is fundamentally about):
{pain_point}

AVAILABLE BRIDGES (the client's pre-configured pain → product mappings):
{bridges_block}

YOUR TASK:

Pick the SINGLE best bridge that semantically matches the post's pain point. Match by meaning, not by literal string. If the post's pain is about "distribution beyond social media" and a bridge addresses "distribution harder than building", that's a match.

If no bridge truly fits the post's pain (semantic distance > 0.5), return null. It is better to skip the bridge than to force one that doesn't fit; a forced bridge produces awkward product mentions.

CONFIDENCE GUIDE:
- 0.9-1.0: bridge directly addresses the same pain
- 0.7-0.9: bridge addresses a closely related pain
- 0.5-0.7: bridge tangentially relates; might fit the post but not the obvious choice
- below 0.5: no real match; return null

OUTPUT SCHEMA (return ONLY this JSON, no commentary):

{{
  "matched_pain": "<exact pain text from a bridge entry, or null>",
  "matched_bridge": "<the bridge text from that entry, or null>",
  "confidence": <0.0 to 1.0>,
  "reasoning": "<one sentence explaining the match decision>"
}}

If matched_pain is null, matched_bridge must also be null and confidence must be < 0.5.

Return only the JSON. No preamble, no markdown fences."""


# ============================================================================
# Client protocol
# ============================================================================

class LLMClient(Protocol):
    async def complete_json(self, *, model: str, prompt: str, max_tokens: int = 400) -> str:
        ...


# ============================================================================
# Public API
# ============================================================================

async def match_bridge_for_pain(
    *,
    pain_point: str,
    available_bridges: list[ProductBridge],
    client: LLMClient,
    model: str = "claude-haiku-4-5",
    confidence_threshold: float = 0.5,
    max_retries: int = 1,
) -> BridgeMatch:
    """Pick the best ProductBridge for a given pain point. LLM-driven.

    Args:
        pain_point:           the post's pain point (from research/insight pipeline)
        available_bridges:    the client's bridges. Pending bridges are excluded
                              automatically.
        client:               LLMClient adapter
        model:                LLM model id (default Haiku for speed/cost)
        confidence_threshold: min confidence to consider a real match (default 0.5)
        max_retries:          retries on JSON parse failure

    Returns:
        BridgeMatch. Check `match.applies` to know if the bridge should be
        injected into the prompt.

    On error: returns an empty BridgeMatch (no application). Errors logged but
    do not block generation.
    """
    # Filter to approved bridges only
    approved = [b for b in available_bridges if not b.pending_review]
    if not approved:
        return BridgeMatch(reasoning="No approved bridges available for this client.")

    bridges_block = "\n".join(
        f"- pain: \"{b.pain}\"\n  bridge: \"{b.bridge}\""
        for b in approved
    )

    prompt = MATCHER_PROMPT.format(
        pain_point=pain_point.strip(),
        bridges_block=bridges_block,
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
            match = BridgeMatch.model_validate(payload)

            # Apply confidence threshold defensively
            if match.confidence < confidence_threshold:
                return BridgeMatch(
                    matched_pain=None,
                    matched_bridge=None,
                    confidence=match.confidence,
                    reasoning=f"Confidence {match.confidence:.2f} below threshold {confidence_threshold}.",
                )

            return match
        except (json.JSONDecodeError, ValueError) as e:
            last_error = e
            continue

    # On repeated failure, return empty match (don't block generation)
    return BridgeMatch(
        reasoning=f"Matcher failed after {max_retries + 1} attempts. Last error: {last_error}"
    )


# ============================================================================
# Prompt formatting helper
# ============================================================================

def format_bridge_for_prompt(match: BridgeMatch) -> str:
    """Format an applied BridgeMatch as a PRODUCT_RELEVANCE section ready to
    inject into the generation prompt.
    """
    if not match.applies:
        return ""

    return f"""
PRODUCT_RELEVANCE (how the product fits the answer to this pain):

The pain point of this post relates to: "{match.matched_pain}"
The client's product fits the answer this way: "{match.matched_bridge}"

INTEGRATION RULES:
- Weave this product relevance into the narrative or closing organically.
- Do NOT use templated disclosures like "I'm building X, link in bio".
- The product's relevance should emerge from the post's argument, not be
  bolted on at the end.
- If the post is short or the relevance feels forced, omit the product mention
  entirely. A missing mention is better than an awkward one.
"""


# ============================================================================
# Helpers
# ============================================================================

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
