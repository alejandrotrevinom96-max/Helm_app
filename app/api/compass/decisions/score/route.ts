// PR #71 — Sprint 7.1E: pre-commit alignment scoring for a
// proposed strategic decision.
//
// IMPORTANT: this endpoint does NOT persist the decision. The
// founder gets the Opus score and decides whether to commit via
// /api/compass/decisions (POST). That two-step flow is the whole
// point of the Decision Log — score-before-commit creates the
// pause that prevents impulse pivots.
//
// Loads:
//   - brand North Star (niche/audience/specificity/competitorGap)
//   - latest positioning benchmark (optional — enriches reasoning)
//   - prior 5 decisions for pattern context (so Opus can flag
//     "you're repeating the X mistake")
//
// Refuses cleanly if brand analysis is missing (no North Star =
// can't score alignment with it).
//
// max_tokens: 4000 — output is ~2k chars (one decision, no array),
// well under the ceiling. Still guarded against stop_reason
// truncation just in case.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  projects,
  brandAnalysis,
  positioningBenchmarks,
  compassDecisions,
} from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { anthropic, MODELS, cachedSystem } from '@/lib/ai/claude';
import { trackUsage } from '@/lib/ai/usage-tracker';
import { checkRateLimit } from '@/lib/rate-limit';

export const maxDuration = 60;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_CATEGORIES = new Set([
  'product',
  'pricing',
  'positioning',
  'audience',
  'platform',
  'content',
  'other',
]);

const VALID_REVERSIBILITIES = new Set([
  'easy',
  'medium',
  'hard',
  'irreversible',
]);

const VALID_RECOMMENDATIONS = new Set([
  'proceed',
  'proceed_carefully',
  'reconsider',
  'reject',
]);

