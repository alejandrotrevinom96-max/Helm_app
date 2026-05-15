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
