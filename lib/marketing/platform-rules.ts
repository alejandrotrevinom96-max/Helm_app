// PR Sprint 7.26 — Asset-based content flow.
//
// PLATFORM_RULES: which platforms accept which asset types.
// Drives the generate UI (filter platform checkboxes by asset type)
// and the generate-asset API (refuse platforms that don't belong).
//
// Why these specific maps:
//   - ugc_video / reel → vertical-video platforms only. LinkedIn /
//     X / Threads / Reddit don't play vertical video natively and
//     UGC performance there is below the floor where it's worth
//     burning a HeyGen render.
//   - carousel → the three networks with first-class multi-image
//     posts. X has carousels-via-thread but the UX is meaningfully
//     different so we exclude it for the v1 of this flow.
//   - photo → single-image-friendly networks. Reddit excluded
//     because it's text-first; LinkedIn excluded because it gets a
//     better SOV from carousels of the same content.
//   - long_form_text → text-first networks. IG / FB / TikTok
//     captions max at ~2200 chars but the format isn't read on
//     those platforms, so long-form lives on LinkedIn / X (thread)
//     / Reddit / Threads.
//
// GOLDEN_TIMES: the best per-platform posting hour (24h HH:MM
// local). Used as the default time when the user drags an asset
// onto a calendar day and picks "stagger by golden time" — the
// scheduler stamps each platform's variant with its own optimal
// hour, so a TikTok + IG + FB asset gets 9:00 / 11:00 / 14:00
// instead of all landing at the same minute.

// The asset-flow Platform type is wider than lib/platforms/colors.ts
// (Sprint 6.7) — that union covers the visual color palette and
// doesn't distinguish "instagram_reels" from "instagram" because
// they share IG brand colors. The asset flow DOES need to
// distinguish them: a Reel on IG goes through a different posting
// pipeline (vertical video container + media_publish), and the
// GOLDEN_TIMES are different from feed IG. We keep both unions
// alive in parallel — colors.ts maps any *_reels variant to the
// parent network's color via a fold in the calendar/chip render.
export type Platform =
  | 'instagram'
  | 'instagram_reels'
  | 'facebook'
  | 'facebook_reels'
  | 'linkedin'
  | 'reddit'
  | 'threads'
  | 'x'
  | 'tiktok';

export const ASSET_TYPES = [
  'ugc_video',
  'reel',
  'carousel',
  'photo',
  'long_form_text',
] as const;

export type AssetType = (typeof ASSET_TYPES)[number];

// Human-readable copy for each asset type. Keeps the picker UI +
// API error messages in sync with what we tell the founder.
export const ASSET_TYPE_LABELS: Record<
  AssetType,
  { title: string; tagline: string; emoji: string }
> = {
  ugc_video: {
    title: 'UGC Video',
    tagline: '30s talking-head script + AI video render',
    emoji: '🎥',
  },
  reel: {
    title: 'Reel',
    tagline: 'Short vertical video for IG / TikTok / FB',
    emoji: '🎬',
  },
  carousel: {
    title: 'Carousel',
    tagline: '5–8 swipeable slides',
    emoji: '🖼️',
  },
  photo: {
    title: 'Single Photo',
    tagline: 'One image + caption',
    emoji: '📷',
  },
  long_form_text: {
    title: 'Long-form Text',
    tagline: 'Essay, thread, or post body — no media',
    emoji: '📝',
  },
};

export const PLATFORM_RULES: Record<AssetType, readonly Platform[]> = {
  ugc_video: ['tiktok', 'instagram_reels', 'facebook_reels'],
  reel: ['tiktok', 'instagram_reels', 'facebook_reels'],
  carousel: ['instagram', 'linkedin', 'facebook'],
  photo: ['instagram', 'x', 'threads', 'facebook'],
  long_form_text: ['linkedin', 'x', 'reddit', 'threads'],
} as const;

