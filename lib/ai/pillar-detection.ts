import { anthropic } from '@/lib/ai/claude';

export interface PillarMatch {
  pillarName: string;
  matched: boolean;
  confidence: number;
}

interface PillarInput {
  name: string;
  description: string;
}

// Detect whether a post embodies each of a set of brand pillars. Two-stage:
//
// 1) Cheap keyword pass over the pillar name + description tokens. If every
//    pillar gets a hit, we trust the keyword pass and skip the AI call.
// 2) Otherwise we send the post + pillars to Haiku for semantic verification.
//
// The keyword stage exists to keep cost bounded — for a user with 5 posts
// and 4 pillars, calling Haiku 20 times per drift-check is too expensive.
// The keyword pass catches the obvious cases for free.
export async function detectPillarsInPost(
  postContent: string,
  pillars: PillarInput[]
): Promise<PillarMatch[]> {
  if (pillars.length === 0) return [];

  const contentLower = postContent.toLowerCase();
  const keywordMatches: PillarMatch[] = pillars.map((p) => {
    const tokens = [
      p.name.toLowerCase(),
      ...p.description.toLowerCase().split(/\s+/),
    ].filter((w) => w.length > 3);
    const hits = tokens.filter((kw) => contentLower.includes(kw)).length;
    return {
      pillarName: p.name,
      matched: hits > 0,
      confidence: Math.min(1, hits / 3),
    };
  });

  // Fast path: every pillar got a keyword hit. Skip the AI call.
  if (keywordMatches.every((m) => m.matched)) {
    return keywordMatches;
  }

  try {
    const prompt = `Does this social post embody these brand pillars?

POST: ${postContent.slice(0, 500)}

PILLARS:
${pillars.map((p) => `- ${p.name}: ${p.description}`).join('\n')}

For each pillar, output STRICTLY valid JSON, no preamble or markdown:
{
  "matches": [
    { "pillar": "name", "embodies": true/false, "confidence": 0-1 }
  ]
}`;

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    let raw = textBlock?.type === 'text' ? textBlock.text.trim() : '';
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(raw) as {
      matches?: Array<{ pillar: string; embodies?: boolean; confidence?: number }>;
    };

    return (parsed.matches ?? []).map((m) => ({
      pillarName: m.pillar,
      matched: !!m.embodies,
      confidence: typeof m.confidence === 'number' ? m.confidence : 0.5,
    }));
  } catch {
    // Fallback to keyword-only result. Better than failing the whole
    // drift-check just because Haiku had a bad day.
    return keywordMatches;
  }
}
