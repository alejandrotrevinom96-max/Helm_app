"""
ugc_prompt.py
=============

UGC-specific prompt instructions appended to the base generation prompt.

This is what gets injected into build_generation_prompt() when
content_type=UGC. Lives separately from PLATFORM_TONE_INSTRUCTIONS because the
output STRUCTURE is content-type-specific (the bundle), while the platform
tone is platform-specific.

Integration:
  In prompt_builder.py, after composing the base prompt, detect content_type
  and append the schema instruction if UGC:

      from ugc_prompt import append_ugc_schema_to_prompt

      base_prompt = ...
      if content_type == ContentType.UGC:
          base_prompt = append_ugc_schema_to_prompt(base_prompt, platform.value)

Version: 1.1 (hook 5-9 words, expanded cadence rules, reminder line)
"""

from __future__ import annotations


UGC_OUTPUT_SCHEMA_INSTRUCTION = """
OUTPUT FORMAT (mandatory)
=========================

Return ONLY this JSON. No commentary, no markdown fences, no preamble, no
thinking tags. One JSON object, nothing else.

{
  "hook": {
    "text": "<5 to 9 spoken words, the attention grab>",
    "duration_seconds": <1.0 to 4.0>,
    "delivery": "<one of: punchy, confessional, emphatic>"
  },
  "body": [
    {
      "beat": 1,
      "text": "<one idea, supports the hook, builds toward reveal>",
      "duration_seconds": <2.0 to 15.0>,
      "delivery": "<one of: explanatory, tension, reveal, emphatic>"
    }
    // 1 to 5 beats total. Number them sequentially starting at 1.
  ],
  "cta": {
    "text": "<organic conversational ask, never a sales pitch>",
    "duration_seconds": <2.0 to 6.0>,
    "delivery": "<one of: warm, punchy>"
  },
  "overlays": [
    {
      "text": "<3 to 5 words max, all caps for emphasis is fine>",
      "trigger_at_seconds": <when in the video, measured from start>,
      "duration_seconds": <0.5 to 5.0>
    }
    // 3 to 8 overlays total
  ],
  "caption": "<1 to 3 sentences, extends the video, includes a soft CTA>",
  "hashtags": ["tag1", "tag2", "tag3"],   // 3 to 5 tags WITHOUT the # prefix
  "metadata": {
    "language": "en",
    "platform": "<the target platform, set explicitly>",
    "passes_swipe_test": true
  }
}

CRITICAL SPOKEN CADENCE RULES (apply to hook, body, and cta)
============================================================

  - Heavy contractions: I'm, you're, doesn't, can't, gonna, wanna, that's,
    here's, what's, it's. Written-out forms sound robotic on camera.
  - Sentence fragments are encouraged. People talk in fragments.
  - One clear idea per sentence. No compound clauses stitched with "and".
  - Talk like you're explaining it to another founder over coffee, not like
    you're presenting in a conference room.
  - Never use written-text language ("Today I want to discuss...",
    "In this video...", "Let's talk about...").
  - Use "I" and "you" heavily. Never "we" (company voice) or "one" (impersonal).

HOOK RULES (most important part of the entire video)
====================================================

  - 5 to 9 spoken words maximum. No exceptions.
  - Must pass the 0.5-second swipe test: would a stranger scrolling at 2am
    keep watching past the first half-second of this video? Set
    metadata.passes_swipe_test honestly based on this check.
  - Best patterns: specific confession ("I used to..."), surprising number
    ("I spent 156 hours..."), pattern interrupt ("Stop using X"), contrarian
    setup ("Everyone's wrong about Y").

DELIVERY STYLE OPTIONS
======================

  punchy          Fast, high-energy. Use for hooks and CTAs that need impact.
  explanatory     Calm, informative. Use for body beats that establish context.
  tension         Building, slightly slower. Use for body beats setting up reveal.
  reveal          The payoff moment, emphatic but not loud.
  warm            Friendly, conversational. Use for CTAs that invite reply.
  confessional    First-person admission, slightly vulnerable. Use for hooks
                  that confess ("I used to...").
  emphatic        Stressed, slow. Use sparingly for the single most important line.

OVERLAY RULES
=============

  - Reinforce the spoken word, never repeat it verbatim. If the speaker says
    "I dropped Buffer last month", a good overlay is "BUFFER" or "DROPPED".
    A bad overlay is "I dropped Buffer last month" (verbatim repeat).
  - 3 to 5 words max per overlay. Numbers, key phrases, callouts only.
  - Place overlays at moments of emphasis (numbers, key phrases, transitions).
    They should land mid-beat, not at beat boundaries.
  - trigger_at_seconds is measured from the start of the video, not the start
    of the section the overlay lands in.

CAPTION RULES
=============

  - 1 to 3 sentences max.
  - Extends the video. Acts as the post-credit scene. Add context, ask a
    question, or tease the next post.
  - Includes a soft CTA that hooks the next watch.
  - Never starts with "In this video", "Today I'm talking about", or other
    summary phrases. The caption is not a description of the video.

HASHTAG RULES
=============

  - 3 to 5 tags total.
  - Mix: 1 to 2 broad/trending + 2 to 3 niche.
  - Stored WITHOUT the # prefix (e.g., "indiehacker" not "#indiehacker").
  - All lowercase. No spaces.

VALIDATION CHECKLIST (run before returning)
============================================

  [ ] hook.text is 5 to 9 spoken words
  [ ] hook passes the 0.5-second swipe test (set passes_swipe_test honestly)
  [ ] body has 1 to 5 beats, each delivering one idea
  [ ] body beats numbered sequentially starting at 1
  [ ] cta is conversational, not a sales pitch
  [ ] overlays count is 3 to 8
  [ ] each overlay has 3 to 5 words max
  [ ] no overlay repeats spoken text verbatim
  [ ] caption extends the video instead of summarizing it
  [ ] caption length 20 to 500 chars
  [ ] 3 to 5 hashtags, mix of broad and niche, no # prefix
  [ ] script uses heavy contractions and sentence fragments
  [ ] first-person voice throughout (I/you, never we/one)
  [ ] no anti-patterns from PLATFORM_TONE triggered
  [ ] total duration (hook + body + cta) lands between 15 and 60 seconds

If any check fails, regenerate the entire bundle before returning. The bundle
will be rejected automatically by the schema validator if any field violates
the JSON schema (e.g., overlay text > 5 words, body has 6+ beats, hook > 9
words). You will get the failure reason and be asked to retry.
"""


