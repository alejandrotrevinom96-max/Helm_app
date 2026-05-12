// PR #62 — Sprint 7.0.5: Smart Brand Analysis.
//
// Two-pass deep analysis of a project's brand bible:
//   PASS 1 (Opus 4.7): niche, audience layers, competitor gap, and
//   recommended specificity. This is the strategic read — we pay
//   for Opus because the founder is going to act on this output
//   (set keywords, connect sources).
//   PASS 2 (Haiku 4.5): expand the Opus output into ~15 search
//   keywords + ~10 suggested sources + tone guidance + competitor
//   angles. Cheap follow-up; Haiku is more than sufficient.
//
// Cached 30 days per project. Founder can force-regenerate via the
// `force: true` body param.
//
// Cost ceiling: 3 analyses per hour per user (Opus runs ~$0.10/call).
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  projects,
  brandAnalysis,
  brandAnalysisJobs,
  researchConfig,
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

// PR #72 — Sprint 7.2A hotfix: jobs older than this are treated as
// dead. Vercel's maxDuration above is 90s, so anything still
// 'running' past 5 minutes is a crashed handler (or a Vercel cold
// start that timed out client-side and we never got the completion
// write). We mark them failed and proceed.
const STALE_JOB_MS = 5 * 60 * 1000;

// Categorize an unknown error into one of our known buckets so the
// UI can render an actionable message instead of "AI analysis
// failed". Order matters — the matches cascade, first hit wins.
function categorizeError(
  err: unknown,
): { kind: 'overloaded' | 'timeout' | 'json' | 'rate_limit' | 'unknown'; message: string } {
  const msg = err instanceof Error ? err.message : String(err);
  const lc = msg.toLowerCase();
  if (lc.includes('overloaded') || lc.includes('529')) {
    return { kind: 'overloaded', message: msg };
  }
  if (
    lc.includes('rate limit') ||
    lc.includes('429') ||
    lc.includes('too many requests')
  ) {
    return { kind: 'rate_limit', message: msg };
  }
  if (
    lc.includes('timeout') ||
    lc.includes('timed out') ||
    lc.includes('aborted')
  ) {
    return { kind: 'timeout', message: msg };
  }
  if (
    lc.includes('json') ||
    lc.includes('unexpected token') ||
    lc.includes('unterminated string')
  ) {
    return { kind: 'json', message: msg };
  }
  return { kind: 'unknown', message: msg };
}

// Builds the user-facing error response with a hint that depends on
// the categorized kind. Status code is also kind-specific so the
// client can disambiguate transient from terminal errors.
function errorResponse(kind: ReturnType<typeof categorizeError>['kind']) {
  switch (kind) {
    case 'overloaded':
      return NextResponse.json(
        {
          error: 'Anthropic está saturado ahora mismo.',
          errorKind: 'overloaded',
          retry: true,
          retryAfterSeconds: 60,
          hint: 'Reintentá en ~1 minuto. La cola de Anthropic se libera rápido.',
        },
        { status: 503 },
      );
    case 'rate_limit':
      return NextResponse.json(
        {
          error: 'Anthropic rate-limit alcanzado.',
          errorKind: 'rate_limit',
          retry: true,
          retryAfterSeconds: 120,
          hint: 'Esperá ~2 minutos antes del próximo intento.',
        },
        { status: 503 },
      );
    case 'timeout':
      return NextResponse.json(
        {
          error: 'El análisis tardó más de 60s y se cortó.',
          errorKind: 'timeout',
          retry: true,
          hint: 'Tu brand bible puede ser muy extensa. Simplificá o reintentá — la red puede haber sido el problema.',
        },
        { status: 504 },
      );
    case 'json':
      return NextResponse.json(
        {
          error: 'Opus devolvió respuesta malformada.',
          errorKind: 'json',
          retry: true,
          hint: 'Esto es transient. Reintentá una vez.',
        },
        { status: 502 },
      );
    default:
      return NextResponse.json(
        {
          error: 'Algo falló al analizar tu brand.',
          errorKind: 'unknown',
          retry: true,
          hint: 'Si vuelve a pasar, contactanos con el ID del job.',
        },
        { status: 500 },
      );
  }
}