function cleanJson(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function asStr(v: unknown, max = 2000): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function asInt(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function asStringArray(v: unknown, max = 4): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .slice(0, max)
    .map((s) => s.slice(0, 400));
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: {
    projectId?: string;
    title?: string;
    description?: string;
    category?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { projectId, title } = body;
  if (!projectId || !UUID_RE.test(projectId)) {
    return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 });
  }
  if (!title || typeof title !== 'string' || !title.trim()) {
    return NextResponse.json(
      { error: 'title required (the proposed decision)' },
      { status: 400 },
    );
  }

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) {
    return NextResponse.json(
      { error: 'Project not found or forbidden' },
      { status: 403 },
    );
  }

  // 10/hour — scoring is the most expensive op (Opus + context).
  const limit = checkRateLimit(
    `compass-decision-score:${user.id}`,
    10,
    60 * 60 * 1000,
  );
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
        hint: `Try again in ${Math.ceil(limit.resetMs / 60000)} minutes.`,
      },
      { status: 429 },
    );
  }

  const [analysis] = await db
    .select()
    .from(brandAnalysis)
    .where(eq(brandAnalysis.projectId, projectId))
    .orderBy(desc(brandAnalysis.createdAt))
    .limit(1);
  if (!analysis) {
    return NextResponse.json(
      {
        error: 'Brand analysis required',
        hint: 'Run Smart Auto-configure on /research first — without a North Star, there is no baseline to score alignment against.',
      },
      { status: 400 },
    );
  }

  const [benchmark] = await db
    .select()
    .from(positioningBenchmarks)
    .where(eq(positioningBenchmarks.projectId, projectId))
    .orderBy(desc(positioningBenchmarks.createdAt))
    .limit(1);

  const recentDecisions = await db
    .select()
    .from(compassDecisions)
    .where(eq(compassDecisions.projectId, projectId))
    .orderBy(desc(compassDecisions.decidedAt))
    .limit(5);

  // Defensive jsonb access — audienceLayers can be {primary, secondary}
  // or empty/null depending on how the brand analysis was filled.
  const layers =
    typeof analysis.audienceLayers === 'object' && analysis.audienceLayers
      ? (analysis.audienceLayers as Record<string, unknown>)
      : {};

  const category =
    typeof body.category === 'string' && VALID_CATEGORIES.has(body.category)
      ? body.category
      : 'other';

  const description = asStr(body.description, 2000);

  const systemPrompt = `You are a senior brand strategist evaluating a proposed strategic decision against a brand's North Star.

Be brutally honest. No cheerleading. If the founder is making the same mistake twice, say it. If alignment is low, recommend reconsider/reject.

You return STRICT JSON only. Schema:
{
  "alignmentScore": <integer 0-100>,
  "alignmentReasoning": "<3-5 sentences citing specific brand context>",
  "reversibility": "easy" | "medium" | "hard" | "irreversible",
  "reversalCostNotes": "<1 sentence: specific cost/time to reverse>",
  "strongestArguments": ["<concrete argument>", ...],
  "risks": ["<concrete risk>", ...],
  "patternMatch": "<cite a specific prior decision if relevant, or 'No clear pattern'>",
  "recommendation": "proceed" | "proceed_carefully" | "reconsider" | "reject"
}

Alignment bands:
- 90+: Strongly accelerates strategic goals
- 70-89: Aligned but with tradeoffs
- 50-69: Tangential or unclear impact
- <50: Drift or contradiction with strategy

Reversibility (Bezos two-way doors):
- easy: < 1 week, minimal cost
- medium: 2-4 weeks, moderate cost
- hard: significant cost/time to reverse
- irreversible: cannot meaningfully undo

Discipline:
- Cite brand context specifically (niche, audience, pillars).
- No generic advice. If a risk isn't concrete, drop it.
- Match the founder's working language (Spanish for LATAM brands).
- Reasoning ≤ 600 chars total. Bounded output, no rambling.`;

  const userMessage = `BRAND NORTH STAR
Name: ${project.name}
Niche: ${analysis.niche}
Specificity target: ${analysis.specificityRecommended ?? 'niche'}
Competitor gap: ${analysis.competitorGap ?? '(none)'}
Primary audience: ${typeof layers.primary === 'string' ? layers.primary : '(unset)'}
Secondary audience: ${typeof layers.secondary === 'string' ? layers.secondary : '(unset)'}

POSITIONING BENCHMARK
${
  benchmark
    ? `Market gap: ${benchmark.marketGap ?? '(none)'}\nUnique positioning: ${benchmark.uniquePositioning ?? '(none)'}`
    : '(no benchmark yet)'
}

RECENT DECISIONS (for pattern detection)
${
  recentDecisions.length > 0
    ? recentDecisions
        .map(
          (d) =>
            `- "${d.title}" (${d.category ?? 'uncategorized'}, ${d.alignmentScore ?? '?'}/100 alignment, status: ${d.status}${d.outcomeWorked === true ? ', worked: yes' : d.outcomeWorked === false ? ', worked: no' : ''})`,
        )
        .join('\n')
    : '(no prior decisions logged)'
}

PROPOSED DECISION
Title: ${title.trim()}
Category: ${category}
Description: ${description || '(no description)'}

Score it. JSON only.`;

  let parsed: unknown;
  try {
    const response = await anthropic.messages.create({
      model: MODELS.OPUS,
      max_tokens: 4000,
      system: cachedSystem(systemPrompt),
      messages: [{ role: 'user', content: userMessage }],
    });

    await trackUsage({
      endpoint: 'compass-decision-score',
      model: MODELS.OPUS,
      usage: response.usage,
      userId: user.id,
      projectId,
    });

    if (response.stop_reason === 'max_tokens') {
      console.error('[decision-score] Opus hit max_tokens; output truncated');
      return NextResponse.json(
        {
          error:
            'Scoring output too long — Opus hit the token ceiling. Try a shorter description.',
        },
        { status: 502 },
      );
    }

    const textBlock = response.content.find((b) => b.type === 'text');
    const raw = textBlock?.type === 'text' ? textBlock.text : '';
    parsed = JSON.parse(cleanJson(raw));
  } catch (err) {
    console.error('[decision-score] Opus failed:', err);
    return NextResponse.json(
      {
        error: 'Scoring failed',
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }

  if (!parsed || typeof parsed !== 'object') {
    return NextResponse.json(
      { error: 'Scoring returned non-object output' },
      { status: 502 },
    );
  }

  const p = parsed as Record<string, unknown>;
  const reversibilityRaw = asStr(p.reversibility, 20).toLowerCase();
  const recommendationRaw = asStr(p.recommendation, 30).toLowerCase();

  const scoring = {
    alignmentScore: asInt(p.alignmentScore),
    alignmentReasoning: asStr(p.alignmentReasoning, 1200),
    reversibility: VALID_REVERSIBILITIES.has(reversibilityRaw)
      ? reversibilityRaw
      : 'medium',
    reversalCostNotes: asStr(p.reversalCostNotes, 500),
    strongestArguments: asStringArray(p.strongestArguments, 5),
    risks: asStringArray(p.risks, 5),
    patternMatch: asStr(p.patternMatch, 400) || 'No clear pattern',
    recommendation: VALID_RECOMMENDATIONS.has(recommendationRaw)
      ? recommendationRaw
      : 'proceed_carefully',
  };

  // NOTE: deliberately NOT persisted. The founder calls
  // /api/compass/decisions (POST) next with these fields if they
  // decide to commit. That's the score-then-commit flow.
  return NextResponse.json({
    success: true,
    scoring,
  });
}
