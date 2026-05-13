// PR #68 — Sprint 7.1B: Priority Matrix generator.
//
// Synthesizes 8-12 strategic moves from the project's full Compass
// context (brand analysis, positioning benchmark, research pain
// points, recent posts). Each move is scored Impact × Effort and
// quadrant-bucketed. Founder uses the matrix as a "what next" GPS
// instead of guessing.
//
// Inputs read directly from DB (no internal fetch); aligns with
// the convention from auto-connect-sources (Sprint 7.0.5).
//
// Cache: 7-day TTL. Cache hits skip rate limit + return instantly.
// Force regenerate via { force: true }.
//
// Cost ceiling: 3/hr per user. Opus ~$0.10-0.15 per generation.
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  priorityMatrices,
  priorityItems,
  projects,
  brandAnalysis,
  positioningBenchmarks,
  researchInsights,
  generatedPosts,
} from '@/lib/db/schema';
import { eq, and, desc, gte } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import {
  anthropic,
  MODELS,
  cachedSystem,
  LANGUAGE_INSTRUCTION_ANALYSIS,
} from '@/lib/ai/claude';
import { trackUsage } from '@/lib/ai/usage-tracker';
import { checkRateLimit } from '@/lib/rate-limit';

export const maxDuration = 90;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TTL_DAYS = 7;
const HIGH_IMPACT_THRESHOLD = 70;
const LOW_EFFORT_THRESHOLD = 40;

const VALID_QUADRANTS = new Set(['do_now', 'scheduled', 'fillers', 'avoid']);
const VALID_SOURCE_TYPES = new Set([
  'pain_point',
  'opportunity',
  'competitor_gap',
  'content_gap',
]);

interface PainPointRecord {
  theme: string;
  frequency: number;
  sampleQuote?: string;
  platform?: string;
  isOnDomain?: boolean;
  actionableAngle?: string;
}

interface OpusItem {
  title?: unknown;
  description?: unknown;
  impactScore?: unknown;
  effortScore?: unknown;
  sourceType?: unknown;
  sourceContext?: unknown;
  suggestedAction?: unknown;
  suggestedContentType?: unknown;
  suggestedPlatform?: unknown;
  reasoning?: unknown;
}

