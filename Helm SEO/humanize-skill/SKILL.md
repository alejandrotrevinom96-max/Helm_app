---
name: humanize
description: Use this skill whenever the user asks to humanize text, remove AI slop, de-AI-ify, make writing sound human, edit out AI patterns, sound less robotic, sound less like ChatGPT, sound less like Claude, or do a final voice pass before publishing. Detects and rewrites the most common AI writing tells, including overused em dashes, the "it's not X, it's Y" rhythm, hedging adverbs, generic transitions like "moreover" and "furthermore", parallel triplets, explainer phrases, and buzzwords like "leverage", "seamlessly", "unlock", "empower". Must be invoked whenever the user mentions AI slop, AI patterns, AI tells, robotic writing, ChatGPT voice, Claude voice, or wants writing that "sounds human" or "doesn't sound like AI". Also use proactively as a final pass on any long-form content Claude just drafted (blog post, email, social, marketing copy) before declaring it done.
---

# Humanize

Most AI-generated prose has the same fingerprints. This skill finds them and rewrites them out while keeping the meaning, the numbers, and the writer's intent.

## Status: post-process fallback (Phase 2+)

As of Phase 2 of the Helm Adaptive Voice Engine, the rules in this skill
have been duplicated into `humanize_rules.py` and are injected directly
into generation prompts as `HUMANIZE_RULES`. The model is expected to comply
during composition, eliminating the need for a post-process pass.

This skill is now used as:
  1. **Optional post-process fallback** when generated output still slips
     past validators (rare in practice).
  2. **Operator manual cleanup** when reviewing edge-case outputs.
  3. **Reference documentation** for what the rules are and why.

The hard rules (em dashes, banned words, banned constructions) are enforced
preventively via HUMANIZE_RULES in the prompt. The soft rules (varied cadence,
organic flow, voice nuance) remain in this skill for cases where post-process
cleanup is needed.

When invoking this skill on a draft:
  - If the draft was generated with `inject_humanize=True`, expect minimal
    cleanup needed. Most violations indicate prompt fatigue or model failure
    to follow the embedded rules.
  - If the draft was generated with `inject_humanize=False`, run the full
    skill as before.

## When to use this skill

Trigger this skill any time the user wants writing to sound like a person instead of a model. Common phrasings:

- "humanize this"
- "remove the AI slop"
- "make this sound less like ChatGPT / Claude / AI"
- "this sounds robotic"
- "de-AI-ify"
- "final pass before publishing"
- "edit this for voice"
- "kill the em dashes"

Also volunteer to run this skill as a final pass on any long-form content Claude just drafted before declaring it done. Claude's own writing has the same fingerprints. Flag that openly and offer to humanize.

## The big picture

AI writing has tells at four levels:

1. Punctuation (em dashes, triple-hyphen breaks, mid-paragraph bolding)
2. Sentence construction ("it's not X, it's Y" flips, tricolons, "not just X but Y")
3. Word and phrase choice ("leverage", "seamlessly", "delve into", hedging adverbs, filler transitions)
4. Structure (every section closing with a zinger, FAQ everywhere, bullets when prose would work)

Humanizing is not about deleting all of these mechanically. A real writer uses em dashes sometimes. The difference is frequency, predictability, and whether there's a real voice underneath. Goal: make the rhythm sound like one specific human, not a model averaged across millions.

## Process

Follow these in order.

### 1. Read the entire input first

Do not start editing until you have read the whole piece. Get a sense of what the writer is trying to say, who the audience is, and what the target voice is. Skipping this step produces line-edits that break the flow.

### 2. Identify the target voice

If the user provided sample writing, a brand bible, or context about the publication, use that as the north star. If not, default to: smart human writing for other smart humans. Specific, concrete, unadorned. Short words where possible.

If the writer has a strong idiosyncratic style (always lowercase, lots of fragments, swears casually), preserve it. Humanizing is not homogenizing. When in doubt, ask: "I see you write in [X style]. Should I preserve that or are you moving away from it?"

### 3. Scan for the tells

Go through the Patterns Catalog below and tag every instance. Count the em dashes. Count the banned words. Count the tricolons.

### 4. Rewrite in sections, not word-by-word