interface DeepAnalysis {
  niche: string;
  subNiches: string[];
  audienceLayers: {
    primary: string;
    secondary: string;
    tertiary: string;
  };
  competitorGap: string;
  specificityRecommended: 'broad' | 'niche' | 'hyper';
  specificityReasoning: string;
}

interface KeywordExpansion {
  searchKeywords: string[];
  suggestedSources: Array<{
    platform: string;
    identifier: string;
    predictedRelevance: number;
    reasoning: string;
  }>;
  toneGuidance: {
    primary: string;
    secondary: string;
    tertiary: string;
  };
  competitorAngles: string[];
}

function brandSummary(bible: BrandBible | null): string {
  if (!bible) return 'No brand bible.';
  const lines: string[] = [];
  if (bible.identity?.name) lines.push(`Name: ${bible.identity.name}`);
  if (bible.identity?.tagline) lines.push(`Tagline: ${bible.identity.tagline}`);
  if (bible.identity?.industry) lines.push(`Industry: ${bible.identity.industry}`);
  if (bible.identity?.mission) lines.push(`Mission: ${bible.identity.mission}`);
  if (bible.archetype?.primary) lines.push(`Archetype: ${bible.archetype.primary}`);
  if (bible.pillars?.length) {
    lines.push(
      `Pillars:\n${bible.pillars
        .map(
          (p) =>
            `  - ${p?.name ?? 'unnamed'}${p?.description ? ` — ${p.description}` : ''}`,
        )
        .join('\n')}`,
    );
  }
  const primary = bible.audience?.primary;
  if (primary?.description) {
    lines.push(`Audience description: ${primary.description}`);
  }
  if (primary?.demographics) {
    lines.push(`Demographics: ${primary.demographics}`);
  }
  if (primary?.psychographics) {
    lines.push(`Psychographics: ${primary.psychographics}`);
  }
  if (primary?.painPoints?.length) {
    lines.push(
      `Pains:\n${primary.painPoints
        .slice(0, 8)
        .map((p) => `  - ${p.pain} (intensity ${p.intensity}/5)`)
        .join('\n')}`,
    );
  }
  if (primary?.jobsToBeDone?.length) {
    lines.push(`Jobs: ${primary.jobsToBeDone.slice(0, 5).join('; ')}`);
  }
  if (primary?.wateringHoles?.length) {
    lines.push(`Watering holes: ${primary.wateringHoles.slice(0, 8).join(', ')}`);
  }
  return lines.join('\n');
}

