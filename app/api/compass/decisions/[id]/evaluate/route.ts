// PR #71 — Sprint 7.1E: post-hoc retrospective.
//
// Founder marks the decision as worked / didn't work + writes
// outcome notes + lessons. Opus then runs a single retrospective
// pass that asks:
//   - Was the original alignment score accurate? (overestimated /
//     underestimated / accurate)
//   - What likely caused the outcome?
//   - What pattern does this teach about THIS brand's decisions?
//
// The retrospective is the most strategically valuable artifact in
// the whole Decision Log — over time, the "scoring accuracy" field
// tells the founder whether Compass's alignment calls are actually
// predictive. If accuracy stays poor, the founder learns to trust
// their gut more on that category. If accuracy stays strong, they
// learn to trust the score.
//
// If Opus fails or returns junk, we still update the decision
// (status='evaluated', outcomeWorked etc. persist). The retro is
// best-effort — losing the AI summary doesn't lose the founder's
// own notes.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projects, compassDecisions } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import {
  anthropic,
  MODELS,
  cachedSystem,
  LANGUAGE_INSTRUCTION_ANALYSIS,
} from '@/lib/ai/claude';
import { trackUsage } from '@/lib/ai/usage-tracker';
import { checkRateLimit } from '@/lib/rate-limit';

export const maxDuration = 60;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_SCORING_ACCURACY = new Set([
  'accurate',
  'overestimated',
  'underestimated',
]);

function cleanJson(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function asStr(v: unknown, max = 1000): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function asStringArray(v: unknown, max = 5): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .slice(0, max)
    .map((s) => s.slice(0, 500));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  let body: {
    outcomeWorked?: unknown;
    outcomeNotes?: unknown;
    lessonsLearned?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (typeof body.outcomeWorked !== 'boolean') {
    return NextResponse.json(
      { error: 'outcomeWorked must be boolean (worked or not)' },
      { status: 400 },
    );
  }

  const outcomeNotes = asStr(body.outcomeNotes, 2000);
  const lessonsLearned = asStr(body.lessonsLearned, 2000);

  // Ownership-join — load the decision row alongside.
  const [joined] = await db
    .select({
      decision: compassDecisions,
    })
    .from(compassDecisions)
    .innerJoin(projects, eq(projects.id, compassDecisions.projectId))
    .where(
      and(eq(compassDecisions.id, id), eq(projects.userId, user.id)),
    )
    .limit(1);

  if (!joined) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const decision = joined.decision;

  // 20/hour — evaluation is rarer than scoring (only after outcome
  // observed), but still ceiling it so a misbehaving client can't
  // burn budget.
  const limit = checkRateLimit(
    `compass-decision-evaluate:${user.id}`,
    20,
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

  // Build the retro prompt. We deliberately keep this short — the
  // signal is "was the score predictive?" not "rewrite the whole
  // analysis."
  const systemPrompt = `You generate honest, compact retrospectives for strategic decisions. Be specific, no platitudes.

Return STRICT JSON only:
{
  "alignmentRecheck": "<1-2 sentences: was the original alignment score accurate? Why?>",
  "observedSignals": ["<concrete signal that drove the outcome>", ...],
  "patternInsight": "<1 sentence: what does this teach about THIS brand's decision-making?>",
  "scoringAccuracy": "accurate" | "overestimated" | "underestimated"
}

Interpretation matrix:
- worked + high alignment  → scoring confirmed (accurate)
- worked + low alignment   → scoring failed to predict (underestimated)
- failed + high alignment  → scoring overestimated OR execution failed (distinguish in alignmentRecheck)
- failed + low alignment   → scoring saved them from a worse bet (accurate)

Discipline:
- Cite the actual decision and outcome. No generic "this teaches that..."
- patternInsight is 1 sentence MAX. Bounded output.

${LANGUAGE_INSTRUCTION_ANALYSIS}`;

  const userMessage = `DECISION
Title: ${decision.title}
Category: ${decision.category ?? 'uncategorized'}
Decided: ${decision.decidedAt instanceof Date ? decision.decidedAt.toISOString().slice(0, 10) : 'unknown'}
Pre-decision alignment score: ${decision.alignmentScore ?? '(none)'} / 100
Pre-decision reasoning: ${decision.alignmentReasoning ?? '(none)'}
Reversibility predicted: ${decision.reversibility ?? 'unknown'}
Founder's pre-decision confidence: ${decision.founderConfidence ?? '(none)'} / 100

OUTCOME (now)
Worked: ${body.outcomeWorked ? 'YES' : 'NO'}
Founder notes: ${outcomeNotes || '(none)'}
Founder lessons: ${lessonsLearned || '(none)'}

Generate the retrospective. JSON only.`;

  let retro: {
    alignmentRecheck: string;
    observedSignals: string[];
    patternInsight: string;
    scoringAccuracy: string;
  } | null = null;

  try {
    const response = await anthropic.messages.create({
      model: MODELS.OPUS,
      max_tokens: 2000,
      system: cachedSystem(systemPrompt),
      messages: [{ role: 'user', content: userMessage }],
    });

    await trackUsage({
      endpoint: 'compass-decision-evaluate',
      model: MODELS.OPUS,
      usage: response.usage,
      userId: user.id,
      projectId: decision.projectId,
    });

    if (response.stop_reason === 'max_tokens') {
      console.error('[decision-evaluate] Opus hit max_tokens; truncated');
      // Soft-fail: persist the user's evaluation, skip the AI retro.
    } else {
      const textBlock = response.content.find((b) => b.type === 'text');
      const raw = textBlock?.type === 'text' ? textBlock.text : '';
      const parsed = JSON.parse(cleanJson(raw)) as Record<string, unknown>;
      const accuracyRaw = asStr(parsed.scoringAccuracy, 30).toLowerCase();
      retro = {
        alignmentRecheck: asStr(parsed.alignmentRecheck, 800),
        observedSignals: asStringArray(parsed.observedSignals, 5),
        patternInsight: asStr(parsed.patternInsight, 400),
        scoringAccuracy: VALID_SCORING_ACCURACY.has(accuracyRaw)
          ? accuracyRaw
          : 'accurate',
      };
    }
  } catch (err) {
    console.error('[decision-evaluate] Opus retro failed:', err);
    // Continue — we still persist the founder's evaluation. The
    // retro is best-effort.
  }

  // Always update the decision, even if retro failed.
  const [updated] = await db
    .update(compassDecisions)
    .set({
      status: 'evaluated',
      outcomeWorked: body.outcomeWorked,
      outcomeNotes: outcomeNotes || null,
      lessonsLearned: lessonsLearned || null,
      aiRetrospective: retro,
      evaluatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(compassDecisions.id, id))
    .returning();

  return NextResponse.json({
    success: true,
    decision: updated,
    retrospective: retro,
    retroSkipped: retro === null,
  });
}