Take a paragraph. Rewrite it as if you are saying it out loud to a friend who is smart but has not been thinking about this all day. Then check the original for any specific facts, numbers, or references you dropped and put them back.

Editing word-by-word produces stilted output. Editing by section produces clean prose.

### 5. Reread the result

Cut anything that still smells. Quick check: is there at least one one-syllable word in most sentences? Long unbroken sequences of polysyllabic latinate words are an AI fingerprint on their own.

## Patterns catalog

### Punctuation patterns

**Em dash overuse (—)**

The single most distinctive AI tell. AI-generated text averages one em dash every 50 to 80 words. Human writing averages one per 300 to 500 words, often zero in a short piece. Cap em dashes at one or two per 1,000 words.

When you find one, ask whether it would work as:

- a period (two short sentences)
- a comma (continuous clause)
- parentheses (true aside)
- nothing at all (just rejoin the clauses)

Almost always, yes.

Example:
Before: "Helm is a marketing OS — built for solo founders — that consolidates your stack."
After: "Helm is a marketing OS for solo founders. It consolidates your stack."

**Triple-hyphen section breaks (---)**

A telltale of AI-generated markdown. Real writers rarely separate sections this aggressively. Use headers or paragraph breaks instead. Cap at one or two `---` per long piece if the structural pivot is genuine.

**Mid-paragraph bolding**

AI loves to **bold the punchline** mid-sentence. Almost never necessary. Cut the bolding unless the bolded phrase is a defined term being introduced for the first time.

### Sentence-construction patterns

**"It's not X. It's Y." / "It's not X, it's Y."**

The most viral AI rhythm. Search and destroy.

Example:
Before: "This isn't a productivity problem. It's an architecture problem."
After: "The problem is architecture, not productivity."
Better: "Architecture is what's broken."

**Tricolon with crescendo (three parallel items)**

"You ship faster, you ship better, you ship at all."
"Research, write, schedule."
"It's faster. It's cleaner. It's free."

Three-item parallel structure is a learned AI move. Real human writing uses it occasionally for genuine emphasis. AI uses it constantly. Trim to two items or convert to prose.

Example:
Before: "It saves time, it saves money, it saves your sanity."
After: "It saves a few hours a week."

**"Not just X, but Y"**

"This isn't just a tool, it's a system."
"More than just an editor — it's a workflow."

Almost always trimmable. Either say what it actually is or commit to the "just X" version.

**"Whether you're X or Y"**

"Whether you're a solo founder or a 10-person agency, you need this."

Inclusive framing AI uses to avoid committing to one ICP. If the page targets one ICP, name them. If both, name both explicitly without the "whether you're" scaffolding.

**Punchy one-word sentences for emphasis**

"This works.
Period.
Done."

Used sparingly by humans, used constantly by AI. Cap at one per 500 words.

### Word and phrase patterns

**Buzzwords to ban (almost always)**

| AI word | Human swap |
|---|---|
| leverage | use |
| harness | use |
| unlock | find, get |
| empower | help, let |
| elevate | improve, make better |
| streamline | simplify |
| seamlessly | (delete) |
| effortlessly | (delete) |
| intuitively | (delete) |
| game-changer | (delete) |
| robust | sturdy, reliable, strong |
| comprehensive | full, complete |
| holistic | whole, complete |
| cutting-edge | new |
| state-of-the-art | new, best |

**Explainer / exploration verbs**

| AI verb | Human swap |
|---|---|
| dive into | look at |
| delve into | look at |
| unpack | explain |
| uncover | find, show |
| navigate | handle, get through |
| explore | look at |
| embark on | start |

**Hedging adverbs (usually delete)**

truly, genuinely, really, essentially, fundamentally, ultimately, frankly, honestly, literally, quite, rather, very

If the underlying claim is true, the adverb adds nothing. If it isn't, the adverb is covering for it.

**Filler transitions (almost always delete)**

Moreover, Furthermore, Additionally, However, Thus, Hence, That said, Having said that, It's worth noting that, It's important to note

These are connective tissue AI uses to stitch ideas together. Strong prose does not need them. Paragraph order does the work.

**Opening fluff (always delete)**