function cleanJson(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
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

  // Cached read path — runs BEFORE the rate-limit because a cache
  // hit is free.
  if (!force) {
    const [cached] = await db
      .select()
      .from(brandAnalysis)
      .where(eq(brandAnalysis.projectId, projectId))
      .orderBy(desc(brandAnalysis.createdAt))
      .limit(1);
    if (
      cached &&
      (!cached.expiresAt || new Date(cached.expiresAt) > new Date())
    ) {
      return NextResponse.json({
        success: true,
        cached: true,
        analysis: cached,
      });
    }
  }

  // Beyond this point we're spending money. Rate-limit.
  const limit = checkRateLimit(
    `analyze-brand:${user.id}`,
    3,
    60 * 60 * 1000,
  );
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
        errorKind: 'rate_limit',
        hint: `Try again in ${Math.ceil(limit.resetMs / 60000)} minutes.`,
      },
      { status: 429 },
    );
  }

  const bible = (project.brandContext as BrandBible | null) ?? null;
  if (!bible || !bible.identity?.name) {
    return NextResponse.json(
      {
        error: 'Brand bible not configured',
        errorKind: 'missing_bible',
        hint: 'Complete brand bible in /marketing first.',
      },
      { status: 400 },
    );
  }

  // PR #72 — Sprint 7.2A hotfix: idempotency check.
  //
  // Before paying Opus, look for a running job on this project. If
  // one exists and is fresh (< STALE_JOB_MS old), reject the new call
  // with 409 + the existing job id so the client can show "Analysis
  // already running, wait ~30s" instead of starting a parallel call.
  //
  // If a "running" row exists but is older than STALE_JOB_MS, the
  // handler obviously crashed (no completion write) — we mark it
  // failed and proceed with a fresh job.
  const staleThreshold = new Date(Date.now() - STALE_JOB_MS);
  const [inFlight] = await db
    .select()
    .from(brandAnalysisJobs)
    .where(
      and(
        eq(brandAnalysisJobs.projectId, projectId),
        eq(brandAnalysisJobs.status, 'running'),
        gte(brandAnalysisJobs.startedAt, staleThreshold),
      ),
    )
    .orderBy(desc(brandAnalysisJobs.startedAt))
    .limit(1);

  if (inFlight) {
    return NextResponse.json(
      {
        success: false,
        inProgress: true,
        jobId: inFlight.id,
        startedAt: inFlight.startedAt,
        hint: 'Analysis already running for this project. Wait ~30s for the in-flight call to finish.',
      },
      { status: 409 },
    );
  }

  // Sweep stale 'running' rows for this project. There won't be many
  // (max one or two from prior crashes); the partial index keeps this
  // O(log n).
  await db
    .update(brandAnalysisJobs)
    .set({
      status: 'failed',
      errorKind: 'timeout',
      errorMessage: 'Marked failed by stale-sweep (>5min running).',
      completedAt: new Date(),
    })
    .where(
      and(
        eq(brandAnalysisJobs.projectId, projectId),
        eq(brandAnalysisJobs.status, 'running'),
      ),
    );

  // Claim a fresh job row. From here on every exit path MUST update
  // this row to completed/failed before returning, otherwise the
  // next call will block until the stale-sweep above kicks in.
  const [job] = await db
    .insert(brandAnalysisJobs)
    .values({
      projectId,
      userId: user.id,
      status: 'running',
    })
    .returning();

  // Pull configured competitors so Opus has signal on what to
  // contrast against.
  const [config] = await db
    .select({ competitors: researchConfig.competitors })
    .from(researchConfig)
    .where(eq(researchConfig.projectId, projectId))
    .limit(1);
  const competitors = ((config?.competitors as string[] | null) ?? []).slice(0, 10);

  // ─────── PASS 1 — Deep analysis with Opus ───────
  const opusSystem = `You are a strategic brand analyst. Given a brand bible you return a focused, defensible read on niche, audience layers, competitor gap, and the right specificity for the brand's content strategy.

You return STRICT JSON only — no markdown fences, no prose outside the JSON.

Output schema:
{
  "niche": "<5-10 words, VERY specific — not 'marketing tool' but 'AI marketing for indie founders post-MVP'>",
  "subNiches": ["<2-4 alternative angles>"],
  "audienceLayers": {
    "primary": "<the tightest ICP — concrete persona>",
    "secondary": "<adjacent audience that benefits indirectly>",
    "tertiary": "<aware-but-loose — exists at the brand's edge>"
  },
  "competitorGap": "<1-2 sentences — what's missing in competitors that THIS brand can own (language, audience, framing, pricing)>",
  "specificityRecommended": "broad" | "niche" | "hyper",
  "specificityReasoning": "<1-2 sentences explaining why this level fits the audience size, conversion need, and brand archetype>"
}

Rules:
- Niche must be VERY specific. Vague niches break the rest of the analysis.
- The three audience layers must differ meaningfully from each other.
- Competitor gap must be ACTIONABLE — phrased as something the brand can do.
- Specificity choice must be defensible by the reasoning field.`;

  const opusUser = `BRAND BIBLE
${brandSummary(bible)}

CONFIGURED COMPETITORS
${competitors.length > 0 ? competitors.map((c) => `- ${c}`).join('\n') : '(none configured)'}

Analyze. Return JSON.`;

  let pass1: DeepAnalysis | null = null;
  try {
    const response = await anthropic.messages.create({
      model: MODELS.OPUS,
      max_tokens: 2000,
      system: cachedSystem(opusSystem),
      messages: [{ role: 'user', content: opusUser }],
    });
    await trackUsage({
      endpoint: 'analyze-brand-pass1',
      model: MODELS.OPUS,
      usage: response.usage,
      userId: user.id,
      projectId,
    });
    const textBlock = response.content.find((b) => b.type === 'text');
    const raw = textBlock?.type === 'text' ? textBlock.text : '';
    pass1 = JSON.parse(cleanJson(raw)) as DeepAnalysis;
  } catch (err) {
    console.error('[analyze-brand] pass 1 failed:', err);
    const cat = categorizeError(err);
    await db
      .update(brandAnalysisJobs)
      .set({
        status: 'failed',
        errorKind: cat.kind,
        errorMessage: cat.message.slice(0, 1000),
        completedAt: new Date(),
      })
      .where(eq(brandAnalysisJobs.id, job.id));
    return errorResponse(cat.kind);
  }

  if (!pass1 || !pass1.niche) {
    await db
      .update(brandAnalysisJobs)
      .set({
        status: 'failed',
        errorKind: 'json',
        errorMessage: 'Pass 1 returned unusable output (missing niche).',
        completedAt: new Date(),
      })
      .where(eq(brandAnalysisJobs.id, job.id));
    return errorResponse('json');
  }

  // Clamp specificity to the three allowed values.
  const validSpec = new Set(['broad', 'niche', 'hyper']);
  const spec = validSpec.has(pass1.specificityRecommended)
    ? pass1.specificityRecommended
    : 'niche';

  // ─────── PASS 2 — Keyword + source expansion with Haiku ───────
  const haikuSystem = `You expand a strategic brand analysis into concrete search keywords + suggested research sources. Output STRICT JSON only.

Output schema:
{
  "searchKeywords": ["<15-20 mixed-broadness terms in the audience's own language>"],
  "suggestedSources": [
    {
      "platform": "reddit" | "youtube" | "other",
      "identifier": "<for Reddit: subreddit name WITHOUT r/ prefix (e.g. SoloFemaleTravelers). For YouTube: channel handle or name. For other: site or community label>",
      "predictedRelevance": <integer 0-100>,
      "reasoning": "<one short sentence — why this source matches>"
    }
  ],
  "toneGuidance": {
    "primary": "<how to write for the primary audience layer>",
    "secondary": "<for the secondary layer>",
    "tertiary": "<for the tertiary layer>"
  },
  "competitorAngles": ["<3-6 angles or hooks that differentiate from competitors>"]
}

Rules:
- Search keywords: mix broad / niche / hyper-specific. Include audience-language terms in their actual language (Spanish for Mexican audiences, etc).
- Suggested sources: prefer ACTIVE communities. Reddit identifiers are the bare subreddit name. YouTube identifiers are the channel handle. Cap predictedRelevance to 95 unless you're certain.
- Max 20 keywords, max 12 sources.
- No markdown fences.`;

  const haikuUser = `BRAND ANALYSIS
${JSON.stringify(
  {
    niche: pass1.niche,
    subNiches: pass1.subNiches,
    audienceLayers: pass1.audienceLayers,
    competitorGap: pass1.competitorGap,
    specificity: spec,
  },
  null,
  2,
)}

BRAND CONTEXT
${brandSummary(bible)}

COMPETITORS
${competitors.length > 0 ? competitors.join(', ') : '(none)'}

Expand into search keywords + suggested sources + tone guidance + competitor angles. JSON only.`;

  let pass2: KeywordExpansion = {
    searchKeywords: [],
    suggestedSources: [],
    toneGuidance: { primary: '', secondary: '', tertiary: '' },
    competitorAngles: [],
  };
  try {
    const response = await anthropic.messages.create({
      model: MODELS.HAIKU,
      max_tokens: 2500,
      system: cachedSystem(haikuSystem),
      messages: [{ role: 'user', content: haikuUser }],
    });
    await trackUsage({
      endpoint: 'analyze-brand-pass2',
      model: MODELS.HAIKU,
      usage: response.usage,
      userId: user.id,
      projectId,
    });
    const textBlock = response.content.find((b) => b.type === 'text');
    const raw = textBlock?.type === 'text' ? textBlock.text : '';
    const parsed = JSON.parse(cleanJson(raw)) as Partial<KeywordExpansion>;
    pass2 = {
      searchKeywords: Array.isArray(parsed.searchKeywords)
        ? parsed.searchKeywords
            .filter((k): k is string => typeof k === 'string')
            .slice(0, 20)
        : [],
      suggestedSources: Array.isArray(parsed.suggestedSources)
        ? parsed.suggestedSources
            .filter(
              (
                s,
              ): s is {
                platform: string;
                identifier: string;
                predictedRelevance: number;
                reasoning: string;
              } =>
                !!s &&
                typeof s === 'object' &&
                typeof (s as { platform?: unknown }).platform === 'string' &&
                typeof (s as { identifier?: unknown }).identifier === 'string',
            )
            .map((s) => ({
              platform: s.platform,
              identifier: s.identifier,
              predictedRelevance: Math.max(
                0,
                Math.min(100, Math.round(Number(s.predictedRelevance) || 0)),
              ),
              reasoning: String(s.reasoning ?? '').slice(0, 280),
            }))
            .slice(0, 12)
        : [],
      toneGuidance:
        parsed.toneGuidance && typeof parsed.toneGuidance === 'object'
          ? {
              primary: String(parsed.toneGuidance.primary ?? ''),
              secondary: String(parsed.toneGuidance.secondary ?? ''),
              tertiary: String(parsed.toneGuidance.tertiary ?? ''),
            }
          : { primary: '', secondary: '', tertiary: '' },
      competitorAngles: Array.isArray(parsed.competitorAngles)
        ? parsed.competitorAngles
            .filter((a): a is string => typeof a === 'string')
            .slice(0, 8)
        : [],
    };
  } catch (err) {
    console.error('[analyze-brand] pass 2 failed (degraded):', err);
    // Don't fail the whole request — pass 1 is the strategic core.
    // The card still renders with the keywords array empty.
  }

  // 30-day TTL — re-analysis is gated behind the founder pressing
  // "Regenerate" or the cache expiring.
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const [saved] = await db
    .insert(brandAnalysis)
    .values({
      projectId,
      userId: user.id,
      niche: pass1.niche,
      subNiches: pass1.subNiches ?? [],
      audienceLayers: pass1.audienceLayers ?? {},
      competitorGap: pass1.competitorGap ?? null,
      specificityRecommended: spec,
      specificityReasoning: pass1.specificityReasoning ?? null,
      searchKeywords: pass2.searchKeywords,
      suggestedSources: pass2.suggestedSources,
      toneGuidance: pass2.toneGuidance,
      competitorAngles: pass2.competitorAngles,
      generatedBy: 'claude-opus-4-7',
      expiresAt,
    })
    .returning();

  // Mark the job complete. We don't store the result on the job row —
  // brand_analysis IS the result. The job table just tracks lifecycle.
  await db
    .update(brandAnalysisJobs)
    .set({ status: 'completed', completedAt: new Date() })
    .where(eq(brandAnalysisJobs.id, job.id));

  return NextResponse.json({
    success: true,
    cached: false,
    analysis: saved,
    jobId: job.id,
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
  const projectId = url.searchParams.get('projectId');
  if (!projectId || !UUID_RE.test(projectId)) {
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
    .from(brandAnalysis)
    .where(eq(brandAnalysis.projectId, projectId))
    .orderBy(desc(brandAnalysis.createdAt))
    .limit(1);

  return NextResponse.json({
    success: true,
    hasAnalysis: Boolean(latest),
    analysis: latest ?? null,
  });
}
