// PR #70 — Sprint 7.1C: Blind Spots scanner.
//
// Six fixed frameworks every brand can quietly drift into:
//   1. credibility_gap      — "we say X but content doesn't show X"
//   2. pricing_psychology   — "free→paid jump unmotivated"
//   3. icp_drift            — "audience shift visible in posts"
//   4. content_product_mismatch — "posting A, selling B"
//   5. platform_scatter     — "thin presence across too many platforms"
//   6. social_proof_vacuum  — "no user/customer voice in content"
//
// One Opus 4.7 call returns all six in a single JSON array — even
// the ones it finds NO issue with (we persist them as
// detected=false so the founder sees what was checked, not just
// what triggered).
//
// Refresh strategy: DELETE all rows for the project, INSERT the
// fresh 6. The most recent scan is the source of truth; cache
// (14-day) skips re-runs unless force=true.
//
// max_tokens: 8000 — learned from the Sprint 7.1B truncation
// hotfix. 6 items × the full schema (title/description/evidence/
// recommendation/suggestedActions) clears comfortably under 8k.
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  compassBlindSpots,
  projects,
  brandAnalysis,
  positioningBenchmarks,
  generatedPosts,
} from '@/lib/db/schema';
import { eq, and, desc, gte } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { anthropic, MODELS, cachedSystem } from '@/lib/ai/claude';
import { trackUsage } from '@/lib/ai/usage-tracker';
import { checkRateLimit } from '@/lib/rate-limit';
import type { BrandBible } from '@/lib/types/brand';

export const maxDuration = 90;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FRAMEWORKS = [
  'credibility_gap',
  'pricing_psychology',
  'icp_drift',
  'content_product_mismatch',
  'platform_scatter',
  'social_proof_vacuum',
] as const;
const FRAMEWORK_SET = new Set<string>(FRAMEWORKS);

const VALID_SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);

const TTL_DAYS = 14;

interface OpusSpot {
  framework?: unknown;
  detected?: unknown;
  severity?: unknown;
  confidenceScore?: unknown;
  title?: unknown;
  description?: unknown;
  evidence?: unknown;
  recommendation?: unknown;
  suggestedActions?: unknown;
}

