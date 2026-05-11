// PR #60 — Sprint 7.0.4: seed the content_types catalog.
//
// Idempotent: ON CONFLICT (platform, type) DO NOTHING. Re-running
// won't duplicate rows. If we want to UPDATE templates without
// risking divergence, drop + re-seed individually or use a separate
// script.
//
// Each row is a `displayName + description + promptTemplate +
// structureSchema + guidelines` packet that drives a single Opus call.
//
// Run with: `npx tsx scripts/seed-content-types.ts`
import { loadEnvConfig } from '@next/env';

interface SeedRow {
  platform: string;
  type: string;
  displayName: string;
  description: string;
  promptTemplate: string;
  structureSchema: Record<string, unknown>;
  guidelines: string;
  maxLength: number;
  defaultEnabled: boolean;
  displayOrder: number;
}

const SEED: SeedRow[] = [
  // ═══ INSTAGRAM ═══
  {
    platform: 'instagram',
    type: 'reel',
    displayName: 'Reel',
    description: 'Short vertical video (15-90s) with hook, beats, on-screen text',
    promptTemplate: `Generate an Instagram Reel script.

HOOK (first 3 seconds, must stop scroll):
- 1 sentence: question, contrast, or pattern interrupt
- Match brand voice exactly

BEATS (3-5 narrative moments):
- Each 5-10 seconds
- Specific visual action (no vague "show happy people")
- Audio cue per beat where useful

ON-SCREEN TEXT (per beat):
- Max 6 words per overlay
- Visible 3+ seconds
- Reinforces audio narrative

AUDIO SUGGESTION:
- Type: trending pop / upbeat / cinematic / voiceover-only
- Mood matches brand pillars

CAPTION (140-220 chars):
- Hook line, 2-3 value points, 1 CTA, 3-5 relevant hashtags`,
    structureSchema: {
      type: 'object',
      required: ['hook', 'beats', 'caption'],
      properties: {
        hook: { type: 'string', maxLength: 200 },
        beats: {
          type: 'array',
          minItems: 3,
          maxItems: 5,
          items: {
            type: 'object',
            properties: {
              duration: { type: 'string' },
              visual: { type: 'string' },
              audio: { type: 'string' },
            },
          },
        },
        onScreenText: { type: 'array', items: { type: 'string' } },
        audioSuggestion: { type: 'string' },
        caption: { type: 'string', maxLength: 220 },
      },
    },
    guidelines:
      'Vertical 9:16. Hook in 3s. Avoid "Link in bio" overuse — IG suppresses link callouts.',
    maxLength: 220,
    defaultEnabled: true,
    displayOrder: 1,
  },
  {
    platform: 'instagram',
    type: 'carousel',
    displayName: 'Carousel (5-8 slides)',
    description: 'Multi-slide post with cover + value slides + CTA',
    promptTemplate: `Generate Instagram Carousel with 5-8 slides.

SLIDE 1 (COVER — critical for tap-through):
- Big visual title (6 words max)
- Subtitle hint at value (10 words max)
- role: 'cover'

SLIDES 2-7 (VALUE):
- One clear concept per slide
- Title (3-5 words) + body (15-30 words)
- Progression: each slide builds on the previous
- role: 'value'

LAST SLIDE (CTA):
- Recap key value
- Specific action: save, share, follow, link, comment
- No vague "DM me for more"
- role: 'cta'

CAPTION (separate from slides):
- Hook line + 2-3 value points + CTA
- 150-220 chars
- 3-5 hashtags`,
    structureSchema: {
      type: 'object',
      required: ['slides', 'caption'],
      properties: {
        slides: {
          type: 'array',
          minItems: 5,
          maxItems: 8,
          items: {
            type: 'object',
            required: ['title', 'body', 'role'],
            properties: {
              title: { type: 'string' },
              body: { type: 'string' },
              role: { type: 'string', enum: ['cover', 'value', 'cta'] },
            },
          },
        },
        caption: { type: 'string' },
      },
    },
    guidelines:
      'Cover slide drives 80% of engagement. Build narrative arc across slides. End with clear action.',
    maxLength: 220,
    defaultEnabled: true,
    displayOrder: 2,
  },
  {
    platform: 'instagram',
    type: 'photo',
    displayName: 'Single Photo',
    description: 'One image post with strong caption',
    promptTemplate: `Generate Instagram Single Photo post.

IMAGE DIRECTION (1-2 sentences):
- What to shoot/show
- Composition hint (close-up, wide, hand-held vibe)
- Lighting/mood

CAPTION (target 150-220 chars):
- Hook line in FIRST 125 chars (this is what shows before "...more")
- Body: story or value
- CTA at end
- 3-5 hashtags`,
    structureSchema: {
      type: 'object',
      required: ['imageDirection', 'caption'],
      properties: {
        imageDirection: { type: 'string' },
        caption: { type: 'string' },
      },
    },
    guidelines:
      'First 125 chars of caption visible before "...more". Pack hook there.',
    maxLength: 220,
    defaultEnabled: false,
    displayOrder: 3,
  },
  {
    platform: 'instagram',
    type: 'ugc',
    displayName: 'UGC-style script',
    description: 'User-generated content tone (script only; HeyGen integration deferred)',
    promptTemplate: `Generate UGC-style script for Instagram.

OPENING (3-5 seconds):
- Real-person tone (no corporate)
- "OK so let me tell you about…" energy

BODY (15-30 seconds):
- Personal experience framing
- Specific moment/scenario
- Authentic concerns + your solution

CLOSING:
- Casual recommendation
- "Try it and DM me what you think"

This generates SCRIPT only. Future HeyGen integration will turn this into video.`,
    structureSchema: {
      type: 'object',
      required: ['opening', 'body', 'closing'],
      properties: {
        opening: { type: 'string' },
        body: { type: 'string' },
        closing: { type: 'string' },
        recommendedDuration: { type: 'string' },
      },
    },
    guidelines: 'UGC tone = real person talking. Avoid brand-speak.',
    maxLength: 500,
    defaultEnabled: false,
    displayOrder: 4,
  },

  // ═══ FACEBOOK ═══
  {
    platform: 'facebook',
    type: 'reel',
    displayName: 'Reel',
    description: 'Vertical short-form video (FB tolerates longer captions than IG)',
    promptTemplate: `Generate Facebook Reel script. Similar to Instagram Reel but:
- Older audience generally (30-55)
- Caption can be up to ~400 chars
- Less polished production OK

HOOK (3 seconds)
BEATS (3-5 moments with visual + audio)
ON-SCREEN TEXT (max 6 words each)
AUDIO SUGGESTION
CAPTION (up to 400 chars)`,
    structureSchema: {
      type: 'object',
      required: ['hook', 'beats', 'caption'],
      properties: {
        hook: { type: 'string' },
        beats: { type: 'array', items: { type: 'object' } },
        onScreenText: { type: 'array', items: { type: 'string' } },
        audioSuggestion: { type: 'string' },
        caption: { type: 'string' },
      },
    },
    guidelines: 'FB audience often older. Less aggressive on aesthetic than IG.',
    maxLength: 400,
    defaultEnabled: true,
    displayOrder: 1,
  },
  {
    platform: 'facebook',
    type: 'photo',
    displayName: 'Single Photo + Caption',
    description: 'Photo with narrative-style caption',
    promptTemplate: `Generate Facebook Photo post.

IMAGE DIRECTION (1-2 sentences)

CAPTION (200-500 chars):
- Story-style opening
- Build context
- Value or insight
- Soft CTA (FB doesn't like hard sells)
- 0-2 hashtags (FB barely uses them)`,
    structureSchema: {
      type: 'object',
      required: ['imageDirection', 'caption'],
      properties: {
        imageDirection: { type: 'string' },
        caption: { type: 'string' },
      },
    },
    guidelines: 'FB rewards story narrative. Hashtags optional.',
    maxLength: 500,
    defaultEnabled: true,
    displayOrder: 2,
  },
  {
    platform: 'facebook',
    type: 'community_post',
    displayName: 'Community / Discussion post',
    description: 'Discussion-starter post for groups',
    promptTemplate: `Generate Facebook Community/Discussion post.

OPENING (hook for comments): question or relatable scenario
BODY: personal angle + invitation to share
CLOSING: explicit ask — "What's your experience?" / "Tell me below"`,
    structureSchema: {
      type: 'object',
      required: ['opening', 'body', 'closing'],
      properties: {
        opening: { type: 'string' },
        body: { type: 'string' },
        closing: { type: 'string' },
      },
    },
    guidelines:
      'Community posts get engagement via questions. Avoid external links — FB suppresses them.',
    maxLength: 500,
    defaultEnabled: false,
    displayOrder: 3,
  },

  // ═══ LINKEDIN ═══
  {
    platform: 'linkedin',
    type: 'text_post',
    displayName: 'Text Post (long-form)',
    description: 'Professional narrative 150-300 words',
    promptTemplate: `Generate LinkedIn Text Post (150-300 words).

HOOK (line 1-2):
- Question, contrarian take, or specific scenario
- Visible before "...see more"

NARRATIVE BODY (5-8 short paragraphs):
- Personal story, lesson, framework, or insight
- Each paragraph 1-2 lines (mobile-readable)
- Empty line between paragraphs

VALUE/INSIGHT:
- Specific takeaway (avoid vague "be authentic")

CTA (subtle, NOT pushy):
- Question to spark comments
- OR "What's worked for you?"
- DO NOT use "DM me" or "Link in bio"

NO emojis like 🚀 or 💯 (corporate-influencer vibe).
NO bullet-point listicles unless data-heavy.`,
    structureSchema: {
      type: 'object',
      required: ['hook', 'body', 'cta'],
      properties: {
        hook: { type: 'string' },
        body: { type: 'array', items: { type: 'string' } },
        cta: { type: 'string' },
      },
    },
    guidelines:
      'LinkedIn hates salesy tone. Storytelling + insights + comment-driving questions win.',
    maxLength: 1500,
    defaultEnabled: true,
    displayOrder: 1,
  },
  {
    platform: 'linkedin',
    type: 'carousel',
    displayName: 'Carousel (educational)',
    description: 'PDF carousel with educational value (6-10 slides)',
    promptTemplate: `Generate LinkedIn Carousel (6-10 slides).

SLIDE 1 (HOOK): Big title (5-7 words) + subtitle promising value. role:'cover'
SLIDES 2-9 (FRAMEWORK / TEACHING): One concept per slide. Title + 20-40 words explanation. Use data, numbers, frameworks. AVOID vague advice. role:'value'
LAST SLIDE (CTA): Save / comment / follow. Specific action. role:'cta'

COVER COPY (text alongside carousel): hook + value preview + soft CTA (100-200 words).`,
    structureSchema: {
      type: 'object',
      required: ['slides', 'coverCopy'],
      properties: {
        slides: {
          type: 'array',
          minItems: 6,
          maxItems: 10,
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              body: { type: 'string' },
              role: { type: 'string' },
            },
          },
        },
        coverCopy: { type: 'string' },
      },
    },
    guidelines:
      'LinkedIn carousels = educational. NOT inspirational quotes. Numbers/data matter.',
    maxLength: 1000,
    defaultEnabled: true,
    displayOrder: 2,
  },
  {
    platform: 'linkedin',
    type: 'single_image',
    displayName: 'Single Image (data viz)',
    description: 'Image-driven post (graph, infographic, screenshot)',
    promptTemplate: `Generate LinkedIn Single Image post.

IMAGE DIRECTION: what to visualize (data, infographic, screenshot), specific concept

COPY (100-200 words):
- Frame the data
- Insight / interpretation
- Why it matters for the audience
- Soft CTA`,
    structureSchema: {
      type: 'object',
      required: ['imageDirection', 'copy'],
      properties: {
        imageDirection: { type: 'string' },
        copy: { type: 'string' },
      },
    },
    guidelines: 'Image is the hero. Copy contextualizes.',
    maxLength: 1000,
    defaultEnabled: false,
    displayOrder: 3,
  },

  // ═══ REDDIT ═══
  {
    platform: 'reddit',
    type: 'self_post',
    displayName: 'Self Post (text only)',
    description: 'Discussion post without link, native to the subreddit',
    promptTemplate: `Generate Reddit Self-Post.

TITLE (60-120 chars):
- Question, observation, or specific problem
- NO clickbait, NO emoji
- Match subreddit vocabulary

BODY (200-800 words):
- Open with context (who you are, why posting)
- Specific problem or insight
- Actually useful (not salesy)
- End with discussion question

TONE:
- Natural, like commenting in a forum
- Avoid corporate speak, hype, "10x productivity" energy
- Avoid mentioning own product unless directly relevant (then disclose)

Optional TL;DR at end.`,
    structureSchema: {
      type: 'object',
      required: ['title', 'body'],
      properties: {
        title: { type: 'string', maxLength: 300 },
        body: { type: 'string' },
        optionalTldr: { type: 'string' },
      },
    },
    guidelines:
      'Reddit DETESTS promotional posts. Disclose affiliation if mentioning own product.',
    maxLength: 4000,
    defaultEnabled: true,
    displayOrder: 1,
  },
  {
    platform: 'reddit',
    type: 'link_post',
    displayName: 'Link Post (with optimized title)',
    description: 'External link with optimized title + optional context comment',
    promptTemplate: `Generate Reddit Link Post.

TITLE (60-120 chars):
- Descriptive of the linked content
- NOT clickbait
- Match what the subreddit expects
- Optional prefix: "[Article]" or "[Tool]" if helpful

OPTIONAL COMMENT (separate, posted by you):
- Context about why you're sharing
- Why it's relevant to this subreddit
- Disclose affiliation if applicable`,
    structureSchema: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string' },
        optionalComment: { type: 'string' },
      },
    },
    guidelines: 'Title is everything. Avoid "click here" language.',
    maxLength: 300,
    defaultEnabled: false,
    displayOrder: 2,
  },

  // ═══ THREADS ═══
  {
    platform: 'threads',
    type: 'text_post',
    displayName: 'Text Post',
    description: 'Casual longer-form text (300-500 chars)',
    promptTemplate: `Generate Threads Text Post (300-500 chars).

TONE: more casual than LinkedIn, longer than Twitter, conversational.

STRUCTURE: hook line, 2-3 thoughts, question/reflection at end.

NO heavy hashtags — Threads doesn't use them like IG.`,
    structureSchema: {
      type: 'object',
      required: ['content'],
      properties: { content: { type: 'string', maxLength: 500 } },
    },
    guidelines: "Threads is casual + textual. Don't overthink it.",
    maxLength: 500,
    defaultEnabled: true,
    displayOrder: 1,
  },
  {
    platform: 'threads',
    type: 'photo',
    displayName: 'Text + Image',
    description: 'Text post with image attachment',
    promptTemplate: `Generate Threads Text + Image post.

IMAGE DIRECTION: what the image shows
CONTENT (300-500 chars): text post that the image supports`,
    structureSchema: {
      type: 'object',
      required: ['imageDirection', 'content'],
      properties: {
        imageDirection: { type: 'string' },
        content: { type: 'string' },
      },
    },
    guidelines: "Image supports text, doesn't replace it.",
    maxLength: 500,
    defaultEnabled: false,
    displayOrder: 2,
  },

  // ═══ X ═══
  {
    platform: 'x',
    type: 'single_tweet',
    displayName: 'Single Tweet',
    description: '280 chars single post',
    promptTemplate: `Generate X (Twitter) Single Tweet (240-280 chars).

STRUCTURE:
- Strong hook in first 10 words
- One clear insight or value
- Optional: question or CTA

NO hashtags (X uses them sparingly).
NO "Thread incoming 🧵" if it's a single tweet.`,
    structureSchema: {
      type: 'object',
      required: ['content'],
      properties: { content: { type: 'string', maxLength: 280 } },
    },
    guidelines: 'X rewards punchy + opinionated. No fluff.',
    maxLength: 280,
    defaultEnabled: true,
    displayOrder: 1,
  },
  {
    platform: 'x',
    type: 'thread',
    displayName: 'Thread (2-8 tweets)',
    description: 'Multi-tweet thread for longer content',
    promptTemplate: `Generate X Thread (2-8 tweets).

TWEET 1 (HOOK): strongest hook, indicates value upcoming. 240-280 chars. Optional "🧵" or "(1/n)" indicator.
TWEETS 2-7 (BUILD): one concept per tweet. Each stands alone (in case retweeted). Each 240-280 chars.
LAST TWEET (CTA): recap key value OR question to engage. Optional link to more content.

Output as an array of strings, one per tweet.`,
    structureSchema: {
      type: 'object',
      required: ['tweets'],
      properties: {
        tweets: {
          type: 'array',
          minItems: 2,
          maxItems: 8,
          items: { type: 'string', maxLength: 280 },
        },
      },
    },
    guidelines:
      'X algorithm rewards threads. Each tweet must work standalone (might be retweeted alone).',
    maxLength: 280,
    defaultEnabled: true,
    displayOrder: 2,
  },
];

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { contentTypes } = await import('../lib/db/schema');

  console.log(`[seed] Inserting ${SEED.length} content types…`);
  const inserted = await db
    .insert(contentTypes)
    .values(SEED)
    .onConflictDoNothing({
      target: [contentTypes.platform, contentTypes.type],
    })
    .returning({ id: contentTypes.id });
  console.log(
    `[seed]  ✓ ${inserted.length} new rows inserted (${SEED.length - inserted.length} already existed)`,
  );

  console.log('[seed] Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[seed] Failed:', err);
  process.exit(1);
});
