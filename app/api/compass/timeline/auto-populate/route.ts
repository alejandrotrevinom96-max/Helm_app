// PR #69 — Sprint 7.1D: bulk-create compass_tasks from the latest
// Priority Matrix.
//
// Reads the latest matrix for the project, pulls every pending
// item in the do_now + scheduled quadrants, and distributes them
// across the week:
//   - do_now → Mon/Tue/Wed at 10:00 (high-energy slots)
//   - scheduled → Wed/Thu/Fri at 14:00 (deeper-work slots)
//
// Dedupe is per-week: if a task with the same
// sourcePriorityItemId already exists inside the target week, we
// skip it. The founder can re-run safely after marking some done.
//
// No Opus call — this is pure SQL + scheduling math. Free.
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  compassTasks,
  priorityItems,
  priorityMatrices,
  projects,
} from '@/lib/db/schema';
import { eq, and, gte, lte, desc, isNotNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DO_NOW_OFFSETS = [0, 1, 2]; // Mon / Tue / Wed
const SCHEDULED_OFFSETS = [2, 3, 4]; // Wed / Thu / Fri

const TASK_TYPE_BY_SOURCE: Record<string, string> = {
  pain_point: 'research',
  opportunity: 'positioning',
  competitor_gap: 'positioning',
  content_gap: 'generate',
};

function getNextMondayUtc(): Date {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun
  // If today is Mon, use today; if Sun, tomorrow; else next Mon.
  const offset = day === 0 ? 1 : day === 1 ? 0 : 8 - day;
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset),
  );
}

function effortLevelFromScore(score: number): 'low' | 'medium' | 'high' {
  if (score <= 40) return 'low';
  if (score <= 70) return 'medium';
  return 'high';
}

function minutesByEffort(level: 'low' | 'medium' | 'high'): number {
  return level === 'low' ? 30 : level === 'medium' ? 90 : 180;
}

