// PR Sprint D-8 Phase 2 — copy generator for Photo Studio.
//
// Two callable shapes:
//
//   generateCopies({ platforms, ... })
//     ONE Opus call returning per-platform captions in a single
//     structured JSON response. Saves Nx the cost + latency of
//     looping per platform.
//
//   regenerateOne({ platform, ... })
//     ONE Opus call for a SINGLE platform. Used by the "Regenerate
//     this one" affordance in CopyCard — keeps the other platforms'
//     copies intact while iterating on the odd-one-out.
//
// Brand bible is injected via cachedSystem() so subsequent regens
// in the same session land on the 5-min cache window — empirical
// saving on a heavy founder iteration ~80% on input tokens.

import {
  anthropic,
  MODELS,
  cachedSystem,
  LANGUAGE_INSTRUCTION_AUDIENCE,
} from '@/lib/ai/claude';
import type { BrandBible } from '@/lib/types/brand';

export interface PerPlatformCopy {
  platform: string;
  text: string;
  hashtags: string[];
  ctaText: string | null;
}

interface GenerateCopiesInput {
  brandBible: BrandBible | null;
  concept: string;
  // The visual that goes WITH the copies (the agent describes
  // what the image shows so the caption can play off it).
  visualDescription: string;
  platforms: string[];
  // Optional founder-side note from the chat ("more casual",
  // "skip the hashtags", etc.). Threaded into the prompt.
  styleNote: string | null;
}

const PLATFORM_BRIEFS: Record<string, string> = {
  instagram:
    'Visual-first, casual tone. 100-150 words. 2-3 relevant emojis. End with a question or CTA. Use line breaks for readability.',
  instagram_reels:
    'Same as Instagram feed but optimize the FIRST line as a vertical-video hook (≤8 words). Caption length 80-130 words.',
  facebook:
    'Conversational, 80-120 words. Personal storytelling works. 1-2 emojis.',
  facebook_reels:
    'Hook-first vertical-video caption. 60-100 words. Punchy.',
  linkedin:
    'Professional but human. 100-200 words. Lead with a hook. Use "I learned X" framing. Max 1 emoji.',
  threads:
    'Punchy, 50-80 words. Conversational like a tweet but slightly longer. No hashtags.',
  reddit:
    'Humble, story-driven, 200-800 chars. Hook → context → specific story with numbers → lesson → genuine question. NO emojis, NO hashtags, NO buzzwords.',
  x:
    'Single tweet, ≤280 chars. Hook in first 10 words. 0-1 emoji. 0-2 hashtags max.',
  tiktok:
    'Vertical-video caption. Hook in the first line (≤6 words). 80-150 chars total. 3-5 trending hashtags. Casual / gen-z tone.',
};

function buildBrandSystem(
  bible: BrandBible | null,
  visualDescription: string,
  styleNote: string | null,
): string {
  const pillars = (bible?.pillars ?? [])
    .map((p) => `- ${p.name}: ${p.description}`)
    .join('\n');
  const banned = (bible?.vocabulary?.bannedTerms ?? [])
    .map((t) => `- "${t.term}"`)
    .join('\n');
  const preferred = (bible?.vocabulary?.preferredTerms ?? [])
    .map((t) => `- "${t.term}"`)
    .join('\n');
  const nonNeg = (bible?.nonNegotiables ?? []).map((n) => `- ${n}`).join('\n');

  return `You are writing per-platform social copy for a visual asset the founder just approved. Each caption MUST land within the platform's house style AND the brand bible.

═══════ VISUAL ═══════
The image being captioned: ${visualDescription}

═══════ BRAND ═══════
ARCHETYPE: ${bible?.archetype?.primary ?? 'unspecified'}
TAGLINE: ${bible?.identity?.tagline ?? ''}

PILLARS (each post should embody at least one):
${pillars || '- (none specified)'}

PREFERRED TERMS:
${preferred || '- (none specified)'}

BANNED TERMS (NEVER use):
${banned || '- (none specified)'}

NON-NEGOTIABLES:
${nonNeg || '- (none specified)'}

EMOJI POLICY: ${bible?.vocabulary?.emojiPolicy ?? 'tasteful'}
HASHTAG POLICY: ${bible?.vocabulary?.hashtagPolicy ?? 'minimal'}

${styleNote ? `═══════ FOUNDER NOTE ═══════\n${styleNote}\n\n` : ''}═══════ OUTPUT CONTRACT ═══════
Return ONLY valid JSON in this exact shape (an array — one item per platform):
[
  {
    "platform": "<exact platform key from the input>",
    "text": "<caption text, no preamble, no markdown>",
    "hashtags": ["#one", "#two", "#three"],
    "ctaText": "<optional 2-6 word call-to-action> | null"
  },
  ...
]

NO prose around the JSON. NO markdown fences. NO explanations.

${LANGUAGE_INSTRUCTION_AUDIENCE}`;
}

export async function generateCopies(
  input: GenerateCopiesInput,
): Promise<PerPlatformCopy[]> {
  const { brandBible, concept, visualDescription, platforms, styleNote } = input;
  if (platforms.length === 0) return [];

  const system = buildBrandSystem(brandBible, visualDescription, styleNote);
  const platformBriefs = platforms
    .map((p) => `- ${p}: ${PLATFORM_BRIEFS[p] ?? 'No specific guidance.'}`)
    .join('\n');

  const user = `Concept the founder approved: ${concept}

Generate copies for these platforms (one per item):
${platformBriefs}

Output the JSON array now.`;

  const r = await anthropic.messages.create({
    model: MODELS.OPUS,
    max_tokens: 2500,
    system: cachedSystem(system),
    messages: [{ role: 'user', content: user }],
  });

  const block = r.content.find((b) => b.type === 'text');
  const raw = block?.type === 'text' ? block.text.trim() : '';
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (p): p is { platform: unknown; text: unknown; hashtags: unknown; ctaText: unknown } =>
          typeof p === 'object' && p !== null,
      )
      .map((p) => ({
        platform: String(p.platform ?? '').toLowerCase(),
        text: String(p.text ?? '').slice(0, 5000),
        hashtags: Array.isArray(p.hashtags)
          ? (p.hashtags as unknown[])
              .map((h) => String(h).replace(/^#?/, '#').slice(0, 50))
              .slice(0, 10)
          : [],
        ctaText:
          typeof p.ctaText === 'string' && p.ctaText.trim().length > 0
            ? p.ctaText.trim().slice(0, 60)
            : null,
      }))
      .filter((p) => platforms.includes(p.platform) && p.text.length > 0);
  } catch {
    return [];
  }
}

interface RegenerateOneInput {
  brandBible: BrandBible | null;
  concept: string;
  visualDescription: string;
  platform: string;
  // The current caption for this platform (so the regen can
  // diverge from it instead of producing the same thing).
  previousText: string;
  // What the founder asked to change ("more casual", "shorter").
  founderDirection: string | null;
}

export async function regenerateOne(
  input: RegenerateOneInput,
): Promise<PerPlatformCopy | null> {
  const result = await generateCopies({
    brandBible: input.brandBible,
    concept: input.concept,
    visualDescription: input.visualDescription,
    platforms: [input.platform],
    styleNote: [
      input.founderDirection,
      `Previous caption was: "${input.previousText.slice(0, 300)}". Produce a meaningfully different one — different opener, different angle on the same concept.`,
    ]
      .filter(Boolean)
      .join('\n\n'),
  });
  return result[0] ?? null;
}
