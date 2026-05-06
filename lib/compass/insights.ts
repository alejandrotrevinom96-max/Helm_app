import { anthropic } from '@/lib/ai/claude';
import type { HelmData } from './data-pull';
import type {
  CompassDimension,
  CompassDimensionId,
  CompassRecommendation,
} from '@/lib/types/compass';

interface InsightsResult {
  bullCase: string[];
  bearCase: string[];
  dueDiligenceQuestion: string;
  recommendations: CompassRecommendation[];
}

const VALID_DIMS: CompassDimensionId[] = [
  'validation',
  'strategy',
  'execution',
  'traction',
  'market',
];
const VALID_EFFORTS: Array<CompassRecommendation['effort']> = [
  'low',
  'medium',
  'high',
];

function fallback(reason: string): InsightsResult {
  return {
    bullCase: ['Compute analysis failed — try recomputing'],
    bearCase: [reason],
    dueDiligenceQuestion: 'Retry the compass reading.',
    recommendations: [],
  };
}

export async function generateInsights(
  totalScore: number,
  dimensions: CompassDimension[],
  data: HelmData,
  formData: Record<string, unknown>
): Promise<InsightsResult> {
  // Surface the biggest gap-by-points so the model has a concrete focus
  // list rather than hand-rolling its own ranking from prose.
  const allGaps = dimensions
    .flatMap((d) =>
      d.subcriteria.map((s) => ({
        dimensionId: d.id,
        dimensionName: d.name,
        name: s.name,
        pts: s.pts,
        maxPts: s.maxPts,
        evidence: s.evidence,
        gap: s.maxPts - s.pts,
      }))
    )
    .filter((g) => g.gap > 0)
    .sort((a, b) => b.gap - a.gap);
  const top10Gaps = allGaps.slice(0, 10);

  const prompt = `You are a senior venture analyst evaluating an indie hacker project. Generate concrete, actionable insights.

═══════ CURRENT SCORE ═══════
Total: ${totalScore}/100

By dimension:
${dimensions.map((d) => `- ${d.name}: ${d.pts}/${d.maxPts}`).join('\n')}

═══════ TOP GAPS (sorted by potential lift) ═══════
${top10Gaps.map((g) => `- [${g.dimensionName}] ${g.name}: ${g.pts}/${g.maxPts} pts. ${g.evidence}`).join('\n')}

═══════ HELM DATA SUMMARY ═══════
- Project: ${data.project?.name ?? 'unknown'}
- Tagline: "${data.brandBible?.identity?.tagline ?? 'none'}"
- Archetype: ${data.brandBible?.archetype?.primary ?? 'none'}
- Pillars: ${(data.brandBible?.pillars ?? []).map((p) => p.name).join(', ') || 'none'}
- Waitlist signups: ${data.uniqueWaitlistSignups}
- Pricing-test responses: ${data.pricingTestResponses.length}
- Survey pain quotes: ${data.surveyResponses.length}
- Posts last 30d: ${data.scheduledPostsLast30d}
- Days since last activity: ${data.daysSinceLastPost ?? 'unknown'}
- Competitors tracked: ${data.competitorsConfigured.join(', ') || 'none'}
- 7-day signup growth: ${data.signupGrowthRate7d}%

Form data provided by founder:
${JSON.stringify(formData, null, 2)}

═══════ TASK ═══════

Output STRICTLY valid JSON, no markdown fences:

{
  "bullCase": [
    "string (specific strength, max 25 words)",
    "...2-3 items max"
  ],
  "bearCase": [
    "string (specific weakness, max 25 words)",
    "...2-3 items max"
  ],
  "dueDiligenceQuestion": "string (the ONE most important question to investigate, max 30 words)",
  "recommendations": [
    {
      "dimension": "validation" | "strategy" | "execution" | "traction" | "market",
      "title": "string (specific action, max 12 words)",
      "description": "string (why this matters, max 40 words)",
      "scoreLift": number (estimated +X pts),
      "ctaLabel": "string (max 4 words, like 'Schedule a post') OR null",
      "ctaHref": "/marketing" | "/marketing/calendar" | "/marketing/library" | "/marketing/scheduled" | "/research" | "/compass" | null,
      "effort": "low" | "medium" | "high",
      "priority": number (1-10, 10 = highest)
    }
    ...exactly 5 recommendations sorted by priority desc
  ]
}

RULES:
- Recommendations MUST be specific. "Improve marketing" is bad. "Schedule 4 posts this week leaning into 'Speed' pillar" is good.
- ctaHref values: '/marketing' for content/brand-bible, '/marketing/scheduled' for performance ratings, '/research' for competitor scanning, '/compass' for strategic recompute, null if no internal action.
- scoreLift must be realistic (max gap from rubric). Be conservative.
- priority should reflect: lift size × effort efficiency × strategic importance.
- Cover at least 3 different dimensions in the 5 recommendations.`;

  let response;
  try {
    response = await anthropic.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (e) {
    return fallback(
      e instanceof Error ? `AI call failed: ${e.message}` : 'AI call failed'
    );
  }

  const textBlock = response.content.find((b) => b.type === 'text');
  let raw = textBlock?.type === 'text' ? textBlock.text.trim() : '';
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  let parsed: {
    bullCase?: unknown;
    bearCase?: unknown;
    dueDiligenceQuestion?: unknown;
    recommendations?: unknown;
  };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return fallback('Could not parse AI response');
  }

  const bullCase = Array.isArray(parsed.bullCase)
    ? parsed.bullCase
        .filter((s): s is string => typeof s === 'string')
        .slice(0, 3)
    : [];
  const bearCase = Array.isArray(parsed.bearCase)
    ? parsed.bearCase
        .filter((s): s is string => typeof s === 'string')
        .slice(0, 3)
    : [];
  const dueDiligenceQuestion =
    typeof parsed.dueDiligenceQuestion === 'string'
      ? parsed.dueDiligenceQuestion
      : '';

  const recsRaw = Array.isArray(parsed.recommendations)
    ? parsed.recommendations
    : [];
  const recommendations: CompassRecommendation[] = recsRaw
    .map((r, i): CompassRecommendation | null => {
      if (!r || typeof r !== 'object') return null;
      const rec = r as Record<string, unknown>;
      const dimension = rec.dimension;
      if (
        typeof dimension !== 'string' ||
        !VALID_DIMS.includes(dimension as CompassDimensionId)
      ) {
        return null;
      }
      const title = typeof rec.title === 'string' ? rec.title : '';
      const description =
        typeof rec.description === 'string' ? rec.description : '';
      const scoreLift = Math.max(
        0,
        Math.min(25, Number(rec.scoreLift) || 0)
      );
      const ctaLabel =
        typeof rec.ctaLabel === 'string' && rec.ctaLabel.trim().length > 0
          ? rec.ctaLabel
          : null;
      const ctaHref =
        typeof rec.ctaHref === 'string' && rec.ctaHref.startsWith('/')
          ? rec.ctaHref
          : null;
      const effortRaw = rec.effort;
      const effort: CompassRecommendation['effort'] =
        typeof effortRaw === 'string' &&
        VALID_EFFORTS.includes(effortRaw as CompassRecommendation['effort'])
          ? (effortRaw as CompassRecommendation['effort'])
          : 'medium';
      const priority = Math.max(
        1,
        Math.min(10, Number(rec.priority) || 5)
      );
      return {
        id: `rec-${i}`,
        dimension: dimension as CompassDimensionId,
        title,
        description,
        scoreLift,
        cta: ctaLabel && ctaHref ? { label: ctaLabel, href: ctaHref } : null,
        effort,
        priority,
      };
    })
    .filter((r): r is CompassRecommendation => r !== null)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 5);

  return {
    bullCase,
    bearCase,
    dueDiligenceQuestion,
    recommendations,
  };
}
