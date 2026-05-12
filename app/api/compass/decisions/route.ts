// PR #71 — Sprint 7.1E: Decision Log list (GET) + commit (POST).
//
// POST persists the decision AFTER /score has run — the client
// passes the score + reasoning + reversibility back in. We don't
// re-call Opus here because the founder may have edited the score
// to dispute it (rare but allowed).
//
// GET returns every decision for the project, plus a summary block
// the UI shows up top: total, status breakdown, avg alignment,
// "worked rate" (% of evaluated decisions that succeeded).
//
// The "worked rate" is the most strategic number in the whole
// Decision Log — it tells the founder whether their gut + Compass's
// alignment scoring together are producing good outcomes over time.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projects, compassDecisions } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';

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

function asStr(v: unknown, max = 2000): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return null;
  return v.slice(0, max);
}

function asInt0to100(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
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
    alignmentScore?: unknown;
    alignmentReasoning?: string;
    reversibility?: string;
    reversalCostNotes?: string;
    founderConfidence?: unknown;
    linkedPriorityItemId?: string;
    linkedTimelineTaskId?: string;
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
    return NextResponse.json({ error: 'title required' }, { status: 400 });
  }

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const category =
    typeof body.category === 'string' && VALID_CATEGORIES.has(body.category)
      ? body.category
      : 'other';

  const reversibility =
    typeof body.reversibility === 'string' &&
    VALID_REVERSIBILITIES.has(body.reversibility)
      ? body.reversibility
      : 'medium';

  // Optional UUID links — pass through only if valid format. We
  // don't enforce FK existence here; the soft-ref policy means a
  // deleted priority item shouldn't cascade the decision history.
  const linkedPriorityItemId =
    typeof body.linkedPriorityItemId === 'string' &&
    UUID_RE.test(body.linkedPriorityItemId)
      ? body.linkedPriorityItemId
      : null;
  const linkedTimelineTaskId =
    typeof body.linkedTimelineTaskId === 'string' &&
    UUID_RE.test(body.linkedTimelineTaskId)
      ? body.linkedTimelineTaskId
      : null;

  const [decision] = await db
    .insert(compassDecisions)
    .values({
      projectId,
      userId: user.id,
      title: title.trim().slice(0, 240),
      description: asStr(body.description, 2000),
      category,
      alignmentScore: asInt0to100(body.alignmentScore),
      alignmentReasoning: asStr(body.alignmentReasoning, 1200),
      reversibility,
      reversalCostNotes: asStr(body.reversalCostNotes, 500),
      founderConfidence: asInt0to100(body.founderConfidence),
      status: 'decided',
      decidedAt: new Date(),
      linkedPriorityItemId,
      linkedTimelineTaskId,
    })
    .returning();

  return NextResponse.json({ success: true, decision });
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

  const decisions = await db
    .select()
    .from(compassDecisions)
    .where(eq(compassDecisions.projectId, projectId))
    .orderBy(desc(compassDecisions.decidedAt));

  const evaluatedRows = decisions.filter((d) => d.outcomeWorked !== null);
  const workedRows = decisions.filter((d) => d.outcomeWorked === true);

  const summary = {
    total: decisions.length,
    decided: decisions.filter((d) => d.status === 'decided').length,
    executing: decisions.filter((d) => d.status === 'executing').length,
    evaluated: decisions.filter((d) => d.status === 'evaluated').length,
    reversed: decisions.filter((d) => d.status === 'reversed').length,
    avgAlignment:
      decisions.length > 0
        ? Math.round(
            decisions.reduce((s, d) => s + (d.alignmentScore ?? 0), 0) /
              decisions.length,
          )
        : null,
    workedRate:
      evaluatedRows.length > 0
        ? Math.round((workedRows.length / evaluatedRows.length) * 100)
        : null,
  };

  return NextResponse.json({ decisions, summary });
}
