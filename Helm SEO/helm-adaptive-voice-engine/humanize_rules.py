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
