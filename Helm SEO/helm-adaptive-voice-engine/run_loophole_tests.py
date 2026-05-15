"""
run_loophole_tests.py
=====================

Executes the 7-test plan from CLAUDE_CODE_PROMPT.md against the freshly
applied loophole-fixes batch.

Tests 1-4 and 6 are deterministic (regex / string membership) and run
locally with no external dependencies.

Test 5 is the LLM smell test happy path — it requires a working Haiku
client. We exercise the IMPORT path + mock the client to verify the
plumbing parses the JSON and returns a SmellTestResult. A real
LLM-against-real-text confirmation is left for a manual run.

Test 7 is end-to-end Reddit regeneration through build_generation_prompt.
We exercise the IMPORT + run validate_text_post on a hand-crafted
authentic Reddit-style post to verify it now passes; the actual LLM
generation step requires a configured anthropic client which lives
outside this Python package.

Usage:
    python run_loophole_tests.py
"""

from __future__ import annotations

import asyncio
import json
import sys
import traceback
from pathlib import Path

# Make the package importable from this script's directory.
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))  # so `platform_tone_instructions` resolves

# Result tracking.
PASS = "PASS"
FAIL = "FAIL"
SKIP = "SKIP"


class TestReport:
    def __init__(self) -> None:
        self.results: list[tuple[str, str, str]] = []  # (id, status, detail)

    def record(self, test_id: str, status: str, detail: str = "") -> None:
        self.results.append((test_id, status, detail))
        marker = {"PASS": "ok", "FAIL": "!!", "SKIP": ".."}[status]
        line = f"[{marker}] {test_id}: {status}"
        if detail:
            line += f"  ({detail})"
        print(line)

    def summary(self) -> int:
        total = len(self.results)
        passed = sum(1 for _, s, _ in self.results if s == PASS)
        failed = sum(1 for _, s, _ in self.results if s == FAIL)
        skipped = sum(1 for _, s, _ in self.results if s == SKIP)
        print()
        print(f"Summary: {passed}/{total} pass, {failed} fail, {skipped} skip")
        return 0 if failed == 0 else 1


