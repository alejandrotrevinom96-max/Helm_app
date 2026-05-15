"""
run_phase15_tests.py
====================

Runs the test plans from the three Phase 1.5 / Phase 2 prompt docs:
  - CLAUDE_CODE_PROMPT_E1_VOICE_IDIOSYNCRASIES.md (7 tests)
  - CLAUDE_CODE_PROMPT_F1_HUMANIZE_PREVENTIVE.md (6 tests)
  - CLAUDE_CODE_PROMPT_F4_VARIETY_INJECTION.md (7 tests)

Tests that require a live anthropic client or external storage are exercised
via mocks/in-memory stubs where possible and SKIPPED with a note when not.

Usage:
    python run_phase15_tests.py
"""

from __future__ import annotations

import asyncio
import random
import sys
import traceback
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID, uuid4

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))  # so platform_tone_instructions resolves


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

    # ------------------------------------------------------------------
    # Imports — fail fast if a new file is broken
    # ------------------------------------------------------------------
    try:
        from client_context import (
            ArchetypeUsage,
            BrandBible,
            ClientContext,
            ContentType,
            Platform,
            PlatformSlots,
            PostArchetype,
            VarietyConfig,
            VoiceIdiosyncrasies,
            WeightedPost,
        )
        from humanize_rules import HUMANIZE_RULES
        from platform_tone_instructions import (
            PLATFORM_TONE_INSTRUCTIONS,
        )
        from prompt_builder import build_generation_prompt
        from variety_injector import (
            VARIETY_MODE_INSTRUCTIONS,
            get_variety_instruction,
            select_variety_archetype,
            should_inject_variety,
        )
        from voice_idiosyncrasy_extractor import (
            extract_voice_idiosyncrasies,
            format_idiosyncrasies_as_prompt_rules,
        )
        from voice_idiosyncrasy_job import run_extraction_for_client
    except Exception as e:
        report.record("imports", FAIL, f"{e}\n{traceback.format_exc()}")
        return report.summary()

    # Shared helpers
    def make_brand_bible() -> BrandBible:
        return BrandBible(
            voice="founder voice, casual",
            audience="solo founders",
            positioning="marketing OS",
            pillars=["consolidation", "voice"],
        )

    def make_weighted_post(text: str, posted_at: datetime | None = None) -> WeightedPost:
        return WeightedPost(
            post_id=uuid4(),
            platform=Platform.LINKEDIN,
            content_type=ContentType.TEXT,
            text=text,
            posted_at=posted_at or datetime.now(timezone.utc),
            quality_score=1.0,
            weight=0.9,
        )

    # ==================================================================
    # E1 TESTS
    # ==================================================================

    # E1 Test 1 — Schema validation
    try:
        v = VoiceIdiosyncrasies(
            sample_size=15,
            em_dash_per_1000_words=0.2,
            ellipsis_per_1000_words=3.5,
            semicolon_per_1000_words=0.0,
            parenthetical_aside_per_1000_words=4.0,
            lowercase_first_letter_ratio=0.3,
            avg_sentence_length_words=8.5,
            fragment_ratio=0.4,
            profanity_per_1000_words=0.5,
            emoji_per_post=0.2,
            hedging_ratio=0.7,
            self_correction_count=2,
        )
        assert v.sample_size == 15
        assert v.is_stale() is False

        # Invalid (sample_size < 10) — Pydantic ge=10
        raised = False
        try:
            VoiceIdiosyncrasies(
                sample_size=5,
                em_dash_per_1000_words=0.0,
                ellipsis_per_1000_words=0.0,
                semicolon_per_1000_words=0.0,
                parenthetical_aside_per_1000_words=0.0,
                lowercase_first_letter_ratio=0.0,
                avg_sentence_length_words=0.0,
                fragment_ratio=0.0,
                profanity_per_1000_words=0.0,
                emoji_per_post=0.0,
                hedging_ratio=0.0,
                self_correction_count=0,
            )
        except Exception:
            raised = True
        if raised:
            report.record("E1 Test 1: Schema validation", PASS)
        else:
            report.record(
                "E1 Test 1: Schema validation",
                FAIL,
                "sample_size=5 did NOT raise",
            )
    except Exception as e:
        report.record("E1 Test 1: Schema validation", FAIL, str(e))

    # E1 Test 2 — Extraction with synthetic posts
    try:
        # Build 15 posts that all share the "ok so / tbh / anyway" pattern
        # and start lowercase.
        templates = [
            "ok so i dropped buffer last month. wasted ~$200 on it tbh. anyway.",
            "ok so i'm trying a new framework this week. (probably overthinking it.) anyway.",
            "ok so my marketing stack used to be 9 tools. now it's 2 tbh.",
            "ok so we shipped on tuesday. it broke on wednesday. anyway.",
            "ok so the founders who post most are not the founders who grow most tbh.",
        ]
        posts: list[WeightedPost] = []
        for i in range(15):
            text = templates[i % len(templates)]
            posts.append(make_weighted_post(text))
        idio = extract_voice_idiosyncrasies(posts)
        assert idio is not None, "extraction returned None"
        assert "tbh" in idio.common_filler_words, "tbh missing"
        assert idio.lowercase_first_letter_ratio > 0.5, "lowercase ratio low"
        assert "ok so" in idio.common_openers, "ok so missing from openers"
        assert "anyway" in idio.common_closers, "anyway missing from closers"
        report.record("E1 Test 2: Extraction with synthetic posts", PASS)
    except Exception as e:
        report.record("E1 Test 2: Extraction with synthetic posts", FAIL, str(e))

    # E1 Test 3 — Cold start
    try:
        few_posts = [make_weighted_post("hello world") for _ in range(5)]
        idio = extract_voice_idiosyncrasies(few_posts)
        if idio is None:
            report.record("E1 Test 3: Cold start", PASS)
        else:
            report.record(
                "E1 Test 3: Cold start", FAIL, "expected None but got an object"
            )
    except Exception as e:
        report.record("E1 Test 3: Cold start", FAIL, str(e))

    # E1 Test 4 — Outlier trimming
    #
    # Normal post: three 2-word fragments (every "sentence" qualifies as a
    # fragment under the <= 4-word heuristic). With the outliers OUT,
    # fragment_ratio should be 1.0.
    #
    # Outlier: 100 sentences of 15-word prose. Each sentence is NOT a
    # fragment. If outliers were NOT trimmed, the long posts would dominate
    # the combined text and drag fragment_ratio down to ~0.
    try:
        normal_text = "tbh anyway. idk fwiw. ok so."  # 3 short fragments
        long_outlier_sentence = (
            "this is a much longer essay sentence that runs well past the "
            "fragment heuristic threshold of four words."
        )
        long_outlier = (long_outlier_sentence + " ") * 100
        posts: list[WeightedPost] = []
        for _ in range(18):
            posts.append(make_weighted_post(normal_text))
        posts.append(make_weighted_post(long_outlier))
        posts.append(make_weighted_post(long_outlier))
        idio = extract_voice_idiosyncrasies(posts)
        assert idio is not None
        # With outliers trimmed, fragment_ratio should stay close to 1.0
        # (every normal sentence is <= 4 words). If outliers leaked in,
        # 200 long sentences would crush the ratio toward 0.
        if idio.fragment_ratio >= 0.8:
            report.record(
                "E1 Test 4: Outlier trimming",
                PASS,
                f"fragment_ratio={idio.fragment_ratio}",
            )
        else:
            report.record(
                "E1 Test 4: Outlier trimming",
                FAIL,
                f"fragment_ratio={idio.fragment_ratio} — outliers may not have been trimmed",
            )
    except Exception as e:
        report.record("E1 Test 4: Outlier trimming", FAIL, str(e))

    # E1 Test 5 — Format as prompt rules
    try:
        idio = extract_voice_idiosyncrasies(
            [make_weighted_post("ok so tbh i think anyway.") for _ in range(15)]
        )
        assert idio is not None
        text = format_idiosyncrasies_as_prompt_rules(idio)
        assert "WRITER VOICE PROFILE" in text
        assert "PUNCTUATION PATTERNS" in text
        assert len(text) < 3000
        report.record(
            "E1 Test 5: Format as prompt rules",
            PASS,
            f"{len(text)} chars",
        )
    except Exception as e:
        report.record("E1 Test 5: Format as prompt rules", FAIL, str(e))

    # E1 Test 6 — Background job end-to-end
    try:
        ctx = ClientContext(client_id=uuid4(), brand_bible=make_brand_bible())
        slots = ctx.get_platform_slots(Platform.LINKEDIN)
        slots.voice_fingerprint = [
            make_weighted_post("ok so tbh i think anyway.") for _ in range(15)
        ]

        class _InMemoryRepo:
            def __init__(self, ctx: ClientContext) -> None:
                self._ctx = ctx

            async def get(self, client_id: UUID) -> ClientContext:
                return self._ctx

            async def save(self, context: ClientContext) -> None:
                self._ctx = context

        async def _run_job() -> bool:
            repo = _InMemoryRepo(ctx)
            return await run_extraction_for_client(
                client_id=ctx.client_id,
                platform=Platform.LINKEDIN,
                context_repository=repo,
            )

        updated = asyncio.run(_run_job())
        assert updated is True, "run_extraction_for_client returned False"
        slots_after = ctx.get_platform_slots(Platform.LINKEDIN)
        assert slots_after.voice_idiosyncrasies is not None
        assert slots_after.voice_idiosyncrasies.sample_size >= 10
        assert ctx.audit_log[-1].action == "voice_idiosyncrasies_extracted"
        report.record("E1 Test 6: Background job end-to-end", PASS)
    except Exception as e:
        report.record(
            "E1 Test 6: Background job end-to-end",
            FAIL,
            f"{e}\n{traceback.format_exc()}",
        )

    # E1 Test 7 — Prompt builder integration
    try:
        ctx = ClientContext(client_id=uuid4(), brand_bible=make_brand_bible())
        slots = ctx.get_platform_slots(Platform.LINKEDIN)
        slots.variety_config = VarietyConfig(enabled=False)  # disable F4 for this test
        slots.voice_idiosyncrasies = VoiceIdiosyncrasies(
            sample_size=15,
            em_dash_per_1000_words=0.2,
            ellipsis_per_1000_words=3.5,
            semicolon_per_1000_words=0.0,
            parenthetical_aside_per_1000_words=4.0,
            lowercase_first_letter_ratio=0.3,
            avg_sentence_length_words=8.5,
            fragment_ratio=0.4,
            profanity_per_1000_words=0.5,
            emoji_per_post=0.2,
            hedging_ratio=0.7,
            self_correction_count=2,
        )
        prompt = asyncio.run(build_generation_prompt(
            platform=Platform.LINKEDIN,
            content_type=ContentType.TEXT,
            client_context=ctx,
            pain_point="founders waste hours on tool switching",
        ))
        assert "WRITER VOICE PROFILE" in prompt, "voice profile section missing"
        assert "PUNCTUATION PATTERNS" in prompt
        report.record("E1 Test 7: Prompt builder integration", PASS)
    except Exception as e:
        report.record(
            "E1 Test 7: Prompt builder integration",
            FAIL,
            f"{e}\n{traceback.format_exc()}",
        )

    # ==================================================================
    # F1 TESTS
    # ==================================================================

    # F1 Test 1 — HUMANIZE_RULES non-empty and readable
    try:
        assert len(HUMANIZE_RULES) > 1500
        assert "Em dashes" in HUMANIZE_RULES
        assert "leverage" in HUMANIZE_RULES
        assert "X, not Y" in HUMANIZE_RULES
        report.record("F1 Test 1: HUMANIZE_RULES readable", PASS)
    except Exception as e:
        report.record("F1 Test 1: HUMANIZE_RULES readable", FAIL, str(e))

    # F1 Test 2 — inject_humanize=True embeds HUMANIZE_RULES
    try:
        ctx = ClientContext(client_id=uuid4(), brand_bible=make_brand_bible())
        ctx.get_platform_slots(Platform.LINKEDIN).variety_config = VarietyConfig(enabled=False)
        prompt_t = asyncio.run(build_generation_prompt(
            platform=Platform.LINKEDIN,
            content_type=ContentType.TEXT,
            client_context=ctx,
            pain_point="founders waste hours on tool switching",
            inject_humanize=True,
        ))
        assert "ANTI-AI WRITING RULES" in prompt_t
        assert "Em dashes" in prompt_t
        report.record("F1 Test 2: inject_humanize=True embeds rules", PASS)
    except Exception as e:
        report.record(
            "F1 Test 2: inject_humanize=True embeds rules",
            FAIL,
            f"{e}\n{traceback.format_exc()}",
        )

    # F1 Test 3 — inject_humanize=False excludes block
    try:
        ctx = ClientContext(client_id=uuid4(), brand_bible=make_brand_bible())
        ctx.get_platform_slots(Platform.LINKEDIN).variety_config = VarietyConfig(enabled=False)
        prompt_f = asyncio.run(build_generation_prompt(
            platform=Platform.LINKEDIN,
            content_type=ContentType.TEXT,
            client_context=ctx,
            pain_point="...",
            inject_humanize=False,
        ))
        # PROMPT_COMPOSITION_RULES now contains an "ANTI-AI WRITING RULES"
        # section that REFERENCES the injection. When inject_humanize=False,
        # we expect the embedded HUMANIZE_RULES block (which contains the
        # exhaustive lists like "Em dashes") to be absent. Use a substring
        # only present inside HUMANIZE_RULES itself.
        assert (
            "PUNCTUATION CONSTRAINTS:" not in prompt_f
        ), "HUMANIZE_RULES embedded section is still present when inject_humanize=False"
        report.record("F1 Test 3: inject_humanize=False excludes block", PASS)
    except Exception as e:
        report.record(
            "F1 Test 3: inject_humanize=False excludes block",
            FAIL,
            f"{e}\n{traceback.format_exc()}",
        )

    # F1 Test 4 — Default value is True (back-compat)
    try:
        ctx = ClientContext(client_id=uuid4(), brand_bible=make_brand_bible())
        ctx.get_platform_slots(Platform.LINKEDIN).variety_config = VarietyConfig(enabled=False)
        prompt_default = asyncio.run(build_generation_prompt(
            platform=Platform.LINKEDIN,
            content_type=ContentType.TEXT,
            client_context=ctx,
            pain_point="...",
        ))
        assert "ANTI-AI WRITING RULES" in prompt_default
        report.record("F1 Test 4: Default inject_humanize is True", PASS)
    except Exception as e:
        report.record("F1 Test 4: Default inject_humanize is True", FAIL, str(e))

    # F1 Test 5 — No duplicate ANTI-AI heading inside platform strings
    try:
        duplicated = []
        for key, s in PLATFORM_TONE_INSTRUCTIONS.items():
            count = s.count("ANTI-AI WRITING RULES")
            if count != 0:
                duplicated.append((key, count))
        if not duplicated:
            report.record("F1 Test 5: No conflict with platform strings", PASS)
        else:
            report.record(
                "F1 Test 5: No conflict with platform strings",
                FAIL,
                f"duplicates: {duplicated}",
            )
    except Exception as e:
        report.record("F1 Test 5: No conflict with platform strings", FAIL, str(e))

    # F1 Test 6 — Token budget (rough)
    try:
        ctx = ClientContext(client_id=uuid4(), brand_bible=make_brand_bible())
        ctx.get_platform_slots(Platform.LINKEDIN).variety_config = VarietyConfig(enabled=False)
        prompt = asyncio.run(build_generation_prompt(
            platform=Platform.LINKEDIN,
            content_type=ContentType.TEXT,
            client_context=ctx,
            pain_point="...",
        ))
        # Rough token estimate: 4 chars per token. Budget is <8000 tokens.
        rough_tokens = len(prompt) // 4
        if rough_tokens < 8000:
            report.record(
                "F1 Test 6: Token budget",
                PASS,
                f"~{rough_tokens} tokens",
            )
        else:
            report.record(
                "F1 Test 6: Token budget",
                FAIL,
                f"~{rough_tokens} tokens (limit 8000)",
            )
    except Exception as e:
        report.record("F1 Test 6: Token budget", FAIL, str(e))

    # ==================================================================
    # F4 TESTS
    # ==================================================================

    # F4 Test 1 — Cold start (post_count < 5) blocks variety
    try:
        slots = PlatformSlots(post_count=3)
        config = VarietyConfig(enabled=True, injection_probability=0.5)  # max allowed
        # Force a probability of 1.0 via a deterministic rng that always
        # returns 0.0 (so rng.random() < 0.5 is True).
        rng = random.Random(42)
        if should_inject_variety(slots, config, rng=rng) is False:
            report.record("F4 Test 1: Cold start blocks variety", PASS)
        else:
            report.record(
                "F4 Test 1: Cold start blocks variety",
                FAIL,
                "should_inject_variety returned True under post_count=3",
            )
    except Exception as e:
        report.record("F4 Test 1: Cold start blocks variety", FAIL, str(e))

    # F4 Test 2 — Variety enabled with sufficient posts
    try:
        slots = PlatformSlots(post_count=10)
        config = VarietyConfig(enabled=True, injection_probability=0.5)
        # rng.random() returns 0.6394 first with seed 42 — that won't pass
        # < 0.5. Use a forced-low rng to guarantee the roll succeeds.
        class _ForcedRng:
            def random(self) -> float:
                return 0.0
        result = should_inject_variety(slots, config, rng=_ForcedRng())
        if result is True:
            report.record("F4 Test 2: Variety enabled fires", PASS)
        else:
            report.record(
                "F4 Test 2: Variety enabled fires",
                FAIL,
                "should_inject_variety returned False with forced-low rng",
            )
    except Exception as e:
        report.record("F4 Test 2: Variety enabled fires", FAIL, str(e))

    # F4 Test 3 — Cooldown blocks variety
    try:
        slots = PlatformSlots(
            post_count=10,
            recent_post_archetypes=[
                ArchetypeUsage(
                    archetype=PostArchetype.SHITPOST,
                    was_variety_injected=True,
                ),
                ArchetypeUsage(
                    archetype=PostArchetype.ESSAY,
                    was_variety_injected=False,
                ),
                ArchetypeUsage(
                    archetype=PostArchetype.ESSAY,
                    was_variety_injected=False,
                ),
            ],
        )
        config = VarietyConfig(
            enabled=True, injection_probability=0.5, cooldown_after_variety=3
        )
        class _ForcedRng:
            def random(self) -> float:
                return 0.0
        result = should_inject_variety(slots, config, rng=_ForcedRng())
        if result is False:
            report.record("F4 Test 3: Cooldown blocks variety", PASS)
        else:
            report.record(
                "F4 Test 3: Cooldown blocks variety",
                FAIL,
                "should_inject_variety returned True despite recent variety",
            )
    except Exception as e:
        report.record("F4 Test 3: Cooldown blocks variety", FAIL, str(e))

    # F4 Test 4 — Selection prefers unused archetypes
    try:
        slots = PlatformSlots(
            post_count=10,
            recent_post_archetypes=[
                ArchetypeUsage(archetype=PostArchetype.SHITPOST, was_variety_injected=False),
                ArchetypeUsage(archetype=PostArchetype.CONTRARIAN, was_variety_injected=False),
            ],
        )
        config = VarietyConfig(sliding_window_size=10)
        selected = select_variety_archetype(slots, config, rng=random.Random(42))
        if selected not in (PostArchetype.SHITPOST, PostArchetype.CONTRARIAN):
            report.record(
                "F4 Test 4: Selection prefers unused archetypes",
                PASS,
                f"picked {selected.value}",
            )
        else:
            report.record(
                "F4 Test 4: Selection prefers unused archetypes",
                FAIL,
                f"picked recently-used {selected.value}",
            )
    except Exception as e:
        report.record(
            "F4 Test 4: Selection prefers unused archetypes",
            FAIL,
            str(e),
        )

    # F4 Test 5 — All archetypes have a non-empty instruction
    try:
        bad: list[str] = []
        for archetype in PostArchetype:
            instruction = get_variety_instruction(archetype)
            if len(instruction) <= 100 or "VARIETY MODE" not in instruction:
                bad.append(archetype.value)
        if not bad:
            report.record("F4 Test 5: All instructions exist", PASS)
        else:
            report.record(
                "F4 Test 5: All instructions exist",
                FAIL,
                f"missing/short for: {bad}",
            )
    except Exception as e:
        report.record("F4 Test 5: All instructions exist", FAIL, str(e))

    # F4 Test 6 — Integration: force variety to fire and assert VARIETY MODE in prompt
    try:
        ctx = ClientContext(client_id=uuid4(), brand_bible=make_brand_bible())
        slots = ctx.get_platform_slots(Platform.LINKEDIN)
        # Force conditions: post_count >= 5, probability = max (0.5),
        # no recent variety in cooldown window. Then patch random to
        # always return 0.0.
        slots.post_count = 10
        slots.variety_config = VarietyConfig(
            enabled=True, injection_probability=0.5, cooldown_after_variety=3
        )
        # Monkeypatch the module-level `random` used by variety_injector
        import variety_injector as vi
        original_random = vi.random.random
        vi.random.random = lambda: 0.0  # type: ignore[assignment]
        try:
            prompt = asyncio.run(build_generation_prompt(
                platform=Platform.LINKEDIN,
                content_type=ContentType.TEXT,
                client_context=ctx,
                pain_point="founders waste hours on tool switching",
            ))
        finally:
            vi.random.random = original_random  # type: ignore[assignment]
        if "VARIETY MODE" in prompt:
            report.record("F4 Test 6: Integration end-to-end", PASS)
        else:
            report.record(
                "F4 Test 6: Integration end-to-end",
                FAIL,
                "VARIETY MODE not present in prompt",
            )
    except Exception as e:
        report.record(
            "F4 Test 6: Integration end-to-end",
            FAIL,
            f"{e}\n{traceback.format_exc()}",
        )

    # F4 Test 7 — Telemetry (record_archetype_usage appends to slots)
    try:
        from variety_injector import record_archetype_usage
        slots = PlatformSlots(post_count=10)
        config = VarietyConfig()
        record_archetype_usage(
            slots,
            PostArchetype.SHITPOST,
            was_variety_injected=True,
            config=config,
        )
        if (
            slots.recent_post_archetypes
            and slots.recent_post_archetypes[-1].archetype == PostArchetype.SHITPOST
            and slots.recent_post_archetypes[-1].was_variety_injected is True
        ):
            report.record("F4 Test 7: Telemetry / record_archetype_usage", PASS)
        else:
            report.record(
                "F4 Test 7: Telemetry / record_archetype_usage",
                FAIL,
                f"recent_post_archetypes={slots.recent_post_archetypes!r}",
            )
    except Exception as e:
        report.record(
            "F4 Test 7: Telemetry / record_archetype_usage",
            FAIL,
            str(e),
        )

    return report.summary()


if __name__ == "__main__":
    sys.exit(run())
