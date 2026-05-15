// PR Sprint 7.13 — Platform-native tone system.
//
// Faithful TypeScript port of Helm SEO/platform_tone_instructions.py.
// Drop-in for the generation pipeline: layer PLATFORM_TONE_INSTRUCTIONS
// + CONTENT_TYPE_RULES on top of the existing Brand Bible + Voice
// Fingerprint logic.
//
// Three responsibilities:
//   1. Define the rule banks (PROMPT_COMPOSITION_RULES,
//      CONTENT_TYPE_RULES, PLATFORM_TONE_INSTRUCTIONS,
//      PLATFORM_CONTENT_COMPATIBILITY).
//   2. Expose buildGenerationPrompt() to stack them in the right
//      order for a single generation call.
//   3. Provide mapDbContentTypeToTaxonomy() so the Sprint 7.0.4
//      DB content_types (`reel`, `single_tweet`, `thread`,
//      `text_post`, `single_image`, `community_post`, …) collapse
//      onto the four-bucket taxonomy this rule set uses
//      (`ugc | carousel | photo | text`).
//
// Changes against the Python source:
//   - PLATFORM_CONTENT_COMPATIBILITY.tiktok extended to
//     ["ugc", "carousel", "photo"] (was just ["ugc"]) so the
//     Sprint 7.12 TikTok carousel + single photo content types
//     don't fail validation.
//   - Added strongly-typed Platform + ContentType unions.
//   - Added InvalidContentForPlatformError so the API route can
//     surface a 400 with errorKind='wrong_content_type' instead
//     of a generic crash.
//
// PR Sprint 7.22 — F1 preventive humanize wired in:
//   - PROMPT_COMPOSITION_RULES gains an "ANTI-AI WRITING RULES"
//     paragraph that references HUMANIZE_RULES.
//   - All 6 platform strings (instagram/linkedin/x/threads/
//     facebook/reddit) gained an AUTHENTICITY MARKERS section
//     before their ANTI-PATTERNS list. Reddit also got an
//     OVERRIDES TO CONTENT_TYPE_RULES["text"] subsection.
//   - buildGenerationPrompt() accepts injectHumanize: boolean
//     (default true) and embeds HUMANIZE_RULES right after
//     PROMPT_COMPOSITION_RULES.

import { HUMANIZE_RULES } from '@/lib/voice-engine/humanize-rules';

export type Platform =
  | 'instagram'
  | 'linkedin'
  | 'x'
  | 'threads'
  | 'facebook'
  | 'reddit'
  | 'tiktok';

export type ContentTypeTaxonomy = 'ugc' | 'carousel' | 'photo' | 'text';

export const PROMPT_COMPOSITION_RULES = `
GENERATION INPUTS (always provided to the model):
  1. BRAND_BIBLE          client's tone, banned phrases, content pillars, audience, positioning
  2. VOICE_FINGERPRINT    examples of past posts, idiosyncratic patterns, sentence-length distribution
  3. PLATFORM_TONE        platform-specific rules (Instagram, LinkedIn, X, Threads, Facebook, Reddit, TikTok)
  4. CONTENT_TYPE         format-specific rules (UGC, Carousel, Photo, Text)
  5. PAIN_POINT           the specific audience pain, insight, or research finding the post addresses

ORDER OF PRECEDENCE (when rules conflict, higher wins):
  1. Hard platform constraints (character limits, format requirements, native syntax). Non-negotiable.
  2. BRAND_BIBLE.banned_phrases and BRAND_BIBLE.mandatory_voice_signals.
  3. VOICE_FINGERPRINT patterns. Influence scales with the count of consistent samples:
       - 1 to 2 samples       light influence. Treat as soft hints. Do not override platform defaults.
       - 3 to 5 samples       medium influence. May override CONTENT_TYPE_RULES base mechanics
                              when the pattern is consistent across all samples.
       - 6 or more samples    strong influence. May override PLATFORM_TONE defaults when the pattern
                              is consistent across samples (e.g., writer uses fragments where platform
                              defaults expect sentences).
     A pattern is "consistent" only when it appears in the majority of samples and is not contradicted
     by any of them.
  4. PLATFORM_TONE specialization. Platform-specific overrides of content-type defaults
     (e.g., LinkedIn carousel optimal slide count vs Instagram carousel optimal slide count).
  5. CONTENT_TYPE_RULES base. Format-level mechanics that apply across platforms.
  6. PAIN_POINT framing. Shapes the *content*, not the *voice*.

HOW THE FIVE INPUTS INTERACT:

  - The PAIN_POINT determines what the post is *about*.
  - The BRAND_BIBLE determines what words and angles are allowed.
  - The VOICE_FINGERPRINT determines how sentences are shaped (length, rhythm, idioms).
  - The CONTENT_TYPE determines the *shape* of the deliverable (script vs carousel vs caption vs body).
  - The PLATFORM_TONE specializes that shape for the platform's algorithm and culture.

  In a single generation call, the prompt should read approximately:
    "Write a [content_type] for [platform] about [PAIN_POINT].
     Format rules for this content type: [CONTENT_TYPE_RULES[content_type]].
     Platform-specific overrides and tone: [PLATFORM_TONE_INSTRUCTIONS[platform]].
     The brand voice rules are: [BRAND_BIBLE].
     The writer's sentence patterns sound like: [VOICE_FINGERPRINT samples].
     Reject and regenerate if the output violates the SCAN CHECKLISTs."

COMPATIBILITY:
  Not every platform supports every content type. Validate against PLATFORM_CONTENT_COMPATIBILITY
  before generation. The system should never attempt a content type the platform doesn't support
  (e.g., a Carousel on Reddit or a Text post on TikTok).

REJECTION CRITERIA (apply after generation, before returning to user):
  - Violates a hard platform constraint (over char limit, wrong format).
  - Contains a phrase listed in BRAND_BIBLE.banned_phrases.
  - Triggers an anti-pattern from the target platform's or content type's ANTI-PATTERNS section.
  - Uses a CTA pattern not approved for the platform.
  - Fails any item in the platform's or content type's SCAN CHECKLIST.

If rejected, regenerate up to 2 times. If still failing, return:
  1. The best draft attempted (not the last one — the one closest to passing all checks).
  2. The list of failed checks, named explicitly.
  3. A suggested fix for each failed check, expressed as a concrete edit.
     Examples:
       - "Hook exceeds 10 words: cut 'Today I want to talk about' from the opening."
       - "Em dash present in body: replace ' — ' on line 4 with a period."
       - "CTA is statement-format: rewrite 'Try it today' as a question like 'What would you cut first?'"
  4. A confidence score (0 to 100) on whether the draft is salvageable manually vs needs a full rewrite.

This gives the operator enough context to approve manually, steer the next attempt, or kill the draft.

ANTI-AI WRITING RULES:
  Apply the HUMANIZE_RULES (injected separately into the prompt) to all
  generated output. These rules take precedence over content_type defaults
  for stylistic choices but are subordinate to learned_overrides for any
  given client.

  When the HUMANIZE_RULES conflict with PLATFORM_TONE rules (e.g., LinkedIn
  saying "use bold for impact" vs HUMANIZE saying "no mid-paragraph bolding"),
  HUMANIZE wins by default unless learned_overrides for the client say
  otherwise.
`;