function cleanJson(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function asStr(v: unknown, max = 1000): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function asInt(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function asStringArray(v: unknown, max = 6): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .slice(0, max)
    .map((s) => s.slice(0, 500));
}

function pillarsSummary(bible: BrandBible | null): string {
  if (!bible?.pillars?.length) return '(none configured)';
  return bible.pillars
    .map(
      (p) =>
        `- ${p?.name ?? 'unnamed'}${p?.description ? `: ${p.description}` : ''}`,
    )
    .join('\n');
}

function postSnippet(p: {
  platform: string;
  contentType: string | null;
  content: string | null;
  structuredContent: unknown;
}): string {
  const sc = (p.structuredContent ?? null) as Record<string, unknown> | null;
  const hook =
    sc && typeof sc.hook === 'string'
      ? sc.hook
      : sc && typeof sc.caption === 'string'
        ? sc.caption
        : sc && typeof sc.title === 'string'
          ? sc.title
          : '';
  const head = hook || p.content || '';
  return `- ${p.platform}/${p.contentType ?? 'plain'}: ${head.slice(0, 100)}`;
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

  // Cache before rate-limit — cache hits free.
  if (!force) {
    const cachedRows = await db
      .select()
      .from(compassBlindSpots)
      .where(
        and(
          eq(compassBlindSpots.projectId, projectId),
          gte(compassBlindSpots.expiresAt, new Date()),
        ),
      )
      .orderBy(
        desc(compassBlindSpots.detected),
        desc(compassBlindSpots.confidenceScore),
      );
    if (cachedRows.length >= FRAMEWORKS.length) {
      return NextResponse.json({
        success: true,
        cached: true,
        blindSpots: cachedRows,
        summary: summarize(cachedRows),
      });
    }
  }

  const limit = checkRateLimit(
    `compass-blind-spots:${user.id}`,
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

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recentPosts = await db
    .select({
      platform: generatedPosts.platform,
      contentType: generatedPosts.contentType,
      content: generatedPosts.content,
      structuredContent: generatedPosts.structuredContent,
    })
    .from(generatedPosts)
    .where(
      and(
        eq(generatedPosts.projectId, projectId),
        gte(generatedPosts.createdAt, thirtyDaysAgo),
      ),
    )
    .orderBy(desc(generatedPosts.createdAt))
    .limit(40);

  const bible = (project.brandContext as BrandBible | null) ?? null;

  // Compose snapshot the prompt cites + we persist on every row.
  const platformDistribution: Record<string, number> = {};
  const contentTypeDistribution: Record<string, number> = {};
  for (const p of recentPosts) {
    platformDistribution[p.platform] =
      (platformDistribution[p.platform] ?? 0) + 1;
    const ct = p.contentType ?? 'untyped';
    contentTypeDistribution[ct] = (contentTypeDistribution[ct] ?? 0) + 1;
  }

  const inputsSnapshot = {
    brandPillars: (bible?.pillars ?? []).map((p) => ({
      name: p?.name,
      description: p?.description,
    })),
    audienceLayers: analysis.audienceLayers,
    niche: analysis.niche,
    specificityRecommended: analysis.specificityRecommended,
    competitorGap: analysis.competitorGap,
    postsLast30Days: recentPosts.length,
    platformDistribution,
    contentTypeDistribution,
    benchmarkPresent: Boolean(benchmark),
  };

  const layers =
    typeof analysis.audienceLayers === 'object' && analysis.audienceLayers
      ? (analysis.audienceLayers as Record<string, unknown>)
      : {};

  const systemPrompt = `You are a senior brand strategist scanning for STRATEGIC BLIND SPOTS — drift patterns founders typically don't see until they become crises.

You return STRICT JSON only — a top-level array of EXACTLY 6 items, one per framework, in this order:
  1. credibility_gap
  2. pricing_psychology
  3. icp_drift
  4. content_product_mismatch
  5. platform_scatter
  6. social_proof_vacuum

For each framework, decide honestly whether it's an issue right now. If NOT detected, still include the row with detected=false and a one-sentence reason in description — transparency over hiding.

Object shape (every key required, severity nullable):
{
  "framework": "<one of the 6 keys>",
  "detected": true | false,
  "severity": "low" | "medium" | "high" | "critical" | null,
  "confidenceScore": <integer 0-100>,
  "title": "<5-10 word honest title>",
  "description": "<2 short sentences>",
  "evidence": ["<concrete citation from the inputs>", ...],
  "recommendation": "<one sentence>",
  "suggestedActions": ["<specific move>", ...]
}

Discipline:
- Evidence MUST cite real data (post counts, platforms, pillar names). Drop the framework before inventing.
- No generic advice ("post more consistently", "be authentic"). If the move isn't concrete, drop it.
- severity=null when detected=false. Otherwise use the actual band.
- confidenceScore reflects how sure you are about the call — low confidence is fine when data is thin.
- Match the founder's working language (Spanish for Mexican brands etc.).
- Each item ≤ ~600 chars total — bounded output, no rambling.`;

  const userMessage = `BRAND
Name: ${project.name}
Niche: ${analysis.niche}
Specificity target: ${analysis.specificityRecommended ?? 'niche'}
Competitor gap: ${analysis.competitorGap ?? '(none)'}

AUDIENCE LAYERS
Primary: ${typeof layers.primary === 'string' ? layers.primary : '(unset)'}
Secondary: ${typeof layers.secondary === 'string' ? layers.secondary : '(unset)'}

BRAND PILLARS
${pillarsSummary(bible)}

CONTENT SNAPSHOT (last 30 days, ${recentPosts.length} posts)
Platform distribution: ${JSON.stringify(platformDistribution)}
Content-type distribution: ${JSON.stringify(contentTypeDistribution)}

SAMPLE POSTS (most recent 10):
${recentPosts.slice(0, 10).map(postSnippet).join('\n')}

POSITIONING BENCHMARK
${
  benchmark
    ? `Market gap: ${benchmark.marketGap ?? '(none)'}\nUnique positioning: ${benchmark.uniquePositioning ?? '(none)'}`
    : '(no benchmark yet — skip competitor-related cues)'
}

Scan all 6 frameworks. JSON array only.`;

  let parsed: unknown;
  try {
    const response = await anthropic.messages.create({
      model: MODELS.OPUS,
      max_tokens: 8000,
      system: cachedSystem(systemPrompt),
      messages: [{ role: 'user', content: userMessage }],
    });

    await trackUsage({
      endpoint: 'compass-blind-spots',
      model: MODELS.OPUS,
      usage: response.usage,
      userId: user.id,
      projectId,
    });

    if (response.stop_reason === 'max_tokens') {
      console.error('[blind-spots] Opus hit max_tokens; output truncated');
      return NextResponse.json(
        {
          error:
            'Blind-spots output too long — Opus hit the token ceiling. Try regenerating.',
        },
        { status: 502 },
      );
    }

    const textBlock = response.content.find((b) => b.type === 'text');
    const raw = textBlock?.type === 'text' ? textBlock.text : '';
    parsed = JSON.parse(cleanJson(raw));
  } catch (err) {
    console.error('[blind-spots] Opus failed:', err);
    return NextResponse.json(
      {
        error: 'Scan failed',
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }

  if (!Array.isArray(parsed)) {
    return NextResponse.json(
      { error: 'Scan returned non-array output' },
      { status: 502 },
    );
  }

  // Validate + normalize the 6 items. We accept whatever order Opus
  // returns but require the framework keys to match the closed set;
  // any item with an unrecognized framework is dropped.
  const seen = new Set<string>();
  const normalized: (typeof compassBlindSpots.$inferInsert)[] = [];
  for (const item of parsed as OpusSpot[]) {
    if (!item || typeof item !== 'object') continue;
    const fw = asStr(item.framework, 60);
    if (!FRAMEWORK_SET.has(fw)) continue;
    if (seen.has(fw)) continue; // ignore duplicates
    seen.add(fw);

    const detected = Boolean(item.detected);
    const severityRaw = asStr(item.severity, 20).toLowerCase();
    const severity = detected && VALID_SEVERITIES.has(severityRaw)
      ? severityRaw
      : null;
    const title = asStr(item.title, 200);
    const description = asStr(item.description, 800);
    if (!title || !description) continue;

    normalized.push({
      projectId,
      userId: user.id,
      framework: fw,
      detected,
      severity,
      confidenceScore: asInt(item.confidenceScore),
      title,
      description,
      evidence: asStringArray(item.evidence, 6),
      recommendation: asStr(item.recommendation, 600),
      suggestedActions: asStringArray(item.suggestedActions, 4),
      inputsAnalyzed: inputsSnapshot,
      modelUsed: 'claude-opus-4-7',
      generationCostUsd: '0.15',
      expiresAt: new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000),
    });
  }

  if (normalized.length === 0) {
    return NextResponse.json(
      { error: 'No valid frameworks extracted from Opus output' },
      { status: 502 },
    );
  }

  // Refresh strategy: clear the project's rows, insert fresh batch.
  // Founder's userStatus/userNotes from a prior scan are lost on
  // re-scan — that's intentional, the new scan is the new truth.
  await db
    .delete(compassBlindSpots)
    .where(eq(compassBlindSpots.projectId, projectId));

  const inserted = await db
    .insert(compassBlindSpots)
    .values(normalized)
    .returning();

  return NextResponse.json({
    success: true,
    cached: false,
    blindSpots: inserted,
    summary: summarize(inserted),
  });
}

interface SummaryRow {
  detected: boolean;
  severity: string | null;
  userStatus: string;
}

function summarize(rows: SummaryRow[]): {
  total: number;
  detected: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  open: number;
} {
  return {
    total: rows.length,
    detected: rows.filter((r) => r.detected).length,
    critical: rows.filter((r) => r.detected && r.severity === 'critical')
      .length,
    high: rows.filter((r) => r.detected && r.severity === 'high').length,
    medium: rows.filter((r) => r.detected && r.severity === 'medium').length,
    low: rows.filter((r) => r.detected && r.severity === 'low').length,
    open: rows.filter((r) => r.detected && r.userStatus === 'open').length,
  };
}