- "In today's fast-paced world..."
- "In the digital age..."
- "In the world of [X]..."
- "Picture this:"
- "Imagine if:"
- "Here's the thing:"
- "Let's break it down."
- "Let's unpack this."

**Closing fluff (delete or rewrite)**

- "At the end of the day..."
- "At its core..."
- "At the heart of..."
- "In essence..."
- "When all is said and done..."
- "Ultimately..."

### Structural patterns

**Every section ending with a one-line zinger**

"That's not optional. That's the whole game."
"Architecture, not discipline."
"Period."

Used once or twice in a long piece, fine. Used at the end of every section, dead giveaway. Vary endings: some sections close on the supporting detail, some on a question, some just stop.

**Header → punchline → 2-3 supporting sentences**

AI loves this rhythm in every section. Vary it. Some sections should be plain paragraphs. Some headers should have no punchline. Some should open with a question, others with a story, others with a fact.

**Bulleted / numbered lists when prose would work**

AI bullets everything. Real writing reserves lists for genuinely enumerated content: steps in order, items with parallel structure, comparisons. Convert lists to prose when there are fewer than four items or when the items are not truly parallel.

**FAQ sections everywhere**

AI inserts FAQ blocks constantly. Keep FAQ when the format genuinely fits (reference docs, AEO content, help articles). Cut when it is just padding word count.

## Special case: Helm brand voice

If the context indicates this is for Helm (trythelm.com), apply the Helm voice rules on top of generic humanization:

- Peer-to-peer (founder to founder, operator to operator)
- Always quantified ("2.4 hrs/week", not "a lot of time")
- Real indie hacker language ("context switching", "tool sprawl", "ship over switch", "ship into silence")
- No enterprise jargon
- No third person
- No vague promises

Helm voice is allowed to use some AI-coded patterns sparingly. The rule is moderation, not abstinence. One em dash for rhythm is fine. Two tricolons in a 2,000-word piece is fine. Six of each is not.

## Quick reference: 30-second scan checklist

Before submitting humanized output, verify:

- Em dashes per 1,000 words: 2 or fewer
- Triple-hyphen breaks (---): 2 or fewer in a long piece
- "It's not X, it's Y" constructions: 0
- Buzzwords (leverage, seamlessly, unlock, empower): 0
- Hedging adverbs (truly, genuinely, really, essentially): 0 or near-zero
- Filler transitions (moreover, furthermore, additionally): 0
- Tricolons (three parallel items): 1 or fewer per long piece
- One-word emphasis sentences: 1 or fewer per long piece
- Mid-paragraph bolding: 0 unless introducing a defined term
- Opening fluff ("In today's...", "Picture this..."): 0
- Every section ending with a zinger: NO

## Output format

When the user asks Claude to humanize a piece of text, return:

1. The rewritten text, clean, ready to copy
2. A short changelog (3 to 6 bullet points) describing what was cut, e.g. "Removed 11 em dashes, kept 2", "Cut leverage, seamlessly, and unlock", "Rewrote 3 'it's not X, it's Y' constructions", "Converted two bulleted lists to prose"

That's it. Do not explain every change line by line. Do not preface with "Here's the humanized version." Just deliver the rewrite and the changelog.

## Edge cases

**The input is short (under 200 words)**

Same process, lower thresholds. Em dash cap drops to 1. Skip the changelog if fewer than 3 changes were needed.

**The input is technical documentation**

Be gentler. Technical docs need clarity over voice, and structural patterns (numbered steps, code blocks, definitional bolding) are appropriate. Focus on word-level tells (buzzwords, hedging adverbs, filler transitions) and leave the structure alone.

**The input is dialogue or quotes**

Do not humanize quoted speech. People talk how they talk. Only edit the surrounding narration.

**The writer's voice IS AI-coded on purpose**

Some writers genuinely love em dashes and tricolons. If they have sample writing showing this is their voice, preserve it. The skill is for unwanted AI patterns, not for stripping any pattern that happens to overlap with AI defaults.

**The user pastes raw AI output and asks for humanization without context**

Default to "smart human writing for smart humans" voice. Strip aggressively. Mention in the changelog that no target voice was provided, so the rewrite uses a neutral plain-prose default, and offer to redo it if the user shares a brand bible or sample.