export const CONTENT_TYPE_RULES: Record<ContentTypeTaxonomy, string> = {
  ugc: `
UGC (SCRIPTED VIDEO) FORMAT RULES

DEFINITION:
  Spoken video content shot in selfie or talking-head mode. Applies to TikTok videos, Instagram Reels,
  Threads video, LinkedIn native video, and Facebook video. The script is what someone says on camera,
  not what they would write in a caption.

STRUCTURE:
  HOOK (first 0 to 3 seconds, ~5 to 10 spoken words)
  BODY (3 to 45 seconds depending on platform, broken into beats)
  CTA (final 3 to 5 seconds, organic-feeling)

SPOKEN CADENCE (mandatory):
  - Use contractions ("I'm", "you're", "doesn't", "can't"). Written-out forms sound robotic on camera.
  - Sentence fragments are encouraged. People talk in fragments.
  - One idea per sentence. No compound clauses with multiple "and"s.
  - Each sentence should make the viewer want the next sentence.

HOOK RULES:
  - Must pass the 0.5-second swipe test: "Would a stranger keep watching past the first half-second?"
  - Good hook patterns: specific confession, surprising number, pattern interrupt, contrarian setup.
  - Hook is the only thing the viewer hears with 100% attention. Spend disproportionate effort here.

ON-SCREEN TEXT OVERLAYS:
  - Reinforce the spoken word, never repeat it verbatim.
  - 3 to 5 words max per overlay.
  - One overlay per beat (~3 to 5 seconds).
  - Use overlays for: numbers, key phrases, timestamp markers, callouts.

CTA RULES:
  - Organic, not ad-like. Frame as conversation or invitation, not transaction.
  - Good: "Comment X if you've been here", "Save this for next sprint", "Follow for more".
  - Bad: "Click the link in bio to purchase", "Visit our website".

OUTPUT BUNDLE:
  A UGC generation call must return three artifacts:
    1. SCRIPT: the spoken words, broken into HOOK / BODY / CTA sections
    2. OVERLAYS: 3 to 8 on-screen text snippets with rough timing
    3. CAPTION: 1 to 3 sentences for the post description

ANTI-PATTERNS (reject and regenerate):
  - Written-text language ("Today I'd like to discuss...")
  - Hook longer than 10 spoken words
  - Overlays that repeat the spoken word verbatim
  - Direct sales CTAs
  - Third-person voice ("Helm helps founders...")
  - Generic motivational scripts

SCAN CHECKLIST:
  [ ] Hook ≤10 spoken words, passes 0.5-second swipe test
  [ ] Script uses contractions and fragments
  [ ] Overlays ≤5 words each, don't repeat spoken word verbatim
  [ ] Caption extends the video, doesn't summarize it
  [ ] First-person voice throughout
`,

  carousel: `
CAROUSEL FORMAT RULES

DEFINITION:
  Multi-slide static content. Applies to Instagram carousels, LinkedIn document/PDF posts,
  Facebook image carousels, and Twitter long-form (which behaves similarly). Each slide is a discrete unit;
  together they tell a sequential story or deliver a structured argument.

STRUCTURE:
  COVER SLIDE (slide 1)         the hook + the promise. Treat it like a single-tweet hook.
  BODY SLIDES (slides 2 to N-1) each delivers one idea, fully standalone, builds toward the payoff.
  FINAL SLIDE (slide N)         the payoff, summary, or CTA.

SLIDE-LEVEL RULES:
  - Every slide must be readable in isolation. Carousel completion rates are low; don't bury the payoff.
  - One idea per slide. If a slide has two ideas, split it.
  - Visual hierarchy: 1 bold headline (8 words max), 1 to 3 lines of supporting body, optional accent
    (number, icon, emoji).
  - Each slide should end on a beat that pulls the reader to swipe (curiosity, partial reveal, "but here's
    where it gets interesting").

COVER SLIDE RULES:
  - Promise a specific benefit or insight (see CONTENT_TYPE_EXAMPLES for good vs bad cover patterns).
  - Include a swipe cue (visual arrow, "1/10" counter, or text like "Swipe →").
  - Avoid putting the punchline on the cover. Save it for the final slide.

OPTIMAL LENGTH (platform overrides this):
  - Default range: 6 to 10 slides.
  - Platform overrides: Instagram up to 10 slides, LinkedIn 8 to 12 slides.

CTA SLIDE:
  - Final slide always carries the CTA or the takeaway.
  - For LinkedIn document posts: pair the CTA with the post body's hashtag/link.
  - Avoid "click the link" CTAs inside the carousel itself. Direct readers to the post body or comments.

ANTI-PATTERNS (reject and regenerate):
  - Cover slide that buries the hook (e.g., "Some thoughts on marketing")
  - Slides longer than 30 words of body text
  - More than one idea per slide
  - Final slide without a CTA or payoff
  - Slides that only read as a sequence (no standalone value)

SCAN CHECKLIST:
  [ ] Cover slide promises a specific benefit
  [ ] Each interior slide delivers one standalone idea
  [ ] Slide count within platform optimal range
  [ ] Final slide has CTA or payoff
  [ ] Visual hierarchy clear on every slide
`,

  photo: `
PHOTO (SINGLE IMAGE) FORMAT RULES

DEFINITION:
  A single still image with a supporting caption. Applies to Instagram single photos, Facebook photo posts,
  LinkedIn image posts, X tweets with attached image. The image and caption work together; neither carries
  the post alone.

CAPTION CARRIES THE WEIGHT:
  Unlike video or carousel, the still image cannot create curiosity by itself. The caption does the
  heavy lifting for engagement.
  Treat the first line of the caption as the hook (same rules as the platform's text post hook).

IMAGE AND CAPTION RELATIONSHIP:
  - Image complements or contrasts the caption. Never duplicates it.
  - Best: image creates a question, caption answers it. Or caption sets up a tension, image is the punchline.
  - Worst: image is generic stock that doesn't add information (algorithm de-prioritizes these).

ALT TEXT (mandatory where supported):
  - Describe the image in 1 to 2 sentences for accessibility and search.
  - Instagram, LinkedIn, and Facebook all surface alt text in search and AI summaries.
  - Format: "Photo of [subject] showing [key detail]. [Optional context.]"

CAPTION STRUCTURE (defers to platform):
  - First line: hook (must work standalone before truncation cut).
  - Body: defers to platform-specific length and tone.
  - CTA: defers to platform conventions.

WHEN PHOTO IS THE RIGHT CHOICE:
  - Strong visual story (product shot, behind-the-scenes, before/after, screenshot of a result).
  - Tweet or post that wants to slow the scroll without committing to video.
  - Announcement or milestone where the image is the artifact (a screenshot of a record day,
    a press mention, etc.).

WHEN PHOTO IS THE WRONG CHOICE:
  - Long explanation (use carousel or video).
  - Generic stock or AI-generated illustration with no specific tie to the message.
  - Content that would be flatter without the visual context.

ANTI-PATTERNS (reject and regenerate):
  - Generic stock photography
  - Image and caption that say the same thing
  - Caption with no hook in the first line
  - Missing alt text on platforms that support it
  - More than 3 emojis in caption

SCAN CHECKLIST:
  [ ] Image complements caption, doesn't duplicate it
  [ ] Caption hook in first line passes platform's truncation test
  [ ] Alt text present (on supported platforms)
  [ ] Caption length matches platform optimal
  [ ] CTA appropriate for platform
`,

  text: `
TEXT (TEXT-ONLY POST) FORMAT RULES

DEFINITION:
  A post that lives or dies entirely on the words. No image, no video, no carousel to lean on.
  Applies to LinkedIn text posts, X tweets and threads, Threads posts, Facebook text posts,
  Reddit posts (which are almost always text-led).

THE WORDS DO ALL THE WORK:
  Without a visual, the hook must be sharper, the white space must be more deliberate, and every
  line must earn its place.
  Treat text posts as the highest bar of the four content types.

HOOK RULES (stricter than photo or carousel):
  - First line must stop the scroll without any visual support.
  - Bold claim, specific number, contrarian take, or micro-confession.
  - See CONTENT_TYPE_EXAMPLES for good vs bad hook patterns.

WHITE SPACE IS THE DESIGN:
  - Paragraphs of 1 to 3 lines max. Aggressive line breaks.
  - Use blank lines between every idea.
  - Long paragraph blocks tank engagement on every platform.

QUOTABLE LINES:
  - Every text post should contain at least one line that could be screenshotted and shared standalone.
  - These are the lines that get quote-tweeted, screenshotted to Instagram Stories, or pulled into
    "best of" newsletters.
  - Place quotable lines on their own paragraph break to make them easy to extract.

LENGTH (defers to platform):
  - Defers to PLATFORM_TONE_INSTRUCTIONS for char/word budget.
  - General: shorter than carousel scripts, longer than UGC scripts.

CTA RULES (defers to platform):
  - Always present.
  - Question-format outperforms statement-format on every platform.

ANTI-PATTERNS (reject and regenerate):
  - Dense paragraphs over 3 lines
  - No quotable line in the entire post
  - Generic opener ("In today's world...", "Lately I've been thinking...")
  - First line that requires the second line to make sense
  - Missing CTA at the end

SCAN CHECKLIST:
  [ ] First line stops the scroll on its own (no visual support needed)
  [ ] Paragraphs ≤3 lines each, white space between every idea
  [ ] At least one quotable standalone line
  [ ] CTA at the end
  [ ] Length matches platform optimal
`,
};

