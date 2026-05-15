"""
run_patch1_tests.py
===================

Executes the test plan from CLAUDE_CODE_PROMPT_PATCH_1.md (6 patch tests)
plus a regression pass on the original CLAUDE_CODE_PROMPT.md tests (Test 7
in the patch's plan asks for this).

Usage:
    python run_patch1_tests.py
"""

from __future__ import annotations

import sys
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))

PASS = "PASS"
FAIL = "FAIL"
SKIP = "SKIP"


class TestReport:
    def __init__(self) -> None:
        self.results: list[tuple[str, str, str]] = []

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

    try:
        from text_post_validator import (
            AUTHENTICITY_MARKERS_BY_PLATFORM,
            MAX_HEADERS_BY_PLATFORM,
            TEMPLATED_CTAS,
            check_authenticity_markers,
            check_cta_specifically_opener,
            check_max_headers,
            check_no_blockquote,
            check_symmetric_headers,
            check_templated_cta,
            check_tricolon,
            check_x_not_y,
            count_x_not_y_patterns,
            validate_text_post,
        )
    except Exception as e:
        report.record(
            "imports",
            FAIL,
            f"text_post_validator import failed: {e}\n{traceback.format_exc()}",
        )
        return report.summary()

    # ==================================================================
    # PATCH 1 TESTS
    # ==================================================================

    # Patch Test 1 — Comma-separated chiastic flip
    try:
        text = (
            "If your distribution plan requires you to become a different "
            "person to execute it, it's not a plan, it's a costume."
        )
        failures = check_x_not_y(text)
        if len(failures) >= 1:
            report.record(
                "Patch 1 Test 1: Comma chiastic flip",
                PASS,
                f"{len(failures)} failure(s)",
            )
        else:
            report.record(
                "Patch 1 Test 1: Comma chiastic flip",
                FAIL,
                "no failures returned",
            )
    except Exception as e:
        report.record("Patch 1 Test 1: Comma chiastic flip", FAIL, str(e))

    # Patch Test 2 — Tricolon detection (4 sub-cases)
    try:
        sub_results: list[tuple[str, bool]] = []
        # Same first word
        text = "Not a content calendar. Not a funnel diagram. Not a buyer persona."
        failures = check_tricolon(text)
        sub_results.append((
            "same-first-word",
            len(failures) >= 1 and "tricolon" in failures[0].lower(),
        ))
        # Short parallel
        text = "Build. Ship. Scale."
        failures = check_tricolon(text)
        sub_results.append(("short-parallel", len(failures) >= 1))
        # Single sentence (no tricolon)
        text = "Build it."
        failures = check_tricolon(text)
        sub_results.append(("single-sentence", failures == []))
        # 2 parallel sentences (not tricolon)
        text = "Build it. Ship it."
        failures = check_tricolon(text)
        sub_results.append(("two-sentences", failures == []))

        failed_sub = [name for name, ok in sub_results if not ok]
        if not failed_sub:
            report.record("Patch 1 Test 2: Tricolon detection", PASS, "4/4 sub-cases")
        else:
            report.record(
                "Patch 1 Test 2: Tricolon detection",
                FAIL,
                f"failed sub-cases: {failed_sub}",
            )
    except Exception as e:
        report.record("Patch 1 Test 2: Tricolon detection", FAIL, str(e))

    # Patch Test 3 — Authenticity markers required (3 sub-cases)
    try:
        sub_results = []
        # Reddit post with no markers
        text = (
            "Spent 14 months building. Distribution is harder than I thought. "
            "Numbers below."
        )
        failures = check_authenticity_markers(text, platform="reddit")
        sub_results.append((
            "reddit-no-markers",
            len(failures) >= 1 and "tbh" in failures[0],
        ))
        # Reddit post with marker
        text = (
            "Spent 14 months building. Distribution is harder than I thought tbh."
        )
        failures = check_authenticity_markers(text, platform="reddit")
        sub_results.append(("reddit-with-marker", failures == []))
        # LinkedIn (no requirement)
        text = "Some clean LinkedIn copy without tbh."
        failures = check_authenticity_markers(text, platform="linkedin")
        sub_results.append(("linkedin-no-requirement", failures == []))

        failed_sub = [name for name, ok in sub_results if not ok]
        if not failed_sub:
            report.record(
                "Patch 1 Test 3: Authenticity markers", PASS, "3/3 sub-cases"
            )
        else:
            report.record(
                "Patch 1 Test 3: Authenticity markers",
                FAIL,
                f"failed sub-cases: {failed_sub}",
            )
    except Exception as e:
        report.record("Patch 1 Test 3: Authenticity markers", FAIL, str(e))

    # Patch Test 4 — Max headers per platform (4 sub-cases)
    try:
        sub_results = []
        text = (
            "\n## What flopped\ncontent\n## What worked\ncontent\n"
            "## The lesson\ncontent\n"
        )
        # Reddit caps at 2; 3 headers should fail
        failures = check_max_headers(text, platform="reddit")
        sub_results.append(("reddit-3-headers", len(failures) >= 1))
        # LinkedIn caps at 2; also fails
        failures = check_max_headers(text, platform="linkedin")
        sub_results.append(("linkedin-3-headers", len(failures) >= 1))
        # No platform → default 5, passes
        failures = check_max_headers(text)
        sub_results.append(("no-platform-default", failures == []))
        # Override to 10, passes
        failures = check_max_headers(text, max_override=10)
        sub_results.append(("override-10", failures == []))

        failed_sub = [name for name, ok in sub_results if not ok]
        if not failed_sub:
            report.record("Patch 1 Test 4: Max headers", PASS, "4/4 sub-cases")
        else:
            report.record(
                "Patch 1 Test 4: Max headers",
                FAIL,
                f"failed sub-cases: {failed_sub}",
            )
    except Exception as e:
        report.record("Patch 1 Test 4: Max headers", FAIL, str(e))

    # Patch Test 5 — Specifically opener (3 sub-cases)
    try:
        sub_results = []
        # Bad: Specifically: as transitional
        text = "What worked for you? Specifically: did anyone crack a channel?"
        failures = check_cta_specifically_opener(text)
        sub_results.append(("bad-colon", len(failures) >= 1))
        # Bad: specifically curious
        text = (
            "Curious about distribution. Specifically curious about cold DMs."
        )
        failures = check_cta_specifically_opener(text)
        sub_results.append(("bad-curious", len(failures) >= 1))
        # Good: direct question
        text = "What worked for you? Did anyone crack a channel?"
        failures = check_cta_specifically_opener(text)
        sub_results.append(("good-direct", failures == []))

        failed_sub = [name for name, ok in sub_results if not ok]
        if not failed_sub:
            report.record(
                "Patch 1 Test 5: Specifically opener", PASS, "3/3 sub-cases"
            )
        else:
            report.record(
                "Patch 1 Test 5: Specifically opener",
                FAIL,
                f"failed sub-cases: {failed_sub}",
            )
    except Exception as e:
        report.record("Patch 1 Test 5: Specifically opener", FAIL, str(e))

    # Patch Test 6 — End-to-end on a synthesized "failed Reddit post" that
    # exhibits all 5 patterns the patch targets. The original raw post isn't
    # in the repo; we reconstruct one with the exact pathology.
    try:
        synthetic_failed_reddit = (
            "## What I expected\n\n"
            "I'd ship and customers would come. If your distribution plan "
            "requires you to become a different person to execute it, "
            "it's not a plan, it's a costume.\n\n"
            "## What actually happened\n\n"
            "Not a content calendar. Not a funnel diagram. Not a buyer "
            "persona. Just me, writing.\n\n"
            "## The numbers\n\n"
            "14 months. 0 outbound. 142 paid.\n\n"
            "## What I'm trying next\n\n"
            "Cold DMs to operators in adjacent niches. "
            "What worked for you? Specifically: did anyone crack a channel?"
        )
        failures = validate_text_post(synthetic_failed_reddit, platform="reddit")
        # Categorise failures by which check produced them.
        categories: dict[str, int] = {
            "x_not_y": 0,
            "tricolon": 0,
            "authenticity": 0,
            "max_headers": 0,
            "specifically": 0,
        }
        for f in failures:
            low = f.lower()
            if "'x, not y'" in low or "constructions" in low:
                categories["x_not_y"] += 1
            if "tricolon" in low:
                categories["tricolon"] += 1
            if "authenticity markers" in low:
                categories["authenticity"] += 1
            if "markdown headers" in low:
                categories["max_headers"] += 1
            if "specifically" in low:
                categories["specifically"] += 1

        missing = [k for k, v in categories.items() if v == 0]
        if not missing and len(failures) >= 5:
            report.record(
                "Patch 1 Test 6: End-to-end failed Reddit post",
                PASS,
                f"{len(failures)} failures across all 5 categories",
            )
        else:
            report.record(
                "Patch 1 Test 6: End-to-end failed Reddit post",
                FAIL,
                f"missing categories: {missing}; total failures={len(failures)}; "
                f"categories={categories}",
            )
    except Exception as e:
        report.record(
            "Patch 1 Test 6: End-to-end failed Reddit post",
            FAIL,
            f"{e}\n{traceback.format_exc()}",
        )

    # ==================================================================
    # REGRESSION — original CLAUDE_CODE_PROMPT.md test plan
    # ==================================================================

    # Test 1 — X-not-Y detector (period chiastic)
    try:
        t1 = (
            "The skill that got you to a working product is almost the opposite "
            "of the skill that gets people to use it. It's not a productivity "
            "problem. It's a systems problem. Writing in public about specific "
            "decisions, not generic lessons."
        )
        n = count_x_not_y_patterns(t1)
        f = check_x_not_y(t1)
        if n >= 3 and f:
            report.record(
                "Regression 1: X-not-Y (period)", PASS, f"count={n}"
            )
        else:
            report.record(
                "Regression 1: X-not-Y (period)",
                FAIL,
                f"count={n} failures={f}",
            )
    except Exception as e:
        report.record("Regression 1: X-not-Y (period)", FAIL, str(e))

    # Test 2 — Reddit blockquote detector
    try:
        t2 = (
            "> The skill that got you to a working product is the opposite of the "
            "skill that gets people to use it.\n\nThat's the part that broke me."
        )
        # Use validate_text_post but DISABLE the new authenticity_markers and
        # tricolon checks to isolate the blockquote signal — those would also
        # fire on this text.
        f = validate_text_post(
            t2,
            platform="reddit",
            enforce_authenticity_markers=False,
            enforce_no_tricolon=False,
        )
        if any("blockquote" in m.lower() for m in f):
            report.record(
                "Regression 2: Reddit blockquote", PASS, f"{len(f)} failure(s)"
            )
        else:
            report.record(
                "Regression 2: Reddit blockquote",
                FAIL,
                f"no blockquote msg in {f}",
            )
    except Exception as e:
        report.record("Regression 2: Reddit blockquote", FAIL, str(e))

    # Test 6 — AUTHENTICITY MARKERS sections present in all 6 platforms
    try:
        from platform_tone_instructions import PLATFORM_TONE_INSTRUCTIONS
        platforms = ["reddit", "x", "threads", "instagram", "linkedin", "facebook"]
        missing = [
            p for p in platforms
            if "AUTHENTICITY MARKERS" not in PLATFORM_TONE_INSTRUCTIONS.get(p, "")
        ]
        reddit_extras_missing = []
        reddit = PLATFORM_TONE_INSTRUCTIONS.get("reddit", "")
        if "OVERRIDES TO CONTENT_TYPE_RULES" not in reddit:
            reddit_extras_missing.append("OVERRIDES TO CONTENT_TYPE_RULES")
        if "Maximum 2 markdown headers" not in reddit:
            reddit_extras_missing.append("Maximum 2 markdown headers rule")
        if not missing and not reddit_extras_missing:
            report.record(
                "Regression 6: AUTHENTICITY MARKERS in 6 platforms", PASS
            )
        else:
            report.record(
                "Regression 6: AUTHENTICITY MARKERS in 6 platforms",
                FAIL,
                f"missing={missing}; reddit_extras_missing={reddit_extras_missing}",
            )
    except Exception as e:
        report.record(
            "Regression 6: AUTHENTICITY MARKERS in 6 platforms", FAIL, str(e)
        )

    # Test 7 — Authentic Reddit-style text passes the full validator
    # (the original Test 7 from CLAUDE_CODE_PROMPT.md used hand-crafted text
    # with "tbh", "fwiw", parenthetical asides, etc.)
    try:
        authentic_reddit = (
            "Cut my tool stack from 7 to 1 (give or take) over the last couple "
            "months. Wanted to share what I actually lost.\n\n"
            "tbh the consolidation was easier than I expected on the basics — "
            "scheduling, drafting, analytics all rolled together fine. The painful "
            "part was losing the per-tool muscle memory. Buffer's queue behavior "
            "is not Hootsuite's queue behavior, and the one tool I kept doesn't "
            "quite match either of them.\n\n"
            "anyway, revenue is up around 12%, but I'm honestly not sure how much "
            "of that is the consolidation versus me just having more time to "
            "write. edit: a few people asked which tool — it's the one I'm "
            "building, fwiw."
        )
        f = validate_text_post(authentic_reddit, platform="reddit")
        if not f:
            report.record(
                "Regression 7: Authentic Reddit text passes",
                PASS,
                "0 failures",
            )
        else:
            report.record(
                "Regression 7: Authentic Reddit text passes",
                FAIL,
                f"{len(f)} failures: {f}",
            )
    except Exception as e:
        report.record(
            "Regression 7: Authentic Reddit text passes", FAIL, str(e)
        )

    return report.summary()


if __name__ == "__main__":
    sys.exit(run())
