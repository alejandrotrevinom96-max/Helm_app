// PR #56 — Sprint 7.0: rank discovered Reddit sources by signal/noise
// against the founder's brand bible. Haiku 4.5 (cost optimization —
// this runs every time the Sources page loads).
//
// Takes either an explicit list of sourceIds OR pulls every
// 'suggested'-status row for the project (i.e., everything Discover
// found that the founder hasn't acted on yet). Returns the rows
// hydrated with `signalScore` (0-100) and `rationale` from the model.
//
// Why Haiku not Opus: ranking sources by fit is well-suited to Haiku's
// strengths — pattern matching brand bible signals against subreddit
// descriptions. Opus is reserved for narrative work (Weekly Brief
// synthesis) where the cost is justified.
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  projects,
  sourceDirectory,
  projectSources,
} from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { anthropic, MODELS, cachedSystem } from '@/lib/ai/claude';
import { trackUsage } from '@/lib/ai/usage-tracker';
import { checkRateLimit } from '@/lib/rate-limit';
import type { BrandBible } from '@/lib/types/brand';

export const maxDuration = 60;

interface RankingResult {
  sourceId: string;
  signalScore: number;
  rationale: string;
}

function brandBibleSummary(bible: BrandBible | null): string {
  if (!bible) return 'No brand bible available.';
  const lines: string[] = [];
  if (bible.identity?.name) lines.push(`Name: ${bible.identity.name}`);
  if (bible.identity?.tagline) lines.push(`Tagline: ${bible.identity.tagline}`);
  if (bible.identity?.industry) lines.push(`Industry: ${bible.identity.industry}`);
  if (bible.archetype?.primary) lines.push(`Archetype: ${bible.archetype.primary}`);
  if (bible.pillars?.length) {
    lines.push(
      `Pillars: ${bible.pillars
        .map((p) => p?.name)
        .filter(Boolean)
        .join(', ')}`,
    );
  }
  const primary = bible.audience?.primary;
  if (primary?.description) lines.push(`Audience: ${primary.description}`);
  if (primary?.painPoints?.length) {
    lines.push(
      `Pains:\n${primary.painPoints
        .slice(0, 5)
        .map((pp) => `  - ${pp.pain} (intensity ${pp.intensity}/5)`)
        .join('\n')}`,
    );
  }
  if (primary?.jobsToBeDone?.length) {
    lines.push(`JTBD: ${primary.jobsToBeDone.slice(0, 5).join('; ')}`);
  }
  return lines.join('\n');
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Haiku ranking is cheap (~$0.001/call) but a tight loop could
  // still rack up tokens. 20/hr is plenty.
  const limit = checkRateLimit(`research-suggest:${user.id}`, 20, 60 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
        hint: `Try again in ${Math.ceil(limit.resetMs / 60000)} minutes.`,
      },
      { status: 429 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const { projectId, sourceIds } = body as {
    projectId?: string;
    sourceIds?: string[];
  };
  if (!projectId) {
    return NextResponse.json({ error: 'projectId required' }, { status: 400 });
  }

  // Isolation: project must belong to caller.
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Resolve which sources to rank. Two modes:
  //   1. Caller passes explicit sourceIds (typical right-after-discover)
  //   2. Empty — we rank every directory row that isn't already
  //      connected/skipped for this project.
  let targetSourceIds: string[] = [];
  if (Array.isArray(sourceIds) && sourceIds.length > 0) {
    targetSourceIds = sourceIds.slice(0, 30); // safety cap
  } else {
    // Pull every directory row not yet decided on. Capped at 30 so a
    // first-time Discover run with 50 hits doesn't blow our Haiku
    // input budget.
    const decided = await db
      .select({ sourceId: projectSources.sourceId })
      .from(projectSources)
      .where(eq(projectSources.projectId, projectId));
    const decidedIds = new Set(decided.map((d) => d.sourceId));
    // Naive: pull all reddit rows and filter in JS — directory is
    // small enough at this stage of the product that it's fine.
    const all = await db
      .select({ id: sourceDirectory.id })
      .from(sourceDirectory)
      .where(eq(sourceDirectory.platform, 'reddit'))
      .limit(60);
    targetSourceIds = all
      .map((r) => r.id)
      .filter((id) => !decidedIds.has(id))
      .slice(0, 30);
  }

  if (targetSourceIds.length === 0) {
    return NextResponse.json({ ranked: [] });
  }

  const sources = await db
    .select()
    .from(sourceDirectory)
    .where(inArray(sourceDirectory.id, targetSourceIds));

  const bible = (project.brandContext as BrandBible | null) ?? null;
  const summary = brandBibleSummary(bible);

  // System prompt is stable across all calls in a session — cache it.
  const systemPrompt = `You are a research analyst ranking online communities for an indie hacker's marketing intelligence.

Your job: score each candidate community 0-100 based on signal-to-noise for the brand below. Anchor your scale:
- 80-100: directly populated by the target audience, daily relevant pain conversations.
- 50-79: tangentially relevant — some target audience present, mixed topics.
- 20-49: weak fit — occasional relevance, mostly noise for this brand.
- 0-19: irrelevant or actively wrong audience.

Penalize: ghost towns (< 1k members), heavily moderated promo-only subs, audience mismatch.
Reward: active discussion, target audience density, pain-point conversations.

Return STRICT JSON only, no prose, matching this schema:
{
  "rankings": [
    {
      "sourceId": "<uuid from input>",
      "signalScore": <integer 0-100>,
      "rationale": "<one short sentence>"
    }
  ]
}`;

  const userMessage = `BRAND CONTEXT
${summary}

CANDIDATE COMMUNITIES (Reddit)
${sources
  .map(
    (s) =>
      `- id=${s.id}
  name=${s.displayName}
  members=${s.memberCount ?? '?'}
  description=${(s.description ?? '').slice(0, 280)}`,
  )
  .join('\n')}

Rank every community above. Return JSON only.`;

  let parsed: { rankings: RankingResult[] } | null = null;
  try {
    const response = await anthropic.messages.create({
      model: MODELS.HAIKU,
      max_tokens: 4000,
      system: cachedSystem(systemPrompt),
      messages: [{ role: 'user', content: userMessage }],
    });

    await trackUsage({
      endpoint: 'research-suggest-sources',
      model: MODELS.HAIKU,
      usage: response.usage,
      userId: user.id,
      projectId,
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    const raw = textBlock?.type === 'text' ? textBlock.text.trim() : '';
    // Tolerate ```json fences.
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    parsed = JSON.parse(cleaned) as { rankings: RankingResult[] };
  } catch (err) {
    console.error('[suggest-sources] Haiku call failed:', err);
    return NextResponse.json(
      { error: 'Ranking model failed', details: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }

  if (!parsed?.rankings || !Array.isArray(parsed.rankings)) {
    return NextResponse.json(
      { error: 'Model returned invalid JSON', got: parsed },
      { status: 502 },
    );
  }

  // Upsert into projectSources so the ranking persists. Status =
  // 'suggested' (founder hasn't acted yet). Score lives on the join
  // row, not on the directory, because the same subreddit can rank
  // 90 for Helm and 30 for an e-commerce brand.
  const validIds = new Set(sources.map((s) => s.id));
  const ranked: RankingResult[] = parsed.rankings.filter((r) =>
    validIds.has(r.sourceId),
  );

  for (const r of ranked) {
    const score = Math.max(0, Math.min(100, Math.round(r.signalScore)));
    // Try insert first; on conflict, update score & rationale only if
    // the row is still in 'suggested' status (don't overwrite connect/skip).
    const inserted = await db
      .insert(projectSources)
      .values({
        projectId,
        userId: user.id,
        sourceId: r.sourceId,
        status: 'suggested',
        signalScore: score,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted.length === 0) {
      // Existing row — only update if still suggested.
      await db
        .update(projectSources)
        .set({ signalScore: score })
        .where(
          and(
            eq(projectSources.projectId, projectId),
            eq(projectSources.sourceId, r.sourceId),
            eq(projectSources.status, 'suggested'),
          ),
        );
    }
  }

  // Return hydrated rows with rationale attached for the UI.
  const rationaleMap = new Map(ranked.map((r) => [r.sourceId, r.rationale]));
  const result = sources
    .map((s) => {
      const r = ranked.find((x) => x.sourceId === s.id);
      return {
        ...s,
        signalScore: r ? Math.round(r.signalScore) : 50,
        rationale: rationaleMap.get(s.id) ?? '',
      };
    })
    .sort((a, b) => b.signalScore - a.signalScore);

  return NextResponse.json({ ranked: result });
}