// ============================================================
// CONTENT_TYPE_EXAMPLES
//
// PR Sprint 7.13 v2 — concrete good/bad example pairs per content
// type. Kept in a separate map so they can be toggled on/off via
// the `includeExamples` flag in buildGenerationPrompt(). Default
// is ON in production because examples materially improve
// generation quality (LLMs pattern-match on them). Toggle OFF
// only in dev/test loops where you want shorter prompts and
// faster iteration — quality drop is measurable.
// ============================================================

export const CONTENT_TYPE_EXAMPLES: Record<ContentTypeTaxonomy, string> = {
  ugc: `
HOOK EXAMPLES (cross-platform UGC):
  Good: "I used to open 7 tabs just to tweet once. Now I open 1."
  Bad:  "Today I want to talk about productivity tools for founders."

  Good: "I spent 156 hours a year switching marketing tools. I'm a solo founder."
  Bad:  "Hey everyone, so I've been thinking about marketing tools lately."

SPOKEN CADENCE EXAMPLES (spoken vs written-style):
  Good (spoken): "I dropped Buffer. Switched to one tool. Saved 2 hours a week."
  Bad (written): "I have decided to discontinue my Buffer subscription and migrate to a consolidated platform."

  Good (spoken): "Here's the part nobody tells you."
  Bad (written): "There is an aspect of this workflow that is often omitted from the discussion."

ON-SCREEN OVERLAY EXAMPLES (reinforce, don't repeat):
  Good: Spoken: "I dropped Buffer last month."        Overlay: "BUFFER ❌"
  Bad:  Spoken: "I dropped Buffer last month."        Overlay: "I dropped Buffer last month"

  Good: Spoken: "Saved 2 hours a week, every week."   Overlay: "2 HRS/WEEK"
  Bad:  Spoken: "Saved 2 hours a week, every week."   Overlay: "Saved 2 hours every week"

CTA EXAMPLES:
  Good: "Comment 'stack' if you want my replacement list."
  Bad:  "Click the link in bio to sign up for our product."
`,

  carousel: `
COVER SLIDE EXAMPLES:
  Good: "How I cut my marketing stack from 7 tools to 1 (and what I lost)"
  Bad:  "Marketing tips for founders"

  Good: "The $23k/year I was wasting on tool sprawl (with the math)"
  Bad:  "Why automation matters"

  Good: "I shipped content twice a week for 4 months. Here's the system."
  Bad:  "Content creation strategies"

SLIDE STRUCTURE EXAMPLE (LinkedIn carousel, 10 slides):
  Slide 1 (cover):   "How I cut my marketing stack from 7 tools to 1 (4 months in)"
  Slide 2:           "Tool #1: Buffer. Why I dropped it: scheduling without context is calendar Tetris."
  Slide 3:           "Tool #2: ChatGPT for marketing. Re-briefing every session cost me 45 min/week."
  Slide 4:           "Tool #3: Notion. Brand guide nobody updated. Voice drifted in 6 weeks."
  Slide 5:           "Tool #4: Canva. Beautiful posts. Zero strategic insight on what to make next."
  Slide 6:           "Tool #5: Buffer analytics. Numbers without context = guessing."
  Slide 7:           "Tool #6: Google Docs. Drafts that died because nobody knew where they lived."
  Slide 8:           "Tool #7: A spreadsheet. The least useful tool in the stack."
  Slide 9 (twist):   "What I lost: nothing. What I gained: 5 hours a week and a system I can hand off."
  Slide 10 (CTA):    "Want my replacement framework? Comment 'stack' below."

CTA SLIDE EXAMPLES:
  Good: "Want the full breakdown? Comment 'audit' and I'll send the template."
  Bad:  "Click the link in our bio to learn more about our software solution."

  Good: "Tag a founder who needs to see this."
  Bad:  "Like and share if you found this helpful! 🚀"
`,

  photo: `
PHOTO + CAPTION PAIR EXAMPLES:
  Good:
    Image: Screenshot of 7 open browser tabs, all marketing tools.
    Caption first line: "This is what writing one tweet looks like. I time-tracked it."
  Bad:
    Image: Generic stock photo of a person at a laptop with a coffee.
    Caption first line: "Marketing is hard. Here are some tips."

  Good:
    Image: Side-by-side screenshot of a founder's calendar before and after consolidating tools.
    Caption first line: "Same week. Same workload. One screenshot is from before I dropped 6 tools."
  Bad:
    Image: AI-generated abstract illustration of "productivity".
    Caption first line: "Productivity is about more than just time management."

WHY THE GOOD ONES WORK:
  The image is specific (a real screenshot, a real before/after) and the caption creates a question
  the image partially answers. The viewer has to read more to get the full payoff.

WHY THE BAD ONES FAIL:
  Stock or AI illustration adds no information. The caption could appear on any post. The algorithm
  penalizes this combination because dwell time stays low and shares stay near zero.
`,

  text: `
HOOK LINE EXAMPLES:
  Good: "I cut my marketing stack from 7 tools to 1 last month. Revenue went up 14%."
  Bad:  "Some thoughts on marketing optimization for solo founders."

  Good: "Your CRM is lying to you about pipeline health."
  Bad:  "Have you ever wondered if your CRM data is accurate?"

  Good: "I spent $11,200 on Buffer over 4 years. I deleted my account last week."
  Bad:  "Excited to share my journey of consolidating marketing tools."

QUOTABLE LINE EXAMPLES (place on their own paragraph break):
  Good: "Your marketing stack isn't your competitive advantage. Your judgment is."
  Good: "If your system requires you to remember which tab is which step, it's not a system."
  Good: "$23,400 a year of founder time burned on tool overhead. That's a feature you didn't ship."

CTA EXAMPLES:
  Good (question):     "What's the worst tool you've replaced this year?"
  Good (specific ask): "Drop your current stack in the comments and I'll tell you what I'd cut."
  Bad (statement):     "Try our product today, it's the best on the market."
  Bad (vague):         "Let me know your thoughts in the comments!"
`,
};

