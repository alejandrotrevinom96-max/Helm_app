import Anthropic from '@anthropic-ai/sdk';

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

// Use Haiku for high-volume tasks (post generation, research scoring)
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
// Use Opus for nuanced tasks (research synthesis, qualitative analysis)
const OPUS_MODEL = 'claude-opus-4-7';

export interface BrandContext {
  voice?: string;
  tone?: string[];
  audience?: string;
  keyPhrases?: string[];
  productFocus?: string;
  extractedAt?: string;
}

interface ProjectContext {
  name: string;
  description?: string;
  recentSignups?: number;
  recentFeatures?: string[];
  brandContext?: BrandContext | null;
  templateHint?: string | null;
}

/**
 * Generate a social media post tailored to a platform and project context.
 *
 * Brand context (when present) is injected so Claude matches the user's
 * actual voice/tone instead of producing generic SaaS copy. Template hint
 * (when present) steers the structure of the post (e.g. milestone with
 * 3 bullets, hot take with strong opener + counter-arguments).
 */
export async function generatePost(params: {
  platform: 'instagram' | 'facebook' | 'linkedin' | 'threads';
  prompt: string;
  context: ProjectContext;
}): Promise<string> {
  const { platform, prompt, context } = params;

  const platformGuidance = {
    instagram:
      'Visual-first, casual tone, 100-150 words, use 2-3 relevant emojis, end with a question or CTA. Use line breaks for readability.',
    facebook:
      'Conversational, 80-120 words, can be slightly longer. Personal storytelling works well.',
    linkedin:
      'Professional but human. 100-200 words. Lead with a hook. Use "I learned X" framing. No more than 1 emoji.',
    threads:
      'Punchy, 50-80 words max. Conversational, like a tweet but slightly longer. No hashtags.',
  };

  const brandSection = context.brandContext
    ? [
        '',
        'Brand voice (match this exactly):',
        context.brandContext.voice && `- Voice: ${context.brandContext.voice}`,
        context.brandContext.tone?.length &&
          `- Tone: ${context.brandContext.tone.join(', ')}`,
        context.brandContext.audience &&
          `- Audience: ${context.brandContext.audience}`,
        context.brandContext.keyPhrases?.length &&
          `- Phrases the brand uses: ${context.brandContext.keyPhrases.join(', ')}`,
        context.brandContext.productFocus &&
          `- Product focus: ${context.brandContext.productFocus}`,
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  const templateSection = context.templateHint
    ? `\nTemplate guidance: ${context.templateHint}`
    : '';

  // Hype-word ban only applies when the brand tone is restrained.
  const tone = context.brandContext?.tone ?? [];
  const allowsHype = tone.includes('playful') || tone.includes('bold');

  const systemPrompt = `You are a marketing assistant for "${context.name}".

Project context:
${context.description ? `- Description: ${context.description}` : ''}
${context.recentSignups ? `- Recent signups: ${context.recentSignups}` : ''}
${context.recentFeatures?.length ? `- Recent features: ${context.recentFeatures.join(', ')}` : ''}
${brandSection}

Platform: ${platform}
Platform guidance: ${platformGuidance[platform]}
${templateSection}

Rules:
- Write in first person as the founder
- Be authentic, not salesy
- No "Are you tired of..." openings${allowsHype ? '' : '\n- No empty hype or buzzwords'}
- Output ONLY the post text, no preamble or explanation`;

  const response = await anthropic.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 600,
    system: systemPrompt,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  return textBlock?.type === 'text' ? textBlock.text : '';
}

/**
 * Score how well a Reddit/HN post matches a project's niche (0-100), and
 * detect whether the post mentions one of a known list of competitors.
 *
 * If `competitors` is empty, the function returns `competitor: null` and
 * uses a cheaper number-only prompt (back-compat with the original signature).
 */
export async function scoreResearchMatch(params: {
  projectDescription: string;
  postTitle: string;
  postContent: string;
  competitors?: string[];
}): Promise<{ matchScore: number; competitor: string | null }> {
  const { projectDescription, postTitle, postContent, competitors = [] } = params;

  // Fast path when no competitors configured — keep original number-only
  // contract so we don't pay for JSON parsing when not needed.
  if (competitors.length === 0) {
    const response = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 50,
      system:
        'You score how relevant a post is to a SaaS project. Output ONLY a number 0-100, nothing else. 100 = perfect match (user describing the exact problem the SaaS solves), 0 = totally unrelated.',
      messages: [
        {
          role: 'user',
          content: `Project: ${projectDescription}\n\nPost title: ${postTitle}\n\nPost: ${postContent.slice(0, 500)}`,
        },
      ],
    });
    const textBlock = response.content.find((b) => b.type === 'text');
    const text = textBlock?.type === 'text' ? textBlock.text.trim() : '0';
    const num = parseInt(text, 10);
    return {
      matchScore: isNaN(num) ? 0 : Math.min(100, Math.max(0, num)),
      competitor: null,
    };
  }

  const competitorList = competitors.map((c) => c.toLowerCase());
  const response = await anthropic.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 80,
    system: `You score how relevant a post is to a SaaS project AND detect competitor mentions.

Output ONLY valid JSON, no preamble. Format:
{"matchScore": 0-100, "competitor": "name" | null}

- matchScore: 100 = perfect match (user describing the exact problem the SaaS solves), 0 = totally unrelated
- competitor: must be exactly one of [${competitorList.join(', ')}] if explicitly mentioned (case-insensitive substring match in title or post body), otherwise null

Match competitor names exactly as listed. Do not invent names.`,
    messages: [
      {
        role: 'user',
        content: `Project: ${projectDescription}\n\nPost title: ${postTitle}\n\nPost: ${postContent.slice(0, 500)}`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  const text = textBlock?.type === 'text' ? textBlock.text.trim() : '{}';
  const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  try {
    const parsed = JSON.parse(cleaned) as {
      matchScore?: unknown;
      competitor?: unknown;
    };
    const raw = typeof parsed.matchScore === 'number' ? parsed.matchScore : 0;
    const matchScore = Math.min(100, Math.max(0, raw));
    const comp =
      typeof parsed.competitor === 'string'
        ? parsed.competitor.toLowerCase()
        : null;
    // Reject hallucinated competitor names.
    const competitor = comp && competitorList.includes(comp) ? comp : null;
    return { matchScore, competitor };
  } catch {
    return { matchScore: 0, competitor: null };
  }
}

/**
 * Synthesize a weekly insight from multiple research findings.
 */
export async function synthesizeInsight(params: {
  projectDescription: string;
  findings: { title: string; snippet: string; source: string }[];
}): Promise<string> {
  const { projectDescription, findings } = params;

  const findingsText = findings
    .slice(0, 20)
    .map((f, i) => `${i + 1}. [${f.source}] ${f.title}\n   ${f.snippet}`)
    .join('\n\n');

  const response = await anthropic.messages.create({
    model: OPUS_MODEL,
    max_tokens: 800,
    system: `You synthesize patterns from social media discussions for a SaaS founder.
Output a 3-4 sentence insight that:
1. Identifies the most common pattern/pain point across the findings
2. Quantifies it ("X mentions in Y conversations")
3. Suggests one concrete action for the founder

No fluff. No "Indie hackers are X" generic openings. Be specific.`,
    messages: [
      {
        role: 'user',
        content: `My project: ${projectDescription}\n\nRecent findings from Reddit/HN:\n\n${findingsText}`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  return textBlock?.type === 'text' ? textBlock.text : '';
}