function cleanJson(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function asStr(v: unknown, max = 500): string {
  if (typeof v !== 'string') return '';
  return v.slice(0, max);
}

function asInt(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function deriveQuadrant(impact: number, effort: number): string {
  if (impact >= HIGH_IMPACT_THRESHOLD && effort <= LOW_EFFORT_THRESHOLD) return 'do_now';
  if (impact >= HIGH_IMPACT_THRESHOLD && effort > LOW_EFFORT_THRESHOLD) return 'scheduled';
  if (impact < HIGH_IMPACT_THRESHOLD && effort <= LOW_EFFORT_THRESHOLD) return 'fillers';
  return 'avoid';
}

function extractPainPoints(insight: typeof researchInsights.$inferSelect | undefined): PainPointRecord[] {
  if (!insight?.painPoints) return [];
  const raw = insight.painPoints;
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
    .map((p) => ({
      theme: typeof p.theme === 'string' ? p.theme : '',
      frequency: typeof p.frequency === 'number' ? p.frequency : 0,
      sampleQuote: typeof p.sampleQuote === 'string' ? p.sampleQuote : undefined,
      platform: typeof p.platform === 'string' ? p.platform : undefined,
      isOnDomain: typeof p.isOnDomain === 'boolean' ? p.isOnDomain : undefined,
      actionableAngle:
        typeof p.actionableAngle === 'string' ? p.actionableAngle : undefined,
    }))
    .filter((p) => p.theme)
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 10);
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

  // Cache lookup BEFORE rate-limit so cache hits are unlimited.
  if (!force) {
    const [cached] = await db
      .select()
      .from(priorityMatrices)
      .where(
        and(
          eq(priorityMatrices.projectId, projectId),
          gte(priorityMatrices.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(priorityMatrices.createdAt))
      .limit(1);
    if (cached) {
      const items = await db
        .select()
        .from(priorityItems)
        .where(eq(priorityItems.matrixId, cached.id))
        .orderBy(desc(priorityItems.impactScore));
      return NextResponse.json({
        success: true,
        cached: true,
        matrix: cached,
        items,
      });
    }
  }

  const limit = checkRateLimit(
    `compass-matrix:${user.id}`,
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
        error: 'Brand analysis required',
        hint: 'Run Smart Auto-configure on /research first.',
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

  const [latestInsight] = await db
    .select()
    .from(researchInsights)
    .where(eq(researchInsights.projectId, projectId))
    .orderBy(desc(researchInsights.createdAt))
    .limit(1);
  const painPoints = extractPainPoints(latestInsight);

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentPosts = await db
    .select({
      id: generatedPosts.id,
      platform: generatedPosts.platform,
      contentType: generatedPosts.contentType,
      content: generatedPosts.content,
      structuredContent: generatedPosts.structuredContent,
      createdAt: generatedPosts.createdAt,
    })
    .from(generatedPosts)
    .where(
      and(
        eq(generatedPosts.projectId, projectId),
        gte(generatedPosts.createdAt, sevenDaysAgo),
      ),
    )
    .orderBy(desc(generatedPosts.createdAt))
    .limit(12);

  const layers =
    typeof analysis.audienceLayers === 'object' && analysis.audienceLayers
      ? (analysis.audienceLayers as Record<string, unknown>)
      : {};

  const benchOpps = Array.isArray(benchmark?.opportunitiesAccionable)
    ? (benchmark!.opportunitiesAccionable as Record<string, unknown>[]).slice(0, 6)
    : [];
  const benchWeak = Array.isArray(benchmark?.defensiveWeaknesses)
    ? (benchmark!.defensiveWeaknesses as Record<string, unknown>[]).slice(0, 4)
    : [];

  function postSnippet(p: typeof recentPosts[number]): string {
    const sc = p.structuredContent as Record<string, unknown> | null;
    const hook =
      sc && typeof sc.hook === 'string'
        ? sc.hook
        : sc && typeof sc.caption === 'string'
          ? sc.caption
          : sc && typeof sc.title === 'string'
            ? sc.title
            : '';
    const head = hook || p.content || '';
    return `${p.platform}/${p.contentType ?? 'plain'}: ${head.slice(0, 80)}`;
  }

  const systemPrompt = `You are a senior brand strategist generating a Priority Matrix. You return STRICT JSON only — no markdown fences, no prose outside the JSON.

Output shape:
{
  "items": [
    {
      "title": "<5-10 word action-oriented title>",
      "description": "<1-2 sentence concrete description>",
      "impactScore": <integer 0-100>,
      "effortScore": <integer 0-100>,
      "sourceType": "pain_point" | "opportunity" | "competitor_gap" | "content_gap",
      "sourceContext": "<which input motivated this — cite the actual signal>",
      "suggestedAction": "<specific next step the founder can take>",
      "suggestedContentType": "reel" | "carousel" | "photo" | "text_post" | "self_post" | "thread" | "single_tweet" | "single_image" | null,
      "suggestedPlatform": "instagram" | "facebook" | "linkedin" | "reddit" | "threads" | "x" | null,
      "reasoning": "<2-3 sentences why this scores this way>"
    }
  ]
}

Discipline:
- Return EXACTLY 8 items. (Sprint 7.1B hotfix — reduced from 8-12 to keep
  output bounded; max_tokens truncated the JSON mid-string at 12 items.)
- Mix across the four quadrants (don't pile everything in "do_now").
- Title is action-oriented ("Launch X", not "More content about X").
- sourceContext is REQUIRED — never invent reasons. Cite the actual pain point / benchmark opp / competitor gap.
- Refuse generic advice ("be authentic", "engage more", "increase posting frequency"). If a move isn't concrete, drop it.
- Senior strategist tone — brutal honesty over fluff.
- Impact 0-100: how much this moves the niche-dominance needle.
- Effort 0-100: time + resources to ship the first version.
- Keep reasoning + description compact — every word counts against the
  token budget. Two sentences each, max.

${LANGUAGE_INSTRUCTION_ANALYSIS}`;

  const userMessage = `BRAND
Name: ${project.name}
Niche: ${analysis.niche}
Specificity target: ${analysis.specificityRecommended ?? 'niche'}
Primary audience: ${typeof layers.primary === 'string' ? layers.primary : '(unset)'}
Secondary audience: ${typeof layers.secondary === 'string' ? layers.secondary : '(unset)'}
Competitor gap (analysis): ${analysis.competitorGap ?? '(none)'}

POSITIONING BENCHMARK
${benchmark ? `Market gap: ${benchmark.marketGap ?? '(none)'}
Unique positioning: ${benchmark.uniquePositioning ?? '(none)'}
Top opportunities (${benchOpps.length}):
${benchOpps
  .map(
    (o, i) =>
      `  ${i + 1}. ${typeof o.opportunity === 'string' ? o.opportunity : ''}: ${typeof o.rationale === 'string' ? o.rationale : ''}`,
  )
  .join('\n')}
Defensive weaknesses:
${benchWeak
  .map(
    (w, i) =>
      `  ${i + 1}. ${typeof w.area === 'string' ? w.area : ''}: ${typeof w.whyTheyWin === 'string' ? w.whyTheyWin : ''}`,
  )
  .join('\n')}` : '(no positioning benchmark — skip competitor-gap items)'}

AUDIENCE PAIN POINTS (from research, sorted by frequency)
${
  painPoints.length === 0
    ? '(no pain points extracted yet — skip pain_point items)'
    : painPoints
        .map(
          (p) =>
            `- ${p.theme} (${p.frequency}× on ${p.platform ?? 'unknown'}): ${p.actionableAngle ?? ''}`,
        )
        .join('\n')
}

RECENT CONTENT (last 7 days, ${recentPosts.length} drafts/posts):
${recentPosts.length === 0 ? '(none yet)' : recentPosts.slice(0, 10).map(postSnippet).join('\n')}

Generate the matrix. JSON only.`;

  let parsed: { items?: OpusItem[] } | null = null;
  let rawOutput = '';
  try {
    // Sprint 7.1B hotfix: bumped max_tokens 4000 → 8000. With ~8 items
    // × the structured schema (title + description + reasoning +
    // sourceContext + suggestedAction etc.) the JSON output runs
    // ~10-14k chars, and 4000 tokens was clipping it mid-string.
    // 8000 leaves comfortable headroom and we still detect truncation
    // explicitly below as defense-in-depth.
    const response = await anthropic.messages.create({
      model: MODELS.OPUS,
      max_tokens: 8000,
      system: cachedSystem(systemPrompt),
      messages: [{ role: 'user', content: userMessage }],
    });
    await trackUsage({
      endpoint: 'compass-priority-matrix',
      model: MODELS.OPUS,
      usage: response.usage,
      userId: user.id,
      projectId,
    });

    // Explicit truncation guard. If Opus stops because it hit the
    // token cap, the JSON is by definition malformed — fail fast
    // with an actionable reason instead of feeding a half-string
    // into JSON.parse and surfacing "Unexpected end of JSON input".
    if (response.stop_reason === 'max_tokens') {
      console.error(
        '[priority-matrix] Opus hit max_tokens; output too long for the schema.',
      );
      return NextResponse.json(
        {
          error:
            'Matrix output too long — Opus hit the token ceiling. Try regenerating; if it keeps failing, the brand context is unusually rich and we need to shorten the prompt.',
        },
        { status: 502 },
      );
    }

    const textBlock = response.content.find((b) => b.type === 'text');
    rawOutput = textBlock?.type === 'text' ? textBlock.text : '';
    parsed = JSON.parse(cleanJson(rawOutput)) as { items?: OpusItem[] };
  } catch (err) {
    // Log enough detail to diagnose without leaking the full output.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[priority-matrix] Opus failed (raw length=${rawOutput.length}):`,
      msg,
    );
    return NextResponse.json(
      {
        error: 'Matrix generation failed',
        details: msg,
        rawLength: rawOutput.length,
      },
      { status: 502 },
    );
  }

  if (!parsed || !Array.isArray(parsed.items)) {
    return NextResponse.json(
      { error: 'Matrix returned unusable output' },
      { status: 502 },
    );
  }

  const cleanItems = parsed.items
    .filter((i) => i && typeof i === 'object')
    .map((i) => {
      const impact = asInt(i.impactScore);
      const effort = asInt(i.effortScore);
      const sourceTypeRaw = asStr(i.sourceType, 40);
      return {
        title: asStr(i.title, 200),
        description: asStr(i.description, 600),
        impactScore: impact,
        effortScore: effort,
        quadrant: deriveQuadrant(impact, effort),
        sourceType: VALID_SOURCE_TYPES.has(sourceTypeRaw)
          ? sourceTypeRaw
          : null,
        sourceContext: asStr(i.sourceContext, 400),
        suggestedAction: asStr(i.suggestedAction, 400),
        suggestedContentType: asStr(i.suggestedContentType, 40) || null,
        suggestedPlatform: asStr(i.suggestedPlatform, 40) || null,
        reasoning: asStr(i.reasoning, 600),
      };
    })
    .filter((i) => i.title && i.sourceContext);

  if (cleanItems.length === 0) {
    return NextResponse.json(
      { error: 'No valid items extracted from model output' },
      { status: 502 },
    );
  }

  const counts = {
    do_now: 0,
    scheduled: 0,
    fillers: 0,
    avoid: 0,
  };
  for (const i of cleanItems) {
    if (i.quadrant in counts) {
      counts[i.quadrant as keyof typeof counts]++;
    }
  }

  const expiresAt = new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000);
  const [savedMatrix] = await db
    .insert(priorityMatrices)
    .values({
      projectId,
      userId: user.id,
      sourcesUsed: {
        brandAnalysisId: analysis.id,
        benchmarkId: benchmark?.id ?? null,
        painPointsCount: painPoints.length,
        recentPostsCount: recentPosts.length,
      },
      totalItems: cleanItems.length,
      itemsDoNow: counts.do_now,
      itemsScheduled: counts.scheduled,
      itemsFillers: counts.fillers,
      itemsAvoid: counts.avoid,
      modelUsed: 'claude-opus-4-7',
      generationCostUsd: '0.15',
      expiresAt,
    })
    .returning();

  const insertedItems = await db
    .insert(priorityItems)
    .values(
      cleanItems.map((i) => ({
        matrixId: savedMatrix.id,
        projectId,
        title: i.title,
        description: i.description,
        impactScore: i.impactScore,
        effortScore: i.effortScore,
        quadrant: i.quadrant,
        sourceType: i.sourceType,
        sourceContext: i.sourceContext,
        suggestedAction: i.suggestedAction,
        suggestedContentType: i.suggestedContentType,
        suggestedPlatform: i.suggestedPlatform,
        reasoning: i.reasoning,
      })),
    )
    .returning();

  return NextResponse.json({
    success: true,
    cached: false,
    matrix: savedMatrix,
    items: insertedItems,
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

  const [matrix] = await db
    .select()
    .from(priorityMatrices)
    .where(eq(priorityMatrices.projectId, projectId))
    .orderBy(desc(priorityMatrices.createdAt))
    .limit(1);

  if (!matrix) {
    return NextResponse.json({ hasMatrix: false, matrix: null, items: [] });
  }

  const items = await db
    .select()
    .from(priorityItems)
    .where(eq(priorityItems.matrixId, matrix.id))
    .orderBy(desc(priorityItems.impactScore));

  return NextResponse.json({ hasMatrix: true, matrix, items });
}