// PR Sprint 7.13 — TikTok extended to ['ugc', 'carousel', 'photo'].
// Python source had ['ugc'] only because the v1 TikTok integration
// shipped UGC first; Sprint 7.12 added the other two formats to
// content_types and exposed them in the Generator.
export const PLATFORM_CONTENT_COMPATIBILITY: Record<
  Platform,
  ContentTypeTaxonomy[]
> = {
  instagram: ['ugc', 'carousel', 'photo'],
  linkedin: ['ugc', 'carousel', 'photo', 'text'],
  x: ['ugc', 'photo', 'text'],
  threads: ['ugc', 'photo', 'text'],
  facebook: ['ugc', 'carousel', 'photo', 'text'],
  reddit: ['text'],
  tiktok: ['ugc', 'carousel', 'photo'],
};

export const PLATFORM_TONE_INSTRUCTIONS: Record<Platform, string> = {
  instagram: `
INSTAGRAM TONE & FORMAT RULES

NATIVE CONTEXT:
  Visual-first platform. The post text supports the image or video, not the other way around.
  Captions truncate after ~125 characters in feed. The first 1 to 2 lines are what 90% of viewers see.
  Engagement is driven primarily by saves and shares, not likes. Captions that prompt "save for later" outperform.

HOOK (first 1 to 2 lines, before "more"):
  Must work standalone before the truncation cut. Treat it like a tweet that has to earn the tap.
  Good hook patterns: bold statement, surprising number, contrarian observation, micro-story opener.
  First-person is fine when the post is a personal story. Avoid starting with the brand name in a corporate framing
  (e.g., "At Helm, we believe...").

  Good hook example:
    "I spent 2.4 hours last week opening tabs. Not coding. Just opening tabs."
  Bad hook example:
    "Today I want to share some thoughts on context switching for founders."

BODY:
  Captions can run up to 2,200 characters but must read like one person talking, not a press release.
  Aggressive line breaks. Paragraphs of 1 to 3 lines. White space drives readability.
  Story arcs outperform listicles. If you must list, keep it under 5 items.
  Emojis: optional, never required. Cap at 3 per caption. Use only when they replace a word or add meaning.

HASHTAGS:
  3 to 5 highly relevant hashtags at the very end (the old advice of 10 to 30 is outdated for accounts under 100k followers).
  Mix: 1 to 2 niche-specific + 2 to 3 mid-volume topical. Skip giant-volume tags (#marketing alone buries the post).

CTA:
  Soft and conversation-driven. Examples: "Drop your stack in the comments", "Save this if you've been here",
  "What's the worst tool you've replaced?"
  Avoid direct sales CTAs in caption. Link goes in bio.

FORMAT VARIANTS:
  Reels: hook in first 3 seconds (visual + opening words). Caption echoes hook, doesn't repeat dialogue.
  Carousels: each slide must stand alone. Slide 1 is the hook, last slide is the CTA or payoff. Max 10 slides.
  Single photo: one strong caption, no carousel scaffolding.
  Story: bypasses this ruleset; use casual fragments and stickers (separate ruleset).

AUTHENTICITY MARKERS (mandatory for Instagram captions):
  - Caption should include at least one parenthetical aside or specific personal
    detail (a date, a place, a name, a tool).
  - Acceptable to use lowercase or mixed case throughout.
  - Voice should feel like a story being told to one specific friend, not
    narrated to an audience.
  - Numbers should hedge or have specific context ("3 weeks ago", "about 200").
  - Acceptable to break the caption with a line like "anyway" or "idk why
    I'm sharing this but".

ANTI-PATTERNS (reject and regenerate):
  - "Excited to share", "Thrilled to announce", "Humbled to"
  - Starting with brand name in corporate voice
  - Hashtag walls inside the caption body
  - More than 3 emojis
  - Generic motivational openers ("Success is not...")
  - Em dashes used for breath-pause rhythm

SCAN CHECKLIST before output:
  [ ] First 125 chars stop the scroll
  [ ] Brand voice signals from BRAND_BIBLE present
  [ ] Hashtags 3 to 5, at the end only
  [ ] CTA present and conversational
  [ ] No anti-patterns triggered
`,

  linkedin: `
LINKEDIN TONE & FORMAT RULES

NATIVE CONTEXT:
  LinkedIn rewards dwell time inside the post itself. The algorithm cuts after ~3 lines with a "see more" tap.
  The first 3 lines are everything. Text-only posts and document/carousel posts outperform link posts.

HOOK (first 3 lines, roughly 210 chars):
  The first line must stand alone. Use the open-loop technique: tease the insight, deliver in the body.
  Good hook patterns: bold claim, counterintuitive statement, specific number, micro-story opener.
  Provocative yes/no questions are OK ("Is your CRM lying to you?"). Generic open questions are not
  ("Have you ever felt overwhelmed?").

  Good hook example:
    "I cut my marketing tool stack from 7 to 1 last month.
     Revenue went up 14%.
     Here's what changed."
  Bad hook example:
    "Excited to share my journey of optimizing my marketing workflow!"

BODY:
  Optimal length: 1,300 to 2,000 characters. Under 600 reads like a tweet. Over 2,500 loses readers.
  Short paragraphs, 1 to 3 lines each. Aggressive white space.
  First person. Personal stories outperform generic advice ("I learned X" beats "You should do X").
  Numbers, dollar amounts, and time deltas drive credibility. Use them liberally when accurate.

HASHTAGS:
  0 to 3 hashtags, at the very end. LinkedIn deprioritized hashtags throughout 2024 and 2025.
  Sometimes zero hashtags outperforms 3. Use only specific, low-volume tags.

CTA:
  Question-format works best. "What's your take?", "Agree or disagree?", "Drop a comment if this resonates."
  Question CTAs outperform statement CTAs.
  Never include external links inside the post body (drops reach by 50% or more). Put links in the first comment.

FORMAT VARIANTS:
  Carousel/document post: each slide is a standalone insight. Cover slide promises a clear benefit.
    Last slide has the CTA. 8 to 12 slides optimal.
  Pure text post: follow the rules above.
  Video post: native video, captions baked in, hook in first 3 seconds.

AUTHENTICITY MARKERS (mandatory for LinkedIn):
  - Include at least one specific personal detail: a real date, a real name,
    a real city, a specific tool, a specific dollar amount with context.
  - Acceptable to admit uncertainty ("I'm not sure if this is right but",
    "honestly still figuring this out", "could be wrong").
  - Numbers should be defensible: include source, context, or method
    ("based on the last 30 posts", "I time-tracked it for 2 weeks").
  - Maximum 2 headers per post (LinkedIn long-form rarely uses headers).
  - Avoid pre-constructed quotable lines that are clearly designed for
    screenshots. Insights should emerge from the story, not be bumper stickers.

ANTI-PATTERNS (reject and regenerate):
  - "Excited to announce", "Thrilled to share", "I'm humbled to..."
  - Corporate-speak: "synergy", "leverage", "best-in-class", "robust", "holistic"
  - Posts that read like an HR newsletter
  - Generic motivational closers ("Keep pushing!", "Stay focused!")
  - Em dashes used for breath-pause rhythm
  - External links inside the body
  - More than 3 hashtags

SCAN CHECKLIST before output:
  [ ] First 3 lines work as a standalone hook
  [ ] Length between 1,300 and 2,000 chars
  [ ] 0 to 3 hashtags at the end
  [ ] First-person voice throughout
  [ ] CTA is a question
  [ ] No anti-patterns triggered
`,

  x: `
X (TWITTER) TONE & FORMAT RULES

NATIVE CONTEXT:
  X feed is fast-scroll. Tweets live or die in the first 5 words.
  Engagement comes from replies and retweets more than likes.
  X Premium accounts can post up to 25,000 chars (long-form). Default to 280-char single tweets unless explicitly
  told to write long-form.

CHARACTER BUDGETS:
  Single tweet: max 280 chars including spaces. No exceptions.
  Long-form (Premium only, opt-in): 280 to 4,000 chars. Different ruleset below.
  Thread: each tweet 240 to 280 chars (leave room for retweet quote).

HOOK (first 5 words):
  Every tweet needs a punch in the first 5 words.
  Good hook patterns: contrarian opinion, specific number, sharp observation, micro-confession.
  Thread hook (tweet 1) must promise a payoff worth scrolling for.

  Good single-tweet example:
    "Your marketing stack is 11 tools.
     Your team is one person.
     The math doesn't work."
  Bad single-tweet example:
    "Excited to share some thoughts on the importance of consolidating your marketing tools as a solo founder."

BODY (single tweet):
  Direct, opinionated, conversational. Hot takes outperform balanced takes.
  Fragments are fine. Sentence fragments are encouraged.
  Write how a smart person texts, not how a marketer writes.
  Specific numbers beat vague claims.

THREADS (2 to 8 tweets recommended; 5 to 8 optimal):
  Tweet 1: hook that earns the "show this thread" click.
  Tweets 2 through N: each must deliver a self-contained beat AND make the reader want the next one.
    End each tweet on tension or specificity.
  Last tweet: payoff, takeaway, or CTA.
  Avoid threads over 10 tweets unless the content genuinely earns it.

HASHTAGS:
  Zero by default. Hashtags look spammy on X in 2025.
  Exception: branded hashtag for a launch or campaign, max 1.

CTA:
  Conversational. "What's your stack?", "What am I missing?", "Drop yours below."
  Direct sales CTAs underperform organically. Keep them for replies and quote-tweet boosts.

LONG-FORM (Premium only):
  Treat as a LinkedIn-style post with X's punchier rhythm.
  Hook in first 100 chars. White space between sections. No headers.
  Use only when content genuinely needs more than a thread (data drops, full essays, transcripts).

AUTHENTICITY MARKERS (mandatory for X / Twitter):
  - For threads, include at least one tweet that breaks the polished arc:
    "wait, also", "actually", "hmm", or a short tangent.
  - Lowercase first letter is acceptable and often signals authenticity on X.
  - Acceptable to abandon a thought mid-tweet or end with "..." or "idk".
  - For single tweets, fragments and incomplete sentences are encouraged.
  - Replies and quote-tweets are conversational, never press releases.
  - Numbers should hedge ("around X", "like 7 tools", "maybe 200 followers").

ANTI-PATTERNS (reject and regenerate):
  - "Excited/thrilled/humbled" openers
  - Hashtag stacks (#marketing #growth #startup)
  - Generic motivational tweets
  - Tweets over 280 chars unless long-form mode is explicitly enabled
  - Three-emoji headlines
  - Threads with weak hook tweets
  - "We" voice for solo-founder accounts (use "I")

SCAN CHECKLIST before output:
  [ ] Single tweet: ≤280 chars, hook in first 5 words
  [ ] Thread: tweet 1 earns the click; each subsequent tweet ends on tension
  [ ] Zero hashtags (unless branded)
  [ ] No "excited/thrilled/humbled"
  [ ] First-person if account is solo-founder
`,

  threads: `
THREADS TONE & FORMAT RULES

NATIVE CONTEXT:
  More casual than Instagram, less polished than LinkedIn, slightly less spiky than X.
  Tone: talking to friends, not presenting to an audience.
  Algorithm rewards replies and reposts over likes. Conversation-driven posts outperform monologues.

CHARACTER BUDGETS:
  Max per post: 500 chars (hard cap).
  Optimal sweet spot: 100 to 200 chars per post. Most high-engagement Threads posts are short.
  Threads supports threading (chained replies). Use 2 to 5 short connected beats when needed.

HOOK (first line):
  Same "see more" mechanic as Instagram. First line must hold attention before the cut.
  Good hook patterns: unfinished thought, micro-observation, "I've been thinking about...", contrarian take in 8 words.

  Good hook example:
    "I've been thinking about why founders quit X for Threads.
     It's not the algorithm.
     It's the audience cosplay."
  Bad hook example:
    "Today I want to discuss the differences between social media platforms for founders."

BODY:
  1 to 3 short paragraphs. Most posts should be under 200 chars total.
  Tone: unfiltered, in-progress, conversational. "I think" and "maybe" are acceptable. Polish is suspicious here.
  Fragments and ellipses work better than complete sentences.

HASHTAGS:
  Zero. Threads doesn't surface hashtags in any meaningful way.

CTA:
  Genuine open-ended questions. "What am I missing?", "Anyone else seeing this?", "Tell me I'm wrong."
  Polls drive replies. Use when the question has 2 to 4 clear options.

THREADING (chained replies):
  When a thought needs more than 500 chars, chain it. Each post 100 to 200 chars. 2 to 5 posts max.
  Each chained reply must read as a standalone observation, not "part 2 of 5".

AUTHENTICITY MARKERS (mandatory for Threads):
  - Lowercase or mixed case is acceptable and often signals authenticity.
  - Acceptable to start with "ok so", "wait", "hot take:", or "thinking about".
  - Fragments, ellipses, and incomplete sentences are encouraged.
  - No need for grammatically complete sentences.
  - Acceptable to end with "idk", "anyway", or just stop.
  - Numbers should hedge.

ANTI-PATTERNS (reject and regenerate):
  - Overly polished marketing copy (Threads readers smell it instantly)
  - Hashtag use
  - Long monologues over 500 chars without chaining
  - Generic motivational
  - Recycled LinkedIn-style hooks ("3 lessons I learned...")
  - Third-person voice

SCAN CHECKLIST before output:
  [ ] ≤500 chars per post
  [ ] Tone reads in-progress, not polished
  [ ] First line earns the "see more"
  [ ] Zero hashtags
  [ ] CTA is a real question
  [ ] First-person voice
`,

  facebook: `
FACEBOOK TONE & FORMAT RULES

NATIVE CONTEXT:
  Audience skews older (35+) and prefers narrative, community-driven content over short punchy takes.
  Organic reach for business Pages is 1 to 3%. Facebook is most useful for Groups, Events, and paid distribution.
  Default mode for Helm-managed clients is Groups, not Page posts, unless explicitly told otherwise.

POSTING MODE:
  Groups: active community, organic reach is healthy here. This is the default.
  Pages: only for clients running paid amplification on top. Write Page posts assuming they will be boosted.

HOOK (first 1 to 2 lines):
  Less aggressive than X or Instagram. Facebook readers tolerate slower openers.
  Good hook patterns: relatable observation, story opener, community question.

  Good hook example:
    "Has anyone else's calendar quietly turned into 6 client check-ins per week?
     Asking for me."
  Bad hook example:
    "Excited to share our latest blog post on calendar optimization!"

BODY:
  Two length modes both work:
    Short: 40 to 80 words for quick engagement.
    Long-form narrative: 300 to 500 words for stories and case studies.
  Tone: warm, community-oriented, less edgy than X. Like sitting at a table with friends, not on a stage.
  Links work on Facebook (unlike Instagram). Include the URL if relevant and contextual.

HASHTAGS:
  1 to 3 broad hashtags max. Hashtags don't drive significant discovery on Facebook.

CTA:
  Community-response style. "Has this happened to you?", "What do you think?",
  "Drop your version in the comments."
  Group-specific CTAs work well. Example: "Tag someone running an agency below."

AUTHENTICITY MARKERS (mandatory for Facebook):
  - Include at least one specific personal detail (where, when, who).
  - Conversational warmth over editorial polish.
  - Acceptable to ramble slightly or include a side anecdote.
  - Numbers should hedge ("about", "around", "I think").

ANTI-PATTERNS (reject and regenerate):
  - Sharp X-style takes (feel out of place on Facebook)
  - "Excited/thrilled/humbled" openers
  - Hashtag stacks
  - Sales-heavy CTAs without context
  - Posts that read like press releases
  - Insider startup jargon without context (audience skews general)

SCAN CHECKLIST before output:
  [ ] Default mode (Group vs Page) set correctly
  [ ] Length: 40 to 80 words OR 300 to 500 words
  [ ] Tone: warm, community-oriented
  [ ] 1 to 3 broad hashtags
  [ ] CTA invites community response
`,

  reddit: `
REDDIT TONE & FORMAT RULES

NATIVE CONTEXT:
  Reddit is the most anti-marketing platform on the public web. Any whiff of promotion gets downvoted.
  The title decides the post's fate. Specific + intriguing beats generic + promotional every time.
  Comments often drive more value than original posts. Support both modes.

TONE:
  Educational, helpful, peer-to-peer. Write as a community member sharing genuine experience, not as a brand.
  Lead with value. The insight, lesson, or data comes first. The product (if mentioned at all) comes last as
  context, never as the point.
  Acceptable to disclose: "I'm building [X]" works in many startup/indie subs if substantive content comes first.

TITLE:
  Title is everything. Spend disproportionate effort here.
  Good title formats:
    "Here's what I learned after [N] months of [activity]"
    "I tried [X] and got [specific result]. Here's what happened."
    "Unpopular opinion: [specific contrarian take]"
    "How [audience] should think about [topic] (a year of data)"

  Good title example:
    "Cut my marketing stack from 7 tools to 1. Here's what I lost and what I gained (4 months in)."
  Bad title example:
    "How to streamline your marketing! A comprehensive guide for founders"

BODY:
  Use Reddit markdown: ## for section headers, * for bullets, > for quotes, code blocks for snippets.
  Open with the takeaway or the situation. No corporate preamble.
  Specific numbers, real failures, and concrete examples drive upvotes. Vague generalities get downvoted.
  Length: 300 to 1,500 words depending on sub. r/Entrepreneur tolerates longer; r/SaaS trends shorter.

SUBREDDIT PROFILES (apply alongside this ruleset based on target_sub):
  r/indiehackers: tolerates "I built X" framing if substantive. MRR numbers, churn data, and failure stories
    perform well. Audience is solo founders and tiny teams.
  r/SaaS: more critical of promotion. Lead heavily with data or a real failure. Audience is founders + employees
    + investors.
  r/Entrepreneur: broader audience, less technical. Stories of journey work better than technical deep-dives.
    More tolerance for big-picture framing.
  r/marketing: defensive about over-simplified takes. Technical specificity earns credibility.
    Avoid "marketing 101" content.
  r/startups: similar to r/Entrepreneur. Tolerates fundraising and growth stories. Less patient with consumer plays.
  r/smallbusiness: practical, ops-focused, less appetite for funding talk. Lead with bottom-line impact.
  Default if sub unknown: assume strictest interpretation (closest to r/SaaS).

HASHTAGS:
  None. Reddit doesn't support them.

CTA:
  Genuine. "Curious what others have seen", "Happy to share more if useful", "What am I missing?"
  Direct sales CTAs get the post removed. Never link to a product page without context. Linking to a blog post
  or open-source resource is acceptable in some subs.

AUTHENTICITY MARKERS (mandatory for Reddit):
  - Include at least one informal marker: "tbh", "ngl", "imo", "fwiw", "idk".
    These signal real-human voice; their absence is a strong AI tell on Reddit.
  - Include at least one parenthetical aside (like this) or self-correction
    ("actually wait, that's not quite right").
  - Numbers should hedge: "about 9 months", "maybe 7 tools", "I think around X",
    "give or take". Real humans approximate; AI is unnaturally precise.
  - Acceptable to end with "anyway", "idk", or to stop abruptly without a CTA.
  - Acceptable to add an "edit:" line at the bottom (signals real engagement).
  - Avoid pre-constructed quotable lines (especially in blockquotes). Reddit
    explicitly downvotes posts that look like they were written for screenshots.
  - Maximum 2 markdown headers in the entire post. Three or more headers
    in parallel form ("What I X / What I Y / What I Z") is essay-shaped
    and reads as AI.

OVERRIDES TO CONTENT_TYPE_RULES["text"] (Reddit-specific):
  - The QUOTABLE LINES guidance from CONTENT_TYPE_RULES["text"] does NOT apply
    on Reddit. Do NOT include pre-constructed quotable lines designed for
    screenshots. Insights should emerge from concrete data and confession,
    not from crafted bumper stickers.
  - The "punchy one-word emphasis sentences" guidance is suspended on Reddit.
    Use 0 of these. They feel AI-coded in this context.

ANTI-PATTERNS (reject and regenerate):
  - Exclamation points
  - "Game-changing", "revolutionary", "excited to share", "best-in-class"
  - Brand name in the title (unless that IS the topic)
  - Marketing-deck language ("Our value prop is...")
  - Generic listicles ("Top 10 tools you need")
  - Title in title case (most subs use sentence case)
  - Any direct product pitch without value-first preamble

SCAN CHECKLIST before output:
  [ ] Title specific + intriguing, sentence case
  [ ] Body leads with value, not the product
  [ ] Reddit markdown formatting present (## headers, * bullets)
  [ ] Subreddit profile applied
  [ ] Zero exclamation points
  [ ] No banned words
`,

  tiktok: `
TIKTOK TONE & FORMAT RULES  (LIVE as of v3.0)

NATIVE CONTEXT:
  Video-first platform. Even educational content must entertain. Pure information dies; entertainment
  wrapped around information thrives.
  The first 3 seconds determine 80%+ of completion rate. The first 0.5 seconds determine whether the
  user even starts watching.
  Captions, on-screen text, and hashtags supplement the video. They do not carry it.

OUTPUT TYPES (generate all three for a TikTok post):
  1. UGC SCRIPT       the spoken words and on-screen text overlay cues
  2. CAPTION          the post description
  3. HASHTAGS         3 to 5 tags, mix of broad and niche

UGC SCRIPT STRUCTURE:

  HOOK (0 to 3 seconds, ~5 to 10 spoken words):
    Must pass the 0.5-second swipe test (see below).
    Good hook patterns:
      Specific confession: "I used to open 7 tabs just to tweet once."
      Surprising number: "I spent 156 hours a year switching tabs. I'm a solo founder."
      Pattern interrupt: "Stop using ChatGPT for marketing. Here's why."
      Contrarian setup: "Everyone's wrong about marketing automation."

    Good hook example:
      "I used to open 7 tabs just to tweet once. Now I open 1. Here's what changed."
    Bad hook example:
      "Today I want to talk about marketing tools for solo founders."

  BODY (3 to 45 seconds):
    Short, punchy sentences. One idea per sentence.
    Spoken cadence: use contractions ("I'm", "you're", "doesn't"). Fragments are encouraged.
    Each sentence makes the viewer want the next sentence. End mini-beats on tension or specificity.
    Concrete numbers and named tools outperform abstract claims.

  CTA (final 3 to 5 seconds):
    Organic, not ad-like.
    Good: "Comment 'stack' if you want the list", "Follow for more solo founder ops",
      "Save this if you've been here."
    Bad: "Click the link in bio to sign up for our product."

ON-SCREEN TEXT OVERLAYS:
  Reinforce the spoken word, never repeat it verbatim.
  3 to 5 words max per overlay.
  One overlay per beat (~3 to 5 seconds).
  Examples that work: timestamps for steps ("0:23 the moment it clicked"), specific numbers,
  key-phrase emphasis.

CAPTION:
  1 to 3 sentences max. Conversational continuation of the video, not a summary.
  Treat as the post-credit scene of the video. Add context, ask a question, or tease the next post.
  Include a soft CTA. Hook the next watch.

HASHTAGS:
  3 to 5 total. Mix:
    1 to 2 broad/trending (#founder, #saas, #marketing)
    2 to 3 niche (#indiehacker, #solofounder, #buildinpublic)
  Don't chase trending hashtags unrelated to content. Algorithm penalizes mismatched tags.

TREND-JACKING:
  If a relevant sound trend or format trend is live, ride it. Sound trends drive 2x to 5x more reach
  than original audio.
  Don't force trends. A bad fit hurts more than no trend.

TONE:
  Energetic, direct, first-person. "I" and "you", never "we" or "one".
  Founder to founder, operator to operator. Peer-to-peer always.
  Honesty over polish. Production value matters less than authenticity.

THE 0.5-SECOND SWIPE TEST (mandatory, applied automatically before output):
  Question: "Would a stranger scrolling at 2am keep watching past the first half-second of this video?"
  If the answer is "maybe" or "I'm not sure", regenerate the hook.

ANTI-PATTERNS (reject and regenerate):
  - Written-text language in spoken script ("Today I'd like to discuss...")
  - Hook longer than 10 spoken words
  - Captions that summarize the video instead of extending it
  - Direct sales CTAs ("Click link in bio to purchase")
  - Generic motivational scripts ("Hustle. Grind. Repeat.")
  - Hashtag stacks (more than 5)
  - Overlays that repeat the spoken word verbatim
  - Third-person voice ("Helm helps founders...")

SCAN CHECKLIST before output:
  [ ] Hook ≤10 spoken words, passes 0.5-second swipe test
  [ ] Spoken script uses contractions and fragments
  [ ] On-screen overlays ≤5 words each, don't repeat the spoken word
  [ ] Caption extends the video, doesn't summarize it
  [ ] 3 to 5 hashtags with broad + niche mix
  [ ] First-person voice throughout
  [ ] No anti-patterns triggered
`,
};

