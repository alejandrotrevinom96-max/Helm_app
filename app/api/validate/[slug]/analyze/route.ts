import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  waitlistPages,
  waitlistResponses,
  projects,
} from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { anthropic } from '@/lib/ai/claude';
import { checkRateLimit } from '@/lib/rate-limit';
import type { TemplateConfig } from '@/lib/validate/defaults';
import { NextResponse } from 'next/server';

interface SurveyAnalysis {
  summary: string;
  overallSentiment: 'positive' | 'mixed' | 'negative';
  problemSolutionFit: number;
  perQuestionThemes: {
    question: string;
    themes: string[];
    quotes: { text: string; from?: string }[];
  }[];
  overallThemes: string[];
  standoutQuotes: { text: string; from?: string; reason: string }[];
  nextActions: string[];
  generatedAt: string;
  respondedCount?: number;
}

const SYSTEM_PROMPT = (productName: string) => `You are a market research analyst. You're given survey responses for "${productName}".

Your job: deeply analyze qualitative responses and produce a structured insight.

OUTPUT REQUIREMENTS — Return ONLY valid JSON, no preamble or markdown fences:

{
  "summary": "2-3 sentences capturing the core finding",
  "overallSentiment": "positive" | "mixed" | "negative",
  "problemSolutionFit": 0-10 (0=no signal, 10=very strong demand for the problem you're solving),
  "perQuestionThemes": [
    {
      "question": "verbatim question text",
      "themes": ["theme1", "theme2"],
      "quotes": [{ "text": "exact quote", "from": "email-or-anonymous" }]
    }
  ],
  "overallThemes": ["cross-cutting theme 1", "..."],
  "standoutQuotes": [
    { "text": "verbatim", "from": "email-or-anonymous", "reason": "why this matters" }
  ],
  "nextActions": ["specific actionable next step", "..."]
}

RULES:
- All quotes must be VERBATIM (exact text from responses)
- problemSolutionFit: be honest. Many indie hackers overestimate signal.
  - 0-3: respondents not really feeling the problem
  - 4-6: real problem but unclear if your solution fits
  - 7-9: strong fit signal
  - 10: only if multiple respondents would pay tomorrow
- nextActions: concrete steps, not "talk to more users"
- 2-4 themes per question, 1-3 quotes per question
- 3-5 cross-cutting themes
- 2-4 standout quotes
- 3-5 next actions
- Output JSON ONLY`;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Rate limit: 5 analyze calls per 5 minutes per user. Each one hits Opus
  // (~$0.10-0.30 in tokens) so we'd rather throttle than rack up surprise bills.
  const limit = checkRateLimit(`analyze:${user.id}`, 5, 5 * 60 * 1000);
  if (!limit.allowed) {
    const minutes = Math.ceil(limit.resetMs / 60000);
    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
        hint: `Wait ${minutes} minute${minutes === 1 ? '' : 's'} before regenerating.`,
      },
      { status: 429 }
    );
  }

  const { slug } = await params;

  // Authorize via project ownership and pull what we need in one query.
  const [pageRow] = await db
    .select({
      id: waitlistPages.id,
      title: waitlistPages.title,
      template: waitlistPages.template,
      templateConfig: waitlistPages.templateConfig,
      projectName: projects.name,
    })
    .from(waitlistPages)
    .innerJoin(projects, eq(projects.id, waitlistPages.projectId))
    .where(and(eq(waitlistPages.slug, slug), eq(projects.userId, user.id)))
    .limit(1);
  if (!pageRow) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (pageRow.template !== 'survey-5q') {
    return NextResponse.json(
      { error: 'Analysis is only available for survey templates' },
      { status: 400 }
    );
  }

  const responses = await db
    .select()
    .from(waitlistResponses)
    .where(eq(waitlistResponses.waitlistPageId, pageRow.id))
    .orderBy(desc(waitlistResponses.createdAt));

  if (responses.length < 2) {
    return NextResponse.json(
      {
        error: 'Need at least 2 responses to analyze',
        hint: 'Wait for more survey submissions before generating an analysis.',
      },
      { status: 400 }
    );
  }

  const config = (pageRow.templateConfig as TemplateConfig | null) ?? {};
  const questions = config.questions ?? [];

  const formattedResponses = responses
    .map((r, i) => {
      const resp = (r.responses as Record<string, string> | null) ?? {};
      const answers = questions
        .map(
          (q, qi) =>
            `Q${qi + 1}: ${q}\nA: ${resp[`q${qi}`] ?? '(no answer)'}`
        )
        .join('\n');
      const from = r.email ? ` (from: ${r.email})` : ' (anonymous)';
      return `--- Response ${i + 1}${from} ---\n${answers}`;
    })
    .join('\n\n');

  let response;
  try {
    response = await anthropic.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 3000,
      system: SYSTEM_PROMPT(pageRow.projectName),
      messages: [
        {
          role: 'user',
          content: `Survey: ${pageRow.title}\nQuestions: ${JSON.stringify(questions)}\n\nResponses (${responses.length}):\n\n${formattedResponses}`,
        },
      ],
    });
  } catch (e) {
    console.error('[ANALYZE] anthropic call failed', e);
    return NextResponse.json(
      {
        error: 'AI call failed',
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 500 }
    );
  }

  const textBlock = response.content.find((b) => b.type === 'text');
  let text = textBlock?.type === 'text' ? textBlock.text : '{}';

  // Strip markdown fences if present (Opus sometimes wraps in ```json …)
  text = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();

  // Model returns the analysis fields; we stamp generatedAt and
  // respondedCount ourselves so the UI can detect when the analysis went
  // stale (new responses since this run).
  let raw: Omit<SurveyAnalysis, 'generatedAt' | 'respondedCount'>;
  try {
    raw = JSON.parse(text) as Omit<
      SurveyAnalysis,
      'generatedAt' | 'respondedCount'
    >;
  } catch {
    return NextResponse.json(
      {
        error: 'Could not parse analysis',
        raw: text.slice(0, 500),
      },
      { status: 500 }
    );
  }

  const parsed: SurveyAnalysis = {
    ...raw,
    generatedAt: new Date().toISOString(),
    respondedCount: responses.length,
  };

  await db
    .update(waitlistPages)
    .set({ surveyAnalysis: parsed })
    .where(eq(waitlistPages.id, pageRow.id));

  return NextResponse.json({ analysis: parsed });
}
