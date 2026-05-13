-- PR #88 — Sprint 7.12: TikTok content types seed.
--
-- Idempotent insert against content_types — three new rows for
-- platform='tiktok'. ON CONFLICT keys off the existing
-- content_types_platform_type_uk unique constraint, so re-running
-- this script after a partial failure is safe.
--
-- The promptTemplate + structureSchema bodies mirror exactly what
-- scripts/seed-content-types.ts now declares — kept in sync
-- manually here so production can be brought up without running
-- the full TypeScript seed.

INSERT INTO content_types (
  platform, type, display_name, description,
  prompt_template, structure_schema, guidelines,
  max_length, default_enabled, display_order
) VALUES
(
  'tiktok',
  'photo',
  'Single Photo',
  'One image post with caption and hashtags. Max 2,200 chars.',
  $$Generate a TikTok single photo post in the creator's voice.

CAPTION:
- Max 2,200 characters
- Conversational tone, never corporate
- Optional: one question to drive comments
- 3-5 hashtags at the end, mix of broad and niche

IMAGE DIRECTION (1-2 sentences):
- What to shoot/show
- 9:16 vertical composition (TikTok's native aspect)
- Mood + lighting hint

Flux generates the image on-demand from Library.$$,
  '{
    "type": "object",
    "required": ["imageDirection", "caption", "hashtags"],
    "properties": {
      "imageDirection": { "type": "string" },
      "caption": { "type": "string", "maxLength": 2200 },
      "hashtags": {
        "type": "array",
        "minItems": 3,
        "maxItems": 5,
        "items": { "type": "string" }
      },
      "question": { "type": "string" }
    }
  }'::jsonb,
  'TikTok is conversational. Avoid Instagram-style polished captions. 9:16 vertical is the native aspect.',
  2200,
  true,
  1
),
(
  'tiktok',
  'ugc',
  'UGC-style Script',
  'Hook + body + CTA script. Ready to record or send to HeyGen.',
  $$Generate a TikTok UGC-style video script in the creator's voice.

STRUCTURE:
- [HOOK] (first 3 seconds): one punchy line that stops the scroll
- [BODY] (15-45 seconds): 3-5 short punchy sentences, one idea each,
  written as SPOKEN WORDS not captions
- [CTA] (last 3 seconds): one clear action
  ("Follow for more", "Link in bio", "Comment X if you agree")

FORMAT RULES:
- Max 150 words total for the SCRIPT
- No emojis in the script itself
- Write as spoken words (read it out loud — does it sound natural?)

ALSO GENERATE:
- Caption (max 2,200 chars) with 3-5 relevant hashtags
- 3 suggested on-screen text overlays (max 5 words each)

HeyGen converts this to video on-demand from Library.$$,
  '{
    "type": "object",
    "required": ["hook", "body", "cta", "caption", "hashtags", "overlays"],
    "properties": {
      "hook": { "type": "string" },
      "body": {
        "type": "array",
        "minItems": 3,
        "maxItems": 5,
        "items": { "type": "string" }
      },
      "cta": { "type": "string" },
      "caption": { "type": "string", "maxLength": 2200 },
      "hashtags": {
        "type": "array",
        "minItems": 3,
        "maxItems": 5,
        "items": { "type": "string" }
      },
      "overlays": {
        "type": "array",
        "minItems": 3,
        "maxItems": 3,
        "items": { "type": "string", "maxLength": 60 }
      }
    }
  }'::jsonb,
  'UGC = real person talking. Avoid corporate or polished marketing tone. Read the script out loud to check natural cadence.',
  2200,
  true,
  2
),
(
  'tiktok',
  'carousel',
  'Carousel (3-10 slides)',
  'Multi-slide post with cover, value slides, and CTA.',
  $$Generate a TikTok carousel in the creator's voice.

STRUCTURE (3-10 slides):
- SLIDE 1 (COVER): bold hook headline (max 8 words). role: 'cover'
- SLIDES 2-9 (VALUE): each with a short title (max 8 words)
  and body text (max 30 words). role: 'value'
- LAST SLIDE (CTA): one clear action. role: 'cta'

CAPTION:
- Max 2,200 chars
- Hook + 2-3 value points + CTA
- 3-5 hashtags

Flux generates images on-demand from Library.$$,
  '{
    "type": "object",
    "required": ["slides", "caption", "hashtags"],
    "properties": {
      "slides": {
        "type": "array",
        "minItems": 3,
        "maxItems": 10,
        "items": {
          "type": "object",
          "required": ["title", "body", "role"],
          "properties": {
            "title": { "type": "string" },
            "body": { "type": "string" },
            "role": { "type": "string", "enum": ["cover", "value", "cta"] }
          }
        }
      },
      "caption": { "type": "string", "maxLength": 2200 },
      "hashtags": {
        "type": "array",
        "minItems": 3,
        "maxItems": 5,
        "items": { "type": "string" }
      }
    }
  }'::jsonb,
  '9:16 vertical slides. Cover slide drives tap-through. TikTok carousels are scrollable like IG but reward shorter cover hooks (8 words max).',
  2200,
  true,
  3
)
ON CONFLICT ON CONSTRAINT content_types_platform_type_uk DO NOTHING;
