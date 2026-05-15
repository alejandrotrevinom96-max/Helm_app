// PR #57 — Sprint 7.0.1: Pain Point Extractor.
//
// Pulls every research_finding from the last 7 days, hands the
// combined text to Haiku 4.5, asks for repeated pain themes with
// real quotes, and persists the result in research_insights.
//
// Cost discipline: Haiku-only, with a cached system prompt so reruns
// for the same project stay cheap inside the 5-minute window. We cap
// findings input at 100 rows / 40k chars to bound the prompt.
//
// Side effect: when pain points come back, sources whose platform
// produced them get a small signalScore bump (max +10 per source)
// — the ranking learns from what actually surfaces pain.
//
// What this does NOT do (deferred to Sprint 7.0.2):
//   - Send the Weekly Brief email (Resend integration)
//   - Surface a Settings opt-in toggle
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  projects,
  researchFindings,
  researchInsights,
  projectSources,
  sourceDirectory,
} from '@/lib/db/schema';
import { eq, and, gte, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { anthropic, MODELS, cachedSystem } from '@/lib/ai/claude';
import { trackUsage } from '@/lib/ai/usage-tracker';
import { checkRateLimit } from '@/lib/rate-limit';
import type { BrandBible } from '@/lib/types/brand';
// PR Sprint 7.23 — anchored angle generation. The extraction prompt
// no longer produces actionableAngle inline. After we have the
// pain themes + quotes + platforms, we run a per-pain-point Haiku
// call with the new anchoring template that consumes the brand
// bible, verified facts (Patch 4 — empty for now), and approved
// product bridges (Sprint B). The anchoring rules in that template
// pick the verb based on whether the founder has direct experience,
// so we stop emitting "Show frameworks for X" when no framework
// exists.
import { generateActionableAngle } from '@/lib/research/generate-actionable-angle';

export const maxDuration = 60;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PainPoint {
  theme: string;
  frequency: number;
  sampleQuote: string;
  platform: string;
  isOnDomain: boolean;
  actionableAngle: string;
}

interface ExtractionResult {
  painPoints: PainPoint[];
  summary: string;
  skippedReason?: string;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 10/hr — Haiku is cheap but this fires the database write loop
  // too. Plenty for any sane usage.
  const limit = checkRateLimit(`research-extract:${user.id}`, 10, 60 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
        hint: `Try again in ${Math.ceil(limit.resetMs / 60000)} minutes.`,
      },
      { status: 429 },
    );
  }

  let body: { projectId?: string };
  try {
    body = (await request.json()) as { projectId?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { projectId } = body;
  if (!projectId || !UUID_RE.test(projectId)) {
    return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 });
  }

  // Isolation re-check.
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

  // Last 7 days of findings — capped at 100 rows.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentFindings = await db
    .select()
    .from(researchFindings)
    .where(
      and(
        eq(researchFindings.projectId, projectId),
        gte(researchFindings.foundAt, sevenDaysAgo),
      ),
    )
    .limit(100);

  if (recentFindings.length === 0) {
    return NextResponse.json({
      painPoints: [],
      hint: 'No findings in the last 7 days. Connect sources in /research/sources and run a scan first.',
      sourcesNeeded: true,
      success: true,
    });
  }

  // Build the context — researchFindings has `source` (the platform
  // name) and `snippet` (the post body). We cap each row at 500 chars
  // and the whole prompt at 40k chars so the Haiku context never
  // explodes.
  const combinedText = recentFindings
    .map((f) => {
      const head = `[${f.source}] ${f.title}`;
      const body = (f.snippet ?? '').slice(0, 500);
      return `${head}\n${body}`;
    })
    .join('\n\n---\n\n')
    .slice(0, 40000);

  const bible = (project.brandContext as BrandBible | null) ?? null;
  const audience = bible?.audience?.primary?.description ?? 'unknown';
  const pillars = (bible?.pillars ?? [])
    .map((p) => p?.name)
    .filter((n): n is string => Boolean(n))
    .join(', ');

  // PR Sprint 7.23 — actionableAngle was removed from this JSON
  // schema. It used to be a one-shot string the model produced
  // inline alongside the theme/quote/platform. Inline generation
  // didn't have access to the founder's verified facts or product
  // bridges, so it often emitted "Show how to X" directives that
  // forced the post generator to fabricate specifics. The angle is
  // now produced by a dedicated, anchored Haiku call PER pain point
  // after this extraction completes (see generateActionableAngle).
  const systemPrompt = `You are a marketing intelligence analyst extracting audience pain points from raw community discussions.

You must:
- Find pain themes that appear REPEATEDLY (frequency >= 2 across distinct posts).
- Reject pains that are off-topic or unrelated to the brand's domain (isOnDomain: false).
- Never fabricate quotes — every sampleQuote must be drawn from the actual content provided.
- Filter out trolling, jokes, and meta-discussion about the platform itself.
- Rank by frequency descending, max 10 items.
- If zero on-domain pains exist, return an empty painPoints array AND explain why in skippedReason.

Return STRICT JSON, no markdown fences, no prose:
{
  "painPoints": [
    {
      "theme": "<3-6 word label>",
      "frequency": <integer, min 2>,
      "sampleQuote": "<verbatim quote, under 100 chars, escape inner quotes>",
      "platform": "<source platform>",
      "isOnDomain": true
    }
  ],
  "summary": "<2-3 sentence summary of what the audience discusses this week>",
  "skippedReason": "<only when painPoints is empty: why nothing on-domain surfaced>"
}`;

  const userMessage = `BRAND CONTEXT
Name: ${project.name}
Audience: ${audience}
Pillars: ${pillars || 'unset'}

COMMUNITY CONTENT (last 7 days, ${recentFindings.length} findings):

${combinedText}

Extract on-domain pain themes that repeat. JSON only.`;

  let parsed: ExtractionResult | null = null;
  try {
    const response = await anthropic.messages.create({
      model: MODELS.HAIKU,
      max_tokens: 3000,
      system: cachedSystem(systemPrompt),
      messages: [{ role: 'user', content: userMessage }],
    });

    await trackUsage({
      endpoint: 'research-extract-pain-points',
      model: MODELS.HAIKU,
      usage: response.usage,
      userId: user.id,
      projectId,
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    const raw = textBlock?.type === 'text' ? textBlock.text.trim() : '';
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    parsed = JSON.parse(cleaned) as ExtractionResult;
  } catch (err) {
    console.error('[extract-pain-points] Haiku call failed:', err);
    return NextResponse.json(
      {
        error: 'Extraction failed',
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }

  // Normalize: drop off-domain rows, clamp frequency. actionableAngle
  // is empty here — we fill it below via a dedicated anchored Haiku
  // call per pain point. PR Sprint 7.23.
  const partialPainPoints: PainPoint[] = Array.isArray(parsed?.painPoints)
    ? parsed.painPoints
        .filter((p) => p && typeof p === 'object' && p.isOnDomain !== false)
        .map((p) => ({
          theme: String(p.theme ?? '').slice(0, 80),
          frequency: Math.max(2, Math.min(99, Number(p.frequency) || 2)),
          sampleQuote: String(p.sampleQuote ?? '').slice(0, 200),
          platform: String(p.platform ?? 'unknown'),
          isOnDomain: true,
          actionableAngle: '',
        }))
        .slice(0, 10)
    : [];

  // PR Sprint 7.23 — anchored angle generation per pain point.
  // Runs in parallel via Promise.all so wall-clock stays close to
  // a single Haiku call (~1s) regardless of pain-point count.
  // Failures degrade gracefully — generateActionableAngle returns ''
  // on transient errors and the card renders without an angle.
  //
  // Inputs threaded into the anchoring prompt:
  //   - pain_theme + sample_quote: from this extraction
  //   - platform: per pain point (different findings can sit on
  //     different platforms)
  //   - brand_bible: the project's BrandBible jsonb
  //   - verified_facts: Patch 4 territory; empty array until that
  //     ships (the prompt switches to exploratory verbs when empty)
  //   - pain_to_product_bridges: from BrandBible.painToProductBridges
  //     (Sprint B). Pre-filtered to approved only inside the helper.
  const approvedBridges = (bible?.painToProductBridges ?? []).filter(
    (b) => !b.pendingReview,
  );
  const cleanPainPoints: PainPoint[] = await Promise.all(
    partialPainPoints.map(async (p) => {
      const angle = await generateActionableAngle({
        painTheme: p.theme,
        sampleQuote: p.sampleQuote,
        platform: p.platform,
        brandBible: bible,
        verifiedFacts: [],
        painToProductBridges: approvedBridges,
      });
      return { ...p, actionableAngle: angle };
    }),
  );

  // Track which connected sources contributed (by sourceId on the
  // findings rows that exist — older rows may have null sourceId).
  const sourcesUsed = Array.from(
    new Set(recentFindings.map((f) => f.sourceId).filter(Boolean)),
  );

  await db.insert(researchInsights).values({
    projectId,
    userId: user.id,
    painPoints: cleanPainPoints,
    summary: parsed.summary ?? null,
    skippedReason: parsed.skippedReason ?? null,
    sourcesUsed,
    weekStarting: sevenDaysAgo,
  });

  // Signal-score bump per platform — sources that produced pain
  // points are more valuable than sources that just produce noise.
  if (cleanPainPoints.length > 0) {
    const platformFreq = new Map<string, number>();
    for (const p of cleanPainPoints) {
      platformFreq.set(
        p.platform,
        (platformFreq.get(p.platform) ?? 0) + p.frequency,
      );
    }
    for (const [platform, freq] of platformFreq.entries()) {
      const bump = Math.min(10, Math.max(1, Math.round(freq / 2)));
      const rows = await db
        .select({ id: projectSources.id })
        .from(projectSources)
        .innerJoin(
          sourceDirectory,
          eq(projectSources.sourceId, sourceDirectory.id),
        )
        .where(
          and(
            eq(projectSources.projectId, projectId),
            eq(sourceDirectory.platform, platform),
            eq(projectSources.status, 'connected'),
          ),
        );
      for (const r of rows) {
        await db
          .update(projectSources)
          .set({
            signalScore: sql`LEAST(100, COALESCE(${projectSources.signalScore}, 50) + ${bump})`,
          })
          .where(eq(projectSources.id, r.id));
      }
    }
  }

  return NextResponse.json({
    success: true,
    painPoints: cleanPainPoints,
    summary: parsed.summary ?? null,
    skippedReason: parsed.skippedReason ?? null,
    sourcesUsedCount: sourcesUsed.length,
    findingsAnalyzed: recentFindings.length,
  });
}
