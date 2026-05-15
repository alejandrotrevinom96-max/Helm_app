"""
run_patch2_tests.py
===================

Executes the 7-test plan from CLAUDE_CODE_PROMPT_PATCH_2_PRODUCT_BRIDGES.md.

Test 1 — Schema validation (ProductBridge + BrandBible.pain_to_product_bridges).
Test 2 — Intake end-to-end with a mocked LLM returning a valid bridges JSON.
Test 3 — Matcher with no approved bridges → match.applies = False.
Test 4 — Matcher with confidence below threshold → match.applies = False.
Test 5 — Matcher returns full match → format_bridge_for_prompt non-empty.
Test 6 — Prompt builder integrates the PRODUCT_RELEVANCE section.
Test 7 — Project isolation across two ClientContexts.

Real Haiku calls are not exercised here — that's covered manually during
rollout. The mock LLMClient implements the same Protocol the real Haiku
adapter would.

Usage:
    python run_patch2_tests.py
"""

from __future__ import annotations

import asyncio
import json
import sys
import traceback
from pathlib import Path
from uuid import uuid4

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
        from client_context import (
            BrandBible,
            ClientContext,
            ContentType,
            Platform,
            ProductBridge,
            VarietyConfig,
        )
        from prompt_builder import build_generation_prompt
        from product_bridge_intake import (
            BridgeIntakeError,
            generate_bridge_drafts,
        )
        from product_bridge_matcher import (
            BridgeMatch,
            format_bridge_for_prompt,
            match_bridge_for_pain,
        )
    except Exception as e:
        report.record(
            "imports",
            FAIL,
            f"{e}\n{traceback.format_exc()}",
        )
        return report.summary()

    def make_brand_bible(bridges: list[ProductBridge] | None = None) -> BrandBible:
        return BrandBible(
            voice="founder voice, casual",
            audience="solo founders",
            positioning="marketing OS",
            pillars=["consolidation", "voice"],
            pain_to_product_bridges=bridges or [],
        )

    def make_ctx(bridges: list[ProductBridge] | None = None) -> ClientContext:
        ctx = ClientContext(client_id=uuid4(), brand_bible=make_brand_bible(bridges))
        # Disable variety injection so it doesn't pollute the prompt
        ctx.get_platform_slots(Platform.LINKEDIN).variety_config = VarietyConfig(enabled=False)
        return ctx

    # Generic mock LLMClient — returns whatever payload the test wires in.
    class _MockClient:
        def __init__(self, payload: dict | None = None, raw: str | None = None) -> None:
            self._payload = payload
            self._raw = raw

        async def complete_json(self, *, model: str, prompt: str, max_tokens: int = 400) -> str:
            if self._raw is not None:
                return self._raw
            return json.dumps(self._payload or {})

    # ==================================================================
    # Test 1 — Schema validation
    # ==================================================================
    try:
        bridge = ProductBridge(
            pain="Distribution harder than building",
            bridge="Helm handles social so the founder can focus on podcasts and communities.",
        )
        assert bridge.pending_review is True, "pending_review default should be True"
        assert bridge.approved_at is None, "approved_at should default to None"
        assert bridge.approved_by is None, "approved_by should default to None"

        bb = make_brand_bible([bridge])
        assert len(bb.pain_to_product_bridges) == 1
        assert bb.pain_to_product_bridges[0].pain == "Distribution harder than building"

        # Empty bridges field defaults to []
        bb2 = make_brand_bible([])
        assert bb2.pain_to_product_bridges == []
        report.record("Patch 2 Test 1: Schema validation", PASS)
    except Exception as e:
        report.record("Patch 2 Test 1: Schema validation", FAIL, str(e))

    # ==================================================================
    # Test 2 — Intake end-to-end (mocked LLM)
    # ==================================================================
    try:
        # Mock returns 10 bridges in valid shape
        sample_bridges_payload = {
            "bridges": [
                {
                    "pain": "Distribution harder than building the product",
                    "bridge": "Helm handles the social media layer so the founder spends time on higher-ROI distribution channels.",
                },
                {
                    "pain": "Generic AI content that sounds like ChatGPT",
                    "bridge": "Helm learns the founder's voice fingerprint from past posts so output sounds like one person, not a model.",
                },
                {
                    "pain": "Context switching across marketing tools",
                    "bridge": "Helm rolls research, drafting, scheduling, and analytics into one surface so the founder stops swapping tabs.",
                },
                {
                    "pain": "Inconsistent shipping cadence",
                    "bridge": "Helm's calendar shows the next 4 weeks so the founder can plan a cadence and stick to it.",
                },
                {
                    "pain": "Brand voice drifts in AI tools",
                    "bridge": "Helm's voice fingerprint loads automatically into every draft so output never reverts to the default LLM register.",
                },
                {
                    "pain": "Marketing feels like a second job",
                    "bridge": "Helm trims the marketing surface to one workspace the founder can run in 30 minutes a day.",
                },
                {
                    "pain": "No clear distribution roadmap",
                    "bridge": "Helm surfaces research findings as concrete content angles so the founder always has a queue.",
                },
                {
                    "pain": "Posts get edited heavily before publishing",
                    "bridge": "Helm tracks edit diffs and learns the founder's overrides so the next draft needs less rework.",
                },
            ]
        }
        drafts = asyncio.run(
            generate_bridge_drafts(
                product_description="Helm is a marketing OS for solo founders.",
                audience_pains=[
                    "Distribution harder than product",
                    "AI content sounds generic",
                    "Tool switching",
                ],
                marketing_one_liner="One workspace for research, drafting, scheduling, analytics.",
                client=_MockClient(payload=sample_bridges_payload),
            )
        )
        assert len(drafts) == 8, f"expected 8 drafts, got {len(drafts)}"
        # Patch 2.1: bridges are auto-approved (no operator UI).
        assert all(not d.pending_review for d in drafts), \
            "all drafts should be auto-approved (pending_review=False)"
        assert all(d.approved_by == "system:llm_intake_v1" for d in drafts), \
            "all drafts should carry the auto-approver marker"
        assert all(d.approved_at is not None for d in drafts), \
            "all drafts should have approved_at set"
        assert all(d.pain and d.bridge for d in drafts), "every draft must have pain + bridge"
        report.record("Patch 2 Test 2: Intake end-to-end (mocked)", PASS)
    except Exception as e:
        report.record(
            "Patch 2 Test 2: Intake end-to-end (mocked)",
            FAIL,
            f"{e}\n{traceback.format_exc()}",
        )

    # ==================================================================
    # Test 3 — Matcher with no approved bridges
    # ==================================================================
    try:
        bridges = [
            ProductBridge(
                pain="Distribution harder than building",
                bridge="Helm handles social so the founder can focus on podcasts and communities.",
                pending_review=True,  # not approved
            )
        ]
        match = asyncio.run(
            match_bridge_for_pain(
                pain_point="Distribution is hard for solo founders",
                available_bridges=bridges,
                client=_MockClient(payload={}),
            )
        )
        assert match.applies is False
        assert "No approved bridges" in match.reasoning
        report.record("Patch 2 Test 3: Matcher with no approved bridges", PASS)
    except Exception as e:
        report.record(
            "Patch 2 Test 3: Matcher with no approved bridges",
            FAIL,
            f"{e}\n{traceback.format_exc()}",
        )

    # ==================================================================
    # Test 4 — Matcher with confidence below threshold
    # ==================================================================
    try:
        approved_bridge = ProductBridge(
            pain="Distribution harder than building",
            bridge="Helm handles social so the founder can focus on podcasts and communities.",
            pending_review=False,
        )
        match = asyncio.run(
            match_bridge_for_pain(
                pain_point="Something completely unrelated to distribution",
                available_bridges=[approved_bridge],
                client=_MockClient(
                    payload={
                        "matched_pain": None,
                        "matched_bridge": None,
                        "confidence": 0.3,
                        "reasoning": "Pain point unrelated to any available bridge.",
                    }
                ),
            )
        )
        assert match.applies is False
        assert match.matched_bridge is None
        report.record("Patch 2 Test 4: Matcher below threshold", PASS)
    except Exception as e:
        report.record(
            "Patch 2 Test 4: Matcher below threshold",
            FAIL,
            f"{e}\n{traceback.format_exc()}",
        )

    # ==================================================================
    # Test 5 — Matcher returns full match
    # ==================================================================
    try:
        approved_bridge = ProductBridge(
            pain="Distribution harder than building",
            bridge="Helm handles social so the founder can focus on podcasts and communities.",
            pending_review=False,
        )
        match = asyncio.run(
            match_bridge_for_pain(
                pain_point="Distribution is the hard part for solo founders",
                available_bridges=[approved_bridge],
                client=_MockClient(
                    payload={
                        "matched_pain": "Distribution harder than building",
                        "matched_bridge": "Helm handles social so the founder can focus on podcasts and communities.",
                        "confidence": 0.85,
                        "reasoning": "Same pain, different phrasing.",
                    }
                ),
            )
        )
        assert match.applies is True
        section = format_bridge_for_prompt(match)
        assert section, "format_bridge_for_prompt returned empty for an applied match"
        assert "PRODUCT_RELEVANCE" in section
        assert "Helm handles social" in section
        assert "INTEGRATION RULES" in section
        report.record(
            "Patch 2 Test 5: Matcher full match + format",
            PASS,
            f"confidence={match.confidence}",
        )
    except Exception as e:
        report.record(
            "Patch 2 Test 5: Matcher full match + format",
            FAIL,
            f"{e}\n{traceback.format_exc()}",
        )

    # ==================================================================
    # Test 6 — Prompt builder integration
    # ==================================================================
    try:
        approved_bridges = [
            ProductBridge(
                pain="Distribution harder than building",
                bridge="Helm handles social so the founder can focus on podcasts and communities.",
                pending_review=False,
            ),
            ProductBridge(
                pain="Generic AI content",
                bridge="Helm applies the voice fingerprint so output sounds like one person, not a model.",
                pending_review=False,
            ),
            ProductBridge(
                pain="Tool switching",
                bridge="Helm rolls research, drafting, scheduling into one surface.",
                pending_review=False,
            ),
        ]
        ctx = make_ctx(approved_bridges)

        matcher_payload = {
            "matched_pain": "Distribution harder than building",
            "matched_bridge": "Helm handles social so the founder can focus on podcasts and communities.",
            "confidence": 0.9,
            "reasoning": "Direct semantic match.",
        }
        prompt = asyncio.run(
            build_generation_prompt(
                platform=Platform.LINKEDIN,
                content_type=ContentType.TEXT,
                client_context=ctx,
                pain_point="Distribution is the hard part for solo founders",
                bridge_matcher_client=_MockClient(payload=matcher_payload),
            )
        )
        assert "PRODUCT_RELEVANCE" in prompt, "PRODUCT_RELEVANCE section missing"
        assert "Helm handles social" in prompt, "matched bridge text missing"
        assert "INTEGRATION RULES" in prompt, "integration rules missing"
        report.record("Patch 2 Test 6: Prompt builder integration", PASS)
    except Exception as e:
        report.record(
            "Patch 2 Test 6: Prompt builder integration",
            FAIL,
            f"{e}\n{traceback.format_exc()}",
        )

    # ==================================================================
    # Test 7 — Project isolation
    # ==================================================================
    # Two ClientContexts with DIFFERENT approved bridges. We capture the
    # bridges_block the matcher sees by intercepting the prompt the mock
    # client receives, and verify only the project-A bridges appear in
    # project A's matcher call (and only project-B bridges in project B's).
    try:
        project_a_bridge = ProductBridge(
            pain="Project-A specific pain about distribution",
            bridge="Project-A bridge — Helm helps with distribution and podcasts specifically.",
            pending_review=False,
        )
        project_b_bridge = ProductBridge(
            pain="Project-B specific pain about voice drift",
            bridge="Project-B bridge — Helm preserves the founder's voice fingerprint across drafts.",
            pending_review=False,
        )
        ctx_a = make_ctx([project_a_bridge])
        ctx_b = make_ctx([project_b_bridge])

        captured_prompts: list[str] = []

        class _CapturingMock:
            def __init__(self) -> None:
                self.matched = {
                    "matched_pain": None,
                    "matched_bridge": None,
                    "confidence": 0.0,
                    "reasoning": "noop",
                }

            async def complete_json(self, *, model: str, prompt: str, max_tokens: int = 400) -> str:
                captured_prompts.append(prompt)
                return json.dumps(self.matched)

        capture = _CapturingMock()
        _ = asyncio.run(
            build_generation_prompt(
                platform=Platform.LINKEDIN,
                content_type=ContentType.TEXT,
                client_context=ctx_a,
                pain_point="Distribution is hard",
                bridge_matcher_client=capture,
            )
        )
        _ = asyncio.run(
            build_generation_prompt(
                platform=Platform.LINKEDIN,
                content_type=ContentType.TEXT,
                client_context=ctx_b,
                pain_point="Voice consistency",
                bridge_matcher_client=capture,
            )
        )
        assert len(captured_prompts) == 2, f"expected 2 captured prompts, got {len(captured_prompts)}"
        prompt_a, prompt_b = captured_prompts
        assert "Project-A bridge" in prompt_a, "project A's bridge missing from project A's matcher prompt"
        assert "Project-B bridge" not in prompt_a, "project B's bridge leaked into project A's matcher prompt"
        assert "Project-B bridge" in prompt_b, "project B's bridge missing from project B's matcher prompt"
        assert "Project-A bridge" not in prompt_b, "project A's bridge leaked into project B's matcher prompt"
        report.record("Patch 2 Test 7: Project isolation", PASS)
    except Exception as e:
        report.record(
            "Patch 2 Test 7: Project isolation",
            FAIL,
            f"{e}\n{traceback.format_exc()}",
        )

    # ==================================================================
    # Test 8 (Patch 2.1) — Quality gate drops buzzwords + verbatim
    # ==================================================================
    # The intake LLM might slip a "leverage" or "seamlessly" past its
    # own constraints, or echo the pain back as the bridge. The gate
    # silently drops those so the client never sees them. We seed a
    # mock payload with 4 candidates (2 dirty, 2 clean) and assert only
    # the 2 clean ones come out.
    try:
        mixed_payload = {
            "bridges": [
                {
                    # FAIL: contains "leverages" + "streamline" + "seamlessly"
                    "pain": "Distribution is hard",
                    "bridge": "Helm leverages AI to streamline your marketing workflow seamlessly.",
                },
                {
                    # PASS: clean, concrete
                    "pain": "Voice drift in AI tools",
                    "bridge": "Helm keeps the founder's tone consistent across drafts by loading the voice fingerprint every time.",
                },
                {
                    # FAIL: bridge repeats pain verbatim (lazy LLM)
                    "pain": "Marketing feels overwhelming for solo founders",
                    "bridge": "Marketing feels overwhelming for solo founders",
                },
                {
                    # PASS: clean
                    "pain": "Inconsistent shipping cadence",
                    "bridge": "Helm's calendar shows the next 4 weeks of posts so the founder can plan a cadence and stick to it.",
                },
                {
                    # FAIL: "unlock" + "empower" + "comprehensive"
                    "pain": "Tool sprawl",
                    "bridge": "Helm unlocks a comprehensive workspace that empowers founders.",
                },
            ]
        }
        drafts = asyncio.run(
            generate_bridge_drafts(
                product_description="Helm is a marketing OS for solo founders.",
                audience_pains=["Distribution", "Voice", "Cadence"],
                marketing_one_liner="One workspace for research, drafting, scheduling.",
                client=_MockClient(payload=mixed_payload),
            )
        )
        kept_pains = {d.pain for d in drafts}
        if (
            len(drafts) == 2
            and "Voice drift in AI tools" in kept_pains
            and "Inconsistent shipping cadence" in kept_pains
            and all(not d.pending_review for d in drafts)
        ):
            report.record(
                "Patch 2.1 Test 8: Quality gate drops buzzwords + verbatim",
                PASS,
                f"{len(drafts)} survived of 5 candidates",
            )
        else:
            report.record(
                "Patch 2.1 Test 8: Quality gate drops buzzwords + verbatim",
                FAIL,
                f"expected 2 specific drafts, got {len(drafts)} with pains {kept_pains}",
            )
    except Exception as e:
        report.record(
            "Patch 2.1 Test 8: Quality gate drops buzzwords + verbatim",
            FAIL,
            f"{e}\n{traceback.format_exc()}",
        )

    return report.summary()


if __name__ == "__main__":
    sys.exit(run())