// ============================================================
// Error types
// ============================================================

export class UnknownPlatformError extends Error {
  constructor(platform: string) {
    super(
      `Unknown platform: ${platform}. Supported: ${Object.keys(
        PLATFORM_TONE_INSTRUCTIONS,
      )
        .sort()
        .join(', ')}`,
    );
    this.name = 'UnknownPlatformError';
  }
}

export class UnknownContentTypeError extends Error {
  constructor(contentType: string) {
    super(
      `Unknown content_type: ${contentType}. Supported: ${Object.keys(
        CONTENT_TYPE_RULES,
      )
        .sort()
        .join(', ')}`,
    );
    this.name = 'UnknownContentTypeError';
  }
}

export class InvalidContentForPlatformError extends Error {
  constructor(
    public readonly platform: Platform,
    public readonly contentType: ContentTypeTaxonomy,
  ) {
    super(
      `Content type '${contentType}' is not supported on platform '${platform}'. Supported: ${PLATFORM_CONTENT_COMPATIBILITY[
        platform
      ].join(', ')}`,
    );
    this.name = 'InvalidContentForPlatformError';
  }
}

// ============================================================
// Mapping: DB content_types (Sprint 7.0.4 taxonomy) → Python
// taxonomy (this file).
//
// The Generator persists granular content types per platform
// (`reel`, `single_tweet`, `thread`, `text_post`, `single_image`,
// `community_post`, `self_post`, `link_post`, `ugc`, `carousel`,
// `photo`). The platform-tone rule set works in four buckets
// (`ugc | carousel | photo | text`). This map collapses the
// granular type onto the bucket before the validation +
// prompt-build steps run.
// ============================================================

