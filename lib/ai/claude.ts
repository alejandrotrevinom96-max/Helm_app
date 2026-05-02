import Anthropic from '@anthropic-ai/sdk';

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

// Use Haiku for high-volume tasks (post generation, research scoring)
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
// Use Opus for nuanced tasks (research synthesis, qualitative analysis)
const OPUS_MODEL = 'claude-opus-4-7';

interface ProjectContext {
  name: string;
  description?: string;
  recentSignups?: number;
  recentFeatures?: string[];
}

/**
 * Generate a social media post tailored to a platform and project context.
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

  const systemPrompt = `You are a marketing assistant for an indie hacker building "${context.name}".

Project context:
${context.description ? `- Description: ${context.description}` : ''}
${context.recentSignups ? `- Recent signups: ${context.recentSignups}` : ''}
${context.recentFeatures?.length ? `- Recent features: ${context.recentFeatures.join(', ')}` : ''}

Platform: ${platform}
Platform guidance: ${platformGuidance[platform]}

Rules:
- Write in first person as the founder
- Be authentic, not salesy
- No "Are you tired of..." openings
- No empty hype or buzzwords
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
 * Score how well a Reddit/HN post matches a project's niche (0-100).
 */
export async function scoreResearchMatch(params: {
  projectDescription: string;
  postTitle: string;
  postContent: string;
}): Promise<number> {
  const { projectDescription, postTitle, postContent } = params;

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
  return isNaN(num) ? 0 : Math.min(100, Math.max(0, num));
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