def append_ugc_schema_to_prompt(base_prompt: str, target_platform: str) -> str:
    """Append the UGC bundle schema instructions to a base generation prompt.

    Use only when content_type=UGC. For other content types, the base prompt's
    instructions for output format apply (free-form text + override_log tags).

    Args:
        base_prompt:     the prompt produced by build_generation_prompt()
        target_platform: the platform string (tiktok, instagram, threads,
                         linkedin, facebook). Injected into metadata.platform
                         so the model can't accidentally set it to something
                         else.

    Returns:
        The full prompt with UGC schema instructions appended, plus a
        reminder pointing back to the CLIENT CONTEXT block at the top of
        the base prompt so the model doesn't lose the per-client signal
        when reading the schema instructions at the end.
    """
    return f"""{base_prompt}

{UGC_OUTPUT_SCHEMA_INSTRUCTION}

The metadata.platform field MUST be set to "{target_platform}".

IMPORTANT: The CLIENT CONTEXT (BRAND_BIBLE, VOICE_FINGERPRINT, LEARNED_OVERRIDES,
WINNING_UGC_EXAMPLES and ANTI_SAMPLES) appears at the top of this prompt.
Use them to override the defaults in this schema while staying within the hard
limits (9-word hook, 5-word overlays, etc.).
The final bundle must sound like THIS specific founder, not generic UGC content.
"""
