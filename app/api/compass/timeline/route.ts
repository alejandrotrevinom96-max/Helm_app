// PR #69 — Sprint 7.1D: Strategic Timeline list (GET) + manual create
// (POST).
//
// GET returns every compass_task for the project inside a 7-day
// window starting at `weekStart` (defaults to current Monday in
// the server's timezone — for global users this is close enough;
// the client also computes "current Monday" locally and passes the
// ISO so this defaults rarely matter).
//
// POST creates a single manually-added task. Auto-populated tasks
// flow through `/timeline/auto-populate` instead.
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { compassTasks, projects } from '@/lib/db/schema';
import { eq, and, gte, lte, asc } from 'drizzle-orm';
import { NextResponse } from 'next/server';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_TASK_TYPES = new Set([
  'research',
  'decision',
  'review',
  'positioning',
  'generate',
  'other',
]);

const VALID_PLATFORMS = new Set([
  'instagram',
  'facebook',
  'linkedin',
  'reddit',
  'threads',
  'x',
]);

function getCurrentMondayUtc(): Date {
  // We use UTC-based math so the same call from any region produces
  // the same week boundary on the server. The client passes its
  // local Monday in most cases, which overrides this.
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diffToMonday),
  );
  return monday;
}

function effortFromMinutes(min: number | null | undefined): 'low' | 'medium' | 'high' {
  const m = typeof min === 'number' && min > 0 ? min : 30;
  if (m <= 30) return 'low';
  if (m <= 90) return 'medium';
  return 'high';
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
  const weekStartRaw = url.searchParams.get('weekStart');
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

  let start: Date;
  if (weekStartRaw) {
    const parsed = new Date(weekStartRaw);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json(
        { error: 'Invalid weekStart' },
        { status: 400 },
      );
    }
    start = parsed;
  } else {
    start = getCurrentMondayUtc();
  }
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);

  const tasks = await db
    .select()
    .from(compassTasks)
    .where(
      and(
        eq(compassTasks.projectId, projectId),
        gte(compassTasks.scheduledFor, start),
        lte(compassTasks.scheduledFor, end),
      ),
    )
    .orderBy(asc(compassTasks.scheduledFor));

  const byStatus = {
    pending: 0,
    in_progress: 0,
    done: 0,
    skipped: 0,
  };
  for (const t of tasks) {
    if (t.status in byStatus) {
      byStatus[t.status as keyof typeof byStatus]++;
    }
  }

  return NextResponse.json({
    weekStart: start.toISOString(),
    weekEnd: end.toISOString(),
    tasks,
    total: tasks.length,
    byStatus,
  });
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
    taskType?: string;
    scheduledFor?: string;
    estimatedMinutes?: number;
    suggestedPlatform?: string;
    suggestedContentType?: string;
    suggestedPrompt?: string;
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
  if (!body.scheduledFor) {
    return NextResponse.json({ error: 'scheduledFor required' }, { status: 400 });
  }
  const scheduledFor = new Date(body.scheduledFor);
  if (Number.isNaN(scheduledFor.getTime())) {
    return NextResponse.json({ error: 'Invalid scheduledFor' }, { status: 400 });
  }

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const taskType =
    typeof body.taskType === 'string' && VALID_TASK_TYPES.has(body.taskType)
      ? body.taskType
      : 'other';
  const estimatedMinutes =
    typeof body.estimatedMinutes === 'number' && body.estimatedMinutes > 0
      ? Math.min(600, Math.round(body.estimatedMinutes))
      : null;
  const platform =
    typeof body.suggestedPlatform === 'string' &&
    VALID_PLATFORMS.has(body.suggestedPlatform)
      ? body.suggestedPlatform
      : null;
  const contentType =
    typeof body.suggestedContentType === 'string'
      ? body.suggestedContentType.slice(0, 40)
      : null;

  const [task] = await db
    .insert(compassTasks)
    .values({
      projectId,
      userId: user.id,
      title: title.trim().slice(0, 240),
      description:
        typeof body.description === 'string'
          ? body.description.slice(0, 1000)
          : null,
      taskType,
      scheduledFor,
      estimatedMinutes,
      effortLevel: effortFromMinutes(estimatedMinutes),
      sourceType: 'manual',
      suggestedPlatform: platform,
      suggestedContentType: contentType,
      suggestedPrompt:
        typeof body.suggestedPrompt === 'string'
          ? body.suggestedPrompt.slice(0, 2000)
          : null,
    })
    .returning();

  return NextResponse.json({ success: true, task });
}