const DB_TO_TAXONOMY: Record<string, ContentTypeTaxonomy> = {
  // Video-script formats → ugc
  reel: 'ugc',
  ugc: 'ugc',
  // Multi-slide formats → carousel
  carousel: 'carousel',
  // Single-image formats → photo
  photo: 'photo',
  single_image: 'photo',
  // Text-only formats → text
  text_post: 'text',
  community_post: 'text',
  self_post: 'text',
  link_post: 'text',
  single_tweet: 'text',
  thread: 'text',
};

export function mapDbContentTypeToTaxonomy(
  dbContentType: string,
): ContentTypeTaxonomy | null {
  return DB_TO_TAXONOMY[dbContentType] ?? null;
}

// ============================================================
// Helper for the generation pipeline.
// ============================================================

export interface BuildGenerationPromptArgs {
  platform: string;
  contentType: string; // already mapped to taxonomy
  brandBible: string;
  voiceFingerprint: string;
  painPoint: string;
  targetSub?: string;
  // PR Sprint 7.13 v2 — whether to inject CONTENT_TYPE_EXAMPLES
  // into the prompt. Default true (production). Set false in
  // dev/test loops where you want shorter prompts and faster
  // iteration. Toggling off will measurably reduce output
  // quality, so only do it intentionally.
  includeExamples?: boolean;
  // PR Sprint 7.22 — F1 preventive humanize. When true (default)
  // HUMANIZE_RULES are embedded directly in the prompt so the
  // model never produces an AI tell to clean up. Toggle false
  // to A/B-compare against the legacy generate-then-clean flow,
  // or to shave ~3.5KB of prompt tokens in dev iteration.
  injectHumanize?: boolean;
  // PR Sprint 7.22 Sprint B — Patch 2 product bridges. The endpoint
  // runs the matcher (Haiku call) BEFORE this function so the result
  // arrives pre-formatted as a PRODUCT_RELEVANCE section string. We
  // splice it between PAIN_POINT and CONTENT_TYPE_RULES when present
  // and empty-string otherwise. Pre-built (not awaited here) so this
  // function stays synchronous and easy to test.
  productRelevanceSection?: string;
}