def run() -> int:
    report = TestReport()

    # ------------------------------------------------------------------
    # Imports — fail fast if the new files aren't on path or won't parse
    # ------------------------------------------------------------------
    try:
        from text_post_validator import (
            check_x_not_y,
            count_x_not_y_patterns,
            validate_text_post,
        )
    except Exception as e:
        report.record("imports", FAIL, f"text_post_validator import failed: {e}")
        return report.summary()

    try:
        from authenticity_smell_test import (
            SmellTestError,
            SmellTestResult,
            smell_test_authenticity,
        )
    except Exception as e:
        report.record("imports", FAIL, f"authenticity_smell_test import failed: {e}")
        return report.summary()

    try:
        from platform_tone_instructions import PLATFORM_TONE_INSTRUCTIONS
    except Exception as e:
        report.record(
            "imports", FAIL, f"platform_tone_instructions import failed: {e}"
        )
        return report.summary()

    # ------------------------------------------------------------------
    # Test 1 — X-not-Y detector
    # ------------------------------------------------------------------
    test1_text = (
        "The skill that got you to a working product is almost the opposite of "
        "the skill that gets people to use it. It's not a productivity problem. "
        "It's a systems problem. Writing in public about specific decisions, "
        "not generic lessons."
    )
    count = count_x_not_y_patterns(test1_text)
    failures = check_x_not_y(test1_text)
    if count >= 3 and failures:
        report.record("Test 1: X-not-Y detector", PASS, f"count={count}")
    else:
        report.record(
            "Test 1: X-not-Y detector",
            FAIL,
            f"expected count>=3 + failures, got count={count}, failures={failures}",
        )

    # ------------------------------------------------------------------
    # Test 2 — Blockquote detector for Reddit
    # ------------------------------------------------------------------
    test2_text = (
        "> The skill that got you to a working product is the opposite of the skill\n"
        "that gets people to use it.\n\n"
        "That's the part that broke me."
    )
    failures = validate_text_post(test2_text, platform="reddit")
    has_blockquote = any("blockquote" in f.lower() for f in failures)
    if has_blockquote:
        report.record("Test 2: Reddit blockquote detector", PASS, f"{len(failures)} failure(s)")
    else:
        report.record(
            "Test 2: Reddit blockquote detector",
            FAIL,
            f"no blockquote message in failures: {failures}",
        )

    # ------------------------------------------------------------------
    # Test 3 — Symmetric headers detector
    # ------------------------------------------------------------------
    test3_text = (
        "## What I got wrong\n\ncontent...\n\n"
        "## What I learned\n\ncontent...\n\n"
        "## What's still hard\n\ncontent..."
    )
    failures = validate_text_post(test3_text)
    has_symmetric = any("headers" in f.lower() and "what" in f.lower() for f in failures)
    if has_symmetric:
        report.record("Test 3: Symmetric headers detector", PASS, f"{len(failures)} failure(s)")
    else:
        report.record(
            "Test 3: Symmetric headers detector",
            FAIL,
            f"no symmetric-header message: {failures}",
        )

    # ------------------------------------------------------------------
    # Test 4 — Templated CTA detector (two sub-cases)
    # ------------------------------------------------------------------
    # 4a: templated CTA, no follow-up → expect 1+ failure
    test4a = "Some body text here.\n\nSpecifically curious about your experience."
    failures_a = validate_text_post(test4a)
    has_cta = any("templated cta" in f.lower() for f in failures_a)

    # 4b: templated CTA with follow-up → expect 0 failures
    test4b = (
        "Some body text here.\n\n"
        "What worked for you? Honestly asking, I'm trying X next month and want to "
        "not waste the time."
    )
    failures_b = validate_text_post(test4b)

    if has_cta and not failures_b:
        report.record("Test 4: Templated CTA detector", PASS, "both sub-cases passed")
    else:
        report.record(
            "Test 4: Templated CTA detector",
            FAIL,
            f"4a failures={failures_a}; 4b failures={failures_b}",
        )

    # ------------------------------------------------------------------
    # Test 5 — Smell test happy path (requires LLM client)
    # ------------------------------------------------------------------
    # We can't make a real Haiku call from this offline test runner.
    # Verify the plumbing: SmellTestResult parses correctly when given
    # a well-formed JSON payload, and the LLMClient protocol contract
    # is honored by a mock that returns canned JSON for both a "high"
    # score (real human-style post) and a "low" score (AI-shaped post).
    class _MockClient:
        def __init__(self, payload: dict) -> None:
            self._payload = payload

        async def complete_json(self, *, model: str, prompt: str, max_tokens: int = 400) -> str:
            return json.dumps(self._payload)

    async def _run_smell_test_mock() -> tuple[SmellTestResult, SmellTestResult]:
        high = await smell_test_authenticity(
            post_text="(human-style sample)",
            platform="reddit",
            content_type="text",
            client=_MockClient(
                {
                    "score": 82,
                    "verdict": "pass",
                    "primary_issues": [],
                    "what_would_make_it_human": "looks fine",
                }
            ),
        )
        low = await smell_test_authenticity(
            post_text="(AI-shaped sample)",
            platform="reddit",
            content_type="text",
            client=_MockClient(
                {
                    "score": 42,
                    "verdict": "fail",
                    "primary_issues": [
                        "X, not Y construction",
                        "Symmetric headers",
                    ],
                    "what_would_make_it_human": "add a tbh and a parenthetical",
                }
            ),
        )
        return high, low

    try:
        high, low = asyncio.run(_run_smell_test_mock())
        if high.passes and not low.passes and high.score >= 70 and low.score < 70:
            report.record(
                "Test 5: Smell test plumbing",
                PASS,
                f"high={high.score}, low={low.score} (real LLM call not exercised — SKIP for that)",
            )
            report.record(
                "Test 5b: Smell test real LLM call",
                SKIP,
                "requires configured Haiku client; out of band of this runner",
            )
        else:
            report.record(
                "Test 5: Smell test plumbing",
                FAIL,
                f"high.passes={high.passes} low.passes={low.passes} "
                f"high.score={high.score} low.score={low.score}",
            )
    except Exception as e:
        report.record("Test 5: Smell test plumbing", FAIL, f"{e}\n{traceback.format_exc()}")

    # ------------------------------------------------------------------
    # Test 6 — AUTHENTICITY MARKERS sections present in 6 platforms
    # ------------------------------------------------------------------
    platforms_to_check = ["reddit", "x", "threads", "instagram", "linkedin", "facebook"]
    missing = []
    for p in platforms_to_check:
        s = PLATFORM_TONE_INSTRUCTIONS.get(p, "")
        if "AUTHENTICITY MARKERS" not in s:
            missing.append(p)

    # Also check Reddit-specific extras
    reddit = PLATFORM_TONE_INSTRUCTIONS.get("reddit", "")
    reddit_extras_missing = []
    if "OVERRIDES TO CONTENT_TYPE_RULES" not in reddit:
        reddit_extras_missing.append("OVERRIDES TO CONTENT_TYPE_RULES")
    if "Maximum 2 markdown headers" not in reddit:
        reddit_extras_missing.append("Maximum 2 markdown headers rule")

    if not missing and not reddit_extras_missing:
        report.record("Test 6: AUTHENTICITY MARKERS in all 6 platforms", PASS, "all sections present")
    else:
        details = []
        if missing:
            details.append(f"missing AUTHENTICITY MARKERS in: {missing}")
        if reddit_extras_missing:
            details.append(f"reddit missing: {reddit_extras_missing}")
        report.record(
            "Test 6: AUTHENTICITY MARKERS in all 6 platforms",
            FAIL,
            "; ".join(details),
        )

    # ------------------------------------------------------------------
    # Test 7 — End-to-end Reddit regeneration
    # ------------------------------------------------------------------
    # Without a real LLM we can't regenerate. We can exercise the
    # validate_text_post pipeline against a hand-crafted authentic
    # Reddit-style post and confirm it returns zero failures.
    authentic_reddit = (
        "Cut my tool stack from 7 to 1 (give or take) over the last couple months. "
        "Wanted to share what I actually lost.\n\n"
        "tbh the consolidation was easier than I expected on the basics — "
        "scheduling, drafting, analytics all rolled together fine. The painful part "
        "was losing the per-tool muscle memory. Buffer's queue behavior is not "
        "Hootsuite's queue behavior, and the one tool I kept doesn't quite match "
        "either of them.\n\n"
        "anyway, revenue is up around 12%, but I'm honestly not sure how much of "
        "that is the consolidation versus me just having more time to write. "
        "edit: a few people asked which tool — it's the one I'm building, fwiw."
    )
    failures = validate_text_post(authentic_reddit, platform="reddit")
    if not failures:
        report.record(
            "Test 7: Authentic Reddit text passes validators",
            PASS,
            "0 failures",
        )
        report.record(
            "Test 7b: End-to-end LLM regeneration",
            SKIP,
            "requires configured anthropic client + build_generation_prompt wiring",
        )
    else:
        report.record(
            "Test 7: Authentic Reddit text passes validators",
            FAIL,
            f"{len(failures)} failure(s): {failures}",
        )

    return report.summary()


if __name__ == "__main__":
    sys.exit(run())