function deriveTaskType(item: typeof priorityItems.$inferSelect): string {
  if (item.suggestedContentType) return 'generate';
  if (item.sourceType && TASK_TYPE_BY_SOURCE[item.sourceType]) {
    return TASK_TYPE_BY_SOURCE[item.sourceType];
  }
  return 'other';
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { projectId?: string; weekStart?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { projectId } = body;
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

  // Resolve target week.
  let monday: Date;
  if (body.weekStart) {
    const parsed = new Date(body.weekStart);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json(
        { error: 'Invalid weekStart' },
        { status: 400 },
      );
    }
    monday = parsed;
  } else {
    monday = getNextMondayUtc();
  }
  const weekEnd = new Date(monday.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Latest matrix for the project.
  const [matrix] = await db
    .select()
    .from(priorityMatrices)
    .where(eq(priorityMatrices.projectId, projectId))
    .orderBy(desc(priorityMatrices.createdAt))
    .limit(1);
  if (!matrix) {
    return NextResponse.json(
      {
        error: 'No priority matrix found',
        hint: 'Generate a matrix at /compass/priority first.',
      },
      { status: 400 },
    );
  }

  // Pull pending items in the actionable quadrants. We honor the
  // userOverrideQuadrant if the founder manually re-bucketed.
  const items = await db
    .select()
    .from(priorityItems)
    .where(
      and(
        eq(priorityItems.matrixId, matrix.id),
        eq(priorityItems.userStatus, 'pending'),
      ),
    )
    .orderBy(desc(priorityItems.impactScore));

  const actionable = items.filter((i) => {
    const effective = i.userOverrideQuadrant ?? i.quadrant;
    return effective === 'do_now' || effective === 'scheduled';
  });

  if (actionable.length === 0) {
    return NextResponse.json({
      success: true,
      created: 0,
      hint: 'No pending high-impact items to schedule. Mark some done or regenerate the matrix.',
      weekStart: monday.toISOString(),
    });
  }

  // Dedupe: skip any actionable items already scheduled inside this
  // target week, so re-running auto-populate is idempotent.
  //
  // Sprint 7.1D hotfix: the original query also restricted by
  // `inArray(sourcePriorityItemId, itemIds)`. That filter was
  // narrower than necessary — when the founder regenerated the
  // matrix between calls (new item UUIDs), the inArray excluded
  // every existing row and the dedupe set came back empty,
  // creating duplicates. The simpler "pull all source-attributed
  // tasks in the week, then check membership" query is bulletproof
  // and the data volume per week is tiny anyway.
  const existing = await db
    .select({
      sourcePriorityItemId: compassTasks.sourcePriorityItemId,
    })
    .from(compassTasks)
    .where(
      and(
        eq(compassTasks.projectId, projectId),
        gte(compassTasks.scheduledFor, monday),
        lte(compassTasks.scheduledFor, weekEnd),
        isNotNull(compassTasks.sourcePriorityItemId),
      ),
    );
  const alreadyScheduled = new Set(
    existing
      .map((e) => e.sourcePriorityItemId)
      .filter((v): v is string => typeof v === 'string'),
  );

  const toInsert: (typeof compassTasks.$inferInsert)[] = [];
  let doNowIdx = 0;
  let scheduledIdx = 0;

  for (const item of actionable) {
    if (alreadyScheduled.has(item.id)) continue;

    const effectiveQuadrant = item.userOverrideQuadrant ?? item.quadrant;
    const offsets =
      effectiveQuadrant === 'do_now' ? DO_NOW_OFFSETS : SCHEDULED_OFFSETS;
    const dayOffset =
      effectiveQuadrant === 'do_now'
        ? offsets[doNowIdx++ % offsets.length]
        : offsets[scheduledIdx++ % offsets.length];

    // Sprint 7.1D hotfix: timezone. The original code stored 10:00 /
    // 14:00 UTC, which renders as 4:00 a.m. / 8:00 a.m. in the
    // founder's browser (Mexico City, UTC-6) — confusing.
    //
    // Pragmatic fix: shift the UTC hour by Mexico City's offset so
    // the displayed local time matches the intent (10am morning
    // for do_now, 2pm afternoon for scheduled). CDMX abolished DST
    // in 2022 so it's permanent UTC-6 year-round; no seasonal math.
    //
    // FUTURE: store the founder's preferred TZ on the user row and
    // compute the offset per call. For the single-MX-founder
    // deployment, hardcoding CDMX (-6) is the right pragmatic call.
    const CDMX_UTC_OFFSET_HOURS = 6;
    const localHour = effectiveQuadrant === 'do_now' ? 10 : 14;
    const utcHour = localHour + CDMX_UTC_OFFSET_HOURS; // 16 = 10am CDMX; 20 = 2pm CDMX
    const scheduledFor = new Date(
      Date.UTC(
        monday.getUTCFullYear(),
        monday.getUTCMonth(),
        monday.getUTCDate() + dayOffset,
        utcHour,
        0,
        0,
        0,
      ),
    );

    const effortLevel = effortLevelFromScore(item.effortScore);

    toInsert.push({
      projectId,
      userId: user.id,
      title: item.title,
      description: item.description,
      taskType: deriveTaskType(item),
      scheduledFor,
      estimatedMinutes: minutesByEffort(effortLevel),
      effortLevel,
      sourceType: 'priority_item',
      sourcePriorityItemId: item.id,
      sourceContext: item.sourceContext,
      suggestedPlatform: item.suggestedPlatform,
      suggestedContentType: item.suggestedContentType,
      suggestedPrompt: item.description ?? item.suggestedAction,
    });
  }

  if (toInsert.length === 0) {
    return NextResponse.json({
      success: true,
      created: 0,
      hint: 'All actionable priority items are already scheduled this week.',
      weekStart: monday.toISOString(),
    });
  }

  const inserted = await db.insert(compassTasks).values(toInsert).returning();

  return NextResponse.json({
    success: true,
    created: inserted.length,
    skipped: actionable.length - inserted.length,
    weekStart: monday.toISOString(),
    weekEnd: weekEnd.toISOString(),
    tasks: inserted,
  });
}
