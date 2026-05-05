export interface PostTemplate {
  id: string;
  category: string;
  title: string;
  description: string;
  hook: string; // Pre-written, editable
  systemHint: string; // Injected into Claude's system prompt
  bestFor: Array<'instagram' | 'facebook' | 'linkedin' | 'threads' | 'reddit'>;
}

export const templates: PostTemplate[] = [
  {
    id: 'launch',
    category: 'Milestones',
    title: 'Product launch',
    description: 'Announce a new product, feature, or major release',
    hook: "We just launched [thing]. Here's what it solves and why we built it:",
    systemHint:
      'Focus on the problem, the why, and a clear CTA. Avoid hype words.',
    bestFor: ['linkedin', 'threads', 'instagram'],
  },
  {
    id: 'milestone',
    category: 'Milestones',
    title: 'Numbers / Milestone',
    description: 'Hit a meaningful number (users, revenue, etc)',
    hook: 'We just hit [N]. Three things that surprised us:',
    systemHint:
      'Use the format "X surprised us" + 3 concrete bullets. Show vulnerability + data.',
    bestFor: ['linkedin', 'threads', 'instagram'],
  },
  {
    id: 'behind-scenes',
    category: 'Educational',
    title: 'How it works (technical)',
    description: 'Show the engineering / decisions behind a feature',
    hook: 'How [feature] actually works under the hood:',
    systemHint:
      'Be specific and technical. Use diagrams or code snippets if relevant. Link to a longer write-up.',
    bestFor: ['linkedin', 'threads'],
  },
  {
    id: 'lesson',
    category: 'Educational',
    title: 'Lesson learned',
    description: 'Share a mistake and what you learned',
    hook: "We made the wrong bet with [thing]. Here's what we'd do differently:",
    systemHint:
      'Be honest about the failure. Lead with the mistake, end with the lesson. Avoid humble bragging.',
    bestFor: ['linkedin', 'threads'],
  },
  {
    id: 'comparison',
    category: 'Educational',
    title: 'Tool comparison',
    description: 'Compare your tool vs alternatives based on real data',
    hook: '[Tool A] vs [Tool B]: what we learned after [time period]:',
    systemHint:
      'Use real numbers. Acknowledge where alternatives win. Conclude with WHO each is best for.',
    bestFor: ['linkedin', 'threads'],
  },
  {
    id: 'hot-take',
    category: 'Engagement',
    title: 'Hot take',
    description: 'Counterintuitive opinion that sparks discussion',
    hook: 'Unpopular opinion: [niche thing] is overrated.',
    systemHint:
      'Lead with a strong claim. Back it up with 2-3 reasons. Invite disagreement at the end.',
    bestFor: ['threads', 'linkedin'],
  },
  {
    id: 'community',
    category: 'Engagement',
    title: 'User shoutout',
    description: 'Highlight feedback or use case from a user',
    hook: '[User/handle] tweeted this about [product]:',
    systemHint:
      'Quote the user. Add context on why it matters. Tag them if appropriate.',
    bestFor: ['threads', 'instagram', 'linkedin'],
  },
  {
    id: 'question',
    category: 'Engagement',
    title: 'Open question',
    description: 'Ask the audience a question to drive replies',
    hook: 'Indie hackers building [niche]: how do you handle [problem]?',
    systemHint:
      "Ask a single specific question. Add context on why you're asking. Promise to share the best answers.",
    bestFor: ['threads', 'linkedin'],
  },
  {
    id: 'process',
    category: 'Behind the scenes',
    title: 'Daily / Weekly recap',
    description: 'What you shipped this week',
    hook: 'Week [N] of building [product]. Shipped:',
    systemHint:
      "List 3-5 concrete things shipped. Mention 1 thing that didn't work. End with what's next.",
    bestFor: ['threads', 'linkedin', 'instagram'],
  },
  {
    id: 'case-study',
    category: 'Educational',
    title: 'Customer case study',
    description: 'How a customer uses your product',
    hook: 'How [customer/persona] uses [product] to [outcome]:',
    systemHint:
      'Concrete numbers. Specific use case. Link to a longer case study if exists.',
    bestFor: ['linkedin'],
  },
];

export const categories = Array.from(new Set(templates.map((t) => t.category)));

export function getTemplateById(id: string | null | undefined) {
  if (!id) return null;
  return templates.find((t) => t.id === id) ?? null;
}