// Inverse lookup — every platform that exists in the system, and
// the asset types it CAN accept. Used by the picker UI to
// gray-out incompatible platforms with a tooltip.
export const ALL_PLATFORMS: readonly Platform[] = [
  'instagram',
  'instagram_reels',
  'facebook',
  'facebook_reels',
  'linkedin',
  'reddit',
  'threads',
  'x',
  'tiktok',
] as const;

export function platformsForAssetType(
  type: AssetType,
): readonly Platform[] {
  return PLATFORM_RULES[type];
}

export function isPlatformValidFor(
  type: AssetType,
  platform: Platform,
): boolean {
  return PLATFORM_RULES[type].includes(platform);
}

// 24-hour HH:MM local. The scheduler interprets these against the
// founder's project timezone (defaults UTC) when stamping
// scheduled_for. Defaults chosen from a mix of platform-published
// engagement studies + Helm's own historical performance data.
export const GOLDEN_TIMES: Record<Platform, string> = {
  tiktok: '9:00',
  instagram_reels: '11:00',
  facebook_reels: '14:00',
  instagram: '11:00',
  linkedin: '8:30',
  facebook: '13:00',
  x: '12:00',
  threads: '17:00',
  reddit: '10:00',
};

// Combine a base date (yyyy-mm-dd) with a HH:MM string into a
// Date in local time. Used by the stagger flow when the founder
// drops an asset onto a calendar day — each platform's variant
// gets its own golden-time stamp on that day.
export function applyGoldenTime(
  baseDate: Date,
  platform: Platform,
): Date {
  const [hh, mm] = GOLDEN_TIMES[platform].split(':').map(Number);
  const d = new Date(baseDate);
  d.setHours(hh, mm, 0, 0);
  return d;
}

// Per-platform tone rules fed into the Haiku caption-adaptation
// prompt. Kept short + opinionated so the prompt stays cacheable
// (the rules are part of the system prompt, not the user prompt,
// so they hit the Anthropic prompt cache).
//
// The new generate-asset endpoint uses these to spawn N parallel
// adaptations from one baseContent — the founder gets a TikTok
// caption that ACTUALLY looks like a TikTok caption (3-5 hashtags,
// hook first) and a LinkedIn caption that ACTUALLY looks like a
// LinkedIn post (professional opener, no emojis if brand is
// formal) — instead of one generic caption pasted to every
// network.
export const PLATFORM_TONE_RULES: Record<Platform, string> = {
  tiktok:
    'Short caption (max 150 chars). Hook in the first line. ' +
    'Add 3-5 trending hashtags. Casual, energetic tone. ' +
    'Punctuate with line breaks instead of long sentences.',
  instagram:
    'Storytelling caption, 2-4 short paragraphs. ' +
    '10-20 hashtags at the very end, hidden below the fold ' +
    '(use 3+ line breaks before them).',
  instagram_reels:
    'Short hook caption (max 200 chars). ' +
    '5-8 relevant hashtags. Curious / question-led opener.',
  facebook:
    'Conversational, 1-3 paragraphs. ' +
    'Maximum 1-2 hashtags (they don\'t drive reach on FB). ' +
    'End with a direct question to invite comments.',
  facebook_reels:
    'Short hook caption (max 200 chars). ' +
    'Maximum 1-2 hashtags. Curious opener.',
  linkedin:
    'Professional opener with a hook line. 2-4 paragraphs. ' +
    'No emojis unless the brand voice is explicitly casual. ' +
    'End with a thoughtful question or a clear CTA. ' +
    '0-3 hashtags max, at the very end.',
  x:
    'If under 280 chars, single tweet. ' +
    'If longer, break into a 2-8 tweet thread numbered ' +
    '(1/, 2/, …). Punchy, no hashtags unless culturally required.',
  reddit:
    'Conversational, no marketing voice. ' +
    'No hashtags. Title + body separated by a blank line. ' +
    'If the prompt names a subreddit, match its tone.',
  threads:
    'Casual, 1-2 short paragraphs. ' +
    '0-3 hashtags max. Reads like a text message to a friend.',
};
