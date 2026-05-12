// PR #67 — Sprint 7.1A: synthesize the Positioning Benchmark.
//
// Opus 4.7 reads the latest brand_analysis row + every scraped
// competitor and returns a structured benchmark:
//   - marketGap: unclaimed positioning
//   - uniquePositioning: defensible claim for our brand
//   - opportunities[]: actionable plays (with effort + expected impact)
//   - defensiveWeaknesses[]: where competitors win + our move
//   - comparisonDimensions: 5-axis us-vs-avg-competitor scoring
//
// Cache 14 days. Force-regenerate via `force: true` body param.
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  projects,
  brandAnalysis,
  competitors,
  positioningBenchmarks,
} from '@/lib/db/schema';
import { eq, and, gte, desc } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { anthropic, MODELS, cachedSystem } from '@/lib/ai/claude';
import { trackUsage } from '@/lib/ai/usage-tracker';
import { checkRateLimit } from '@/lib/rate-limit';

export const maxDuration = 90;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TTL_DAYS = 14;
const MIN_COMPETITORS = 3;

function cleanJson(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function summarizeCompetitor(
  c: typeof competitors.$inferSelect,
): string {
  const platforms = Array.isArray(c.platformPresence)
    ? (c.platformPresence as { platform: string }[])
        .map((p) => p.platform)
        .filter(Boolean)
        .join(', ')
    : '';
  const angles = Array.isArray(c.contentAngles)
    ? (c.contentAngles as string[]).slice(0, 6).join(' · ')
    : '';
  const pricing = Array.isArray(c.pricingVisible)
    ? (c.pricingVisible as { tier: string; price: string }[])
        .map((p) => `${p.tier}=${p.price}`)
        .join(' | ')
    : '';
  return `=== ${c.name} (${c.type ?? 'unknown'}, confidence ${c.confidenceScore ?? '?'}) ===
URL: ${c.url}
Headline: ${c.headline ?? '(none)'}
Value prop: ${c.valueProp ?? '(none)'}
Target audience: ${c.targetAudience ?? '(none)'}
Pricing visible: ${pricing || '(none)'}
Platforms: ${platforms || '(none)'}
Content angles: ${angles || '(none)'}`;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { projectId?: string; force?: boolean };
  try {
    body = (await request.json()) as { projectId?: string; force?: boolean };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { projectId, force = false } = body;
  if (!projectId || !UUID_RE.test(projectId)) {
    return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 });
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

  // Cache lookup before rate limit — cache hits cost nothing.
  if (!force) {
    const [cached] = await db
      .select()
      .from(positioningBenchmarks)
      .where(
        and(
          eq(positioningBenchmarks.projectId, projectId),
          gte(positioningBenchmarks.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(positioningBenchmarks.createdAt))
      .limit(1);
    if (cached) {
      return NextResponse.json({
        success: true,
        cached: true,
        benchmark: cached,
      });
    }
  }

  // Rate-limit Opus runs only — cache hits already returned.
  const limit = checkRateLimit(
    `compass-benchmark:${user.id}`,
    3,
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
        error: 'Run Brand Analysis first',
        hint: 'Open /research and click "Generate analysis".',
      },
      { status: 400 },
    );
  }

  const scraped = await db
    .select()
    .from(competitors)
    .where(
      and(
        eq(competitors.projectId, projectId),
        eq(competitors.approvedByUser, true),
        eq(competitors.scrapeStatus, 'success'),
      ),
    );
  if (scraped.length < MIN_COMPETITORS) {
    return NextResponse.json(
      {
        error: `Need at least ${MIN_COMPETITORS} successfully-scraped competitors. Have ${scraped.length}.`,
        hint: 'Approve more candidates and run Scrape, then come back.',
        currentCount: scraped.length,
      },
      { status: 400 },
    );
  }

  const layers =
    typeof analysis.audienceLayers === 'object' && analysis.audienceLayers
      ? (analysis.audienceLayers as Record<string, unknown>)
      : {};

  const systemPrompt = `You are a senior brand strategist generating a Positioning Benchmark for a founder. You return STRICT JSON only — no markdown fences, no prose outside the JSON.

Output schema:
{
  "marketGap": "string — 2-3 sentences, specific, unclaimed in this landscape",
  "uniquePositioning": "string — 1-2 sentences, defensible claim for OUR brand",
  "opportunities": [
    {
      "opportunity": "string",
      "rationale": "string — why this works given competitor landscape",
      "effort": "low" | "medium" | "high",
      "expectedImpact": "string"
    }
  ],
  "defensiveWeaknesses": [
    {
      "area": "string",
      "whoWins": "competitor name from the input list",
      "whyTheyWin": "string",
      "ourMove": "string — what we do instead"
    }
  ],
  "comparisonDimensions": {
    "audience":  { "us": <0-100>, "competitorsAvg": <0-100>, "reasoning": "string" },
    "pricing":   { "us": <0-100>, "competitorsAvg": <0-100>, "reasoning": "string" },
    "content":   { "us": <0-100>, "competitorsAvg": <0-100>, "reasoning": "string" },
    "tone":      { "us": <0-100>, "competitorsAvg": <0-100>, "reasoning": "string" },
    "channels":  { "us": <0-100>, "competitorsAvg": <0-100>, "reasoning": "string" }
  }
}

Discipline:
- NEVER invent private metrics (revenue, users, MRR, etc.). Only use the scraped data.
- Be honest. If competitors beat us on a dimension, say so + recommend "don't fight here".
- 5-7 opportunities, 3-5 defensive weaknesses.
- Senior-strategist tone. No fluff, no "leverage synergies".`;

  const userMessage = `OUR BRAND
Name: ${project.name}
Niche: ${analysis.niche}
Specificity target: ${analysis.specificityRecommended ?? 'niche'}
Audience primary: ${typeof layers.primary === 'string' ? layers.primary : '(unset)'}
Audience secondary: ${typeof layers.secondary === 'string' ? layers.secondary : '(unset)'}
Competitor gap noted at brand-analysis time: ${analysis.competitorGap ?? '(none)'}

COMPETITORS (${scraped.length} scraped):

${scraped.map(summarizeCompetitor).join('\n\n')}

Generate the benchmark. JSON only.`;

  let parsed: Record<string, unknown> | null = null;
  try {
    const response = await anthropic.messages.create({
      model: MODELS.OPUS,
      max_tokens: 4000,
      system: cachedSystem(systemPrompt),
      messages: [{ role: 'user', content: userMessage }],
    });
    await trackUsage({
      endpoint: 'compass-generate-benchmark',
      model: MODELS.OPUS,
      usage: response.usage,
      userId: user.id,
      projectId,
    });
    const textBlock = response.content.find((b) => b.type === 'text');
    const raw = textBlock?.type === 'text' ? textBlock.text : '';
    parsed = JSON.parse(cleanJson(raw)) as Record<string, unknown>;
  } catch (err) {
    console.error('[generate-benchmark] Opus failed:', err);
    return NextResponse.json(
      {
        error: 'Benchmark generation failed',
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }

  if (!parsed || !parsed.marketGap) {
    return NextResponse.json(
      { error: 'Benchmark returned unusable output' },
      { status: 502 },
    );
  }

  const expiresAt = new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000);
  const [saved] = await db
    .insert(positioningBenchmarks)
    .values({
      projectId,
      userId: user.id,
      marketGap: typeof parsed.marketGap === 'string' ? parsed.marketGap : null,
      uniquePositioning:
        typeof parsed.uniquePositioning === 'string'
          ? parsed.uniquePositioning
          : null,
      opportunitiesAccionable: Array.isArray(parsed.opportunities)
        ? parsed.opportunities
        : [],
      defensiveWeaknesses: Array.isArray(parsed.defensiveWeaknesses)
        ? parsed.defensiveWeaknesses
        : [],
      comparisonDimensions:
        parsed.comparisonDimensions &&
        typeof parsed.comparisonDimensions === 'object'
          ? parsed.comparisonDimensions
          : {},
      competitorsAnalyzed: scraped.length,
      modelUsed: 'claude-opus-4-7',
      generationCostUsd: '0.18',
      expiresAt,
    })
    .returning();

  return NextResponse.json({
    success: true,
    cached: false,
    benchmark: saved,
    competitorsAnalyzed: scraped.length,
  });
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId') ?? '';
  if (!UUID_RE.test(projectId)) {
    return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 });
  }

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [latest] = await db
    .select()
    .from(positioningBenchmarks)
    .where(eq(positioningBenchmarks.projectId, projectId))
    .orderBy(desc(positioningBenchmarks.createdAt))
    .limit(1);

  return NextResponse.json({
    hasBenchmark: Boolean(latest),
    benchmark: latest ?? null,
  });
}