export function buildGenerationPrompt(
  args: BuildGenerationPromptArgs,
): string {
  const platform = args.platform.toLowerCase() as Platform;
  const contentType = args.contentType.toLowerCase() as ContentTypeTaxonomy;
  const includeExamples = args.includeExamples ?? true;
  const injectHumanize = args.injectHumanize ?? true;

  if (!(platform in PLATFORM_TONE_INSTRUCTIONS)) {
    throw new UnknownPlatformError(platform);
  }
  if (!(contentType in CONTENT_TYPE_RULES)) {
    throw new UnknownContentTypeError(contentType);
  }
  if (!PLATFORM_CONTENT_COMPATIBILITY[platform].includes(contentType)) {
    throw new InvalidContentForPlatformError(platform, contentType);
  }

  const contentRules = CONTENT_TYPE_RULES[contentType];
  const platformTone = PLATFORM_TONE_INSTRUCTIONS[platform];
  const subLine =
    platform === 'reddit' && args.targetSub
      ? `\nTARGET SUBREDDIT: ${args.targetSub}\n`
      : '';

  // Examples block lives between CONTENT_TYPE_RULES and
  // PLATFORM_TONE so the model sees them in the order: rules
  // (what to do) → examples (what good/bad look like) →
  // platform overrides (how this changes per platform). Empty
  // string when toggled off keeps the surrounding string layout
  // stable.
  let examplesSection = '';
  if (includeExamples) {
    const contentExamples = (CONTENT_TYPE_EXAMPLES[contentType] ?? '').trim();
    if (contentExamples.length > 0) {
      examplesSection = `\nCONTENT_TYPE_EXAMPLES for ${contentType.toUpperCase()} (good vs bad pairs to pattern-match against):\n${contentExamples}\n`;
    }
  }

  // PR Sprint 7.22 — F1 preventive humanize. The rules are
  // injected right after PROMPT_COMPOSITION_RULES so the model
  // sees them before any platform/content-specific overrides
  // arrive. When toggled off (rare — A/B testing only), the
  // resulting empty section keeps the surrounding spacing intact.
  const humanizeSection = injectHumanize ? `\n\n${HUMANIZE_RULES}\n` : '';

  // PR Sprint 7.22 Sprint B — Patch 2 product bridges. The matcher
  // ran upstream and returned a formatted PRODUCT_RELEVANCE block (or
  // an empty string when no bridge applied). We splice it between
  // PAIN_POINT and CONTENT_TYPE_RULES so the model sees the product's
  // angle right after it knows what the post is about, but before
  // format mechanics override the framing.
  const productRelevance = args.productRelevanceSection ?? '';

  return `${PROMPT_COMPOSITION_RULES}${humanizeSection}

BRAND_BIBLE:
${args.brandBible}

VOICE_FINGERPRINT (samples of the writer's actual past output):
${args.voiceFingerprint}

PAIN_POINT (what this post is about):
${args.painPoint}
${subLine}${productRelevance}
CONTENT_TYPE_RULES for ${contentType.toUpperCase()} (base format mechanics):
${contentRules}
${examplesSection}
PLATFORM_TONE for ${platform.toUpperCase()} (specialization on top of the content-type rules):
${platformTone}

Now write the ${contentType} for ${platform}. After drafting, run BOTH scan checklists
(the CONTENT_TYPE_RULES checklist and the PLATFORM_TONE checklist). If any item fails,
regenerate. Return the final draft only.
`;
}
