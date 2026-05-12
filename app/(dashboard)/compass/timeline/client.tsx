'use client';

// PR #69 — Sprint 7.1D: Strategic Timeline client.
//
// 7-column week view. Tasks render as compact cards with the right
// affordances per type:
//   - `generate` tasks: "Generate →" deep-link to /marketing/generate
//     with prompt/platform/type pre-encoded.
//   - everything: mark done / dismiss / delete inline.
//
// Manual-add form sits above the grid so the founder can drop in
// strategic todos (research, decisions) that don't come from the
// Priority Matrix.
//
// Week navigation is local-state — we refetch on each change. Cheap
// because there are typically < 20 tasks per week.
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { GlassCard } from '@/components/ui/glass-card';
import { Button } from '@/components/ui/button';
import { CompassSubNav } from '@/components/compass/sub-nav';

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  taskType: string;
  scheduledFor: string;
  estimatedMinutes: number | null;
  effortLevel: string | null;
  status: string;
  sourceType: string | null;
  sourceContext: string | null;
  suggestedPlatform: string | null;
  suggestedContentType: string | null;
  suggestedPrompt: string | null;
}

interface Props {
  project: { id: string; name: string };
  hasMatrix: boolean;
  initialWeekStart: string;
  initialTasks: TaskRow[];
}

const TASK_TYPE_ICON: Record<string, string> = {
  research: '🔍',
  decision: '🤔',
  review: '📊',
  positioning: '🎯',
  generate: '✍️',
  other: '📌',
};

const STATUS_TINT: Record<string, string> = {
  pending: 'bg-bg-elev text-text-3',
  in_progress: 'bg-accent/15 text-accent',
  done: 'bg-emerald-500/15 text-emerald-500',
  skipped: 'bg-text-3/15 text-text-3',
};

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function isoMonday(d: Date): Date {
  // Returns the UTC Monday for the week containing `d`.
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff),
  );
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

function formatDay(d: Date): string {
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function buildGenerateHref(task: TaskRow, projectId: string): string {
  const qs = new URLSearchParams({
    projectId,
    from: 'compass-timeline',
    taskId: task.id,
  });
  if (task.suggestedPlatform) qs.set('platform', task.suggestedPlatform);
  if (task.suggestedContentType) qs.set('type', task.suggestedContentType);
  const prompt = task.suggestedPrompt ?? task.description ?? task.title;
  if (prompt) qs.set('prompt', prompt);
  return `/marketing/generate?${qs.toString()}`;
}

export function TimelineClient({
  project,
  hasMatrix,
  initialWeekStart,
  initialTasks,
}: Props) {
  const [weekStart, setWeekStart] = useState<Date>(new Date(initialWeekStart));
  const [tasks, setTasks] = useState<TaskRow[]>(initialTasks);
  const [loading, setLoading] = useState(false);
  const [populating, setPopulating] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: 'success' | 'error' | 'info';
    msg: string;
  } | null>(null);

  // Manual-add form state.
  const [showAdd, setShowAdd] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState<string>('other');
  const [newMinutes, setNewMinutes] = useState<number>(30);
  const [newWhen, setNewWhen] = useState<string>(() => {
    const t = new Date();
    t.setHours(10, 0, 0, 0);
    return t.toISOString().slice(0, 16); // datetime-local format
  });

  const loadWeek = useCallback(
    async (target: Date) => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/compass/timeline?projectId=${project.id}&weekStart=${target.toISOString()}`,
          { cache: 'no-store' },
        );
        const data = (await res.json()) as { tasks?: TaskRow[] };
        if (data.tasks) setTasks(data.tasks);
      } catch (e) {
        setFeedback({
          kind: 'error',
          msg: e instanceof Error ? e.message : 'Network error',
        });
      } finally {
        setLoading(false);
      }
    },
    [project.id],
  );

  // Re-fetch whenever the week changes (skip on the very first mount
  // because we already have initialTasks).
  useEffect(() => {
    const mountIso = new Date(initialWeekStart).toISOString();
    if (weekStart.toISOString() === mountIso) return;
    void loadWeek(weekStart);
  }, [weekStart, initialWeekStart, loadWeek]);

  const handlePopulate = async () => {
    if (populating) return;
    setPopulating(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/compass/timeline/auto-populate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          weekStart: weekStart.toISOString(),
        }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        created?: number;
        skipped?: number;
        hint?: string;
        error?: string;
      };
      if (!res.ok || !data.success) {
        setFeedback({
          kind: 'error',
          msg: data.error ?? data.hint ?? 'Populate failed',
        });
        return;
      }
      if (data.created === 0) {
        setFeedback({ kind: 'info', msg: data.hint ?? 'Nothing to populate.' });
      } else {
        setFeedback({
          kind: 'success',
          msg: `Created ${data.created} tasks${data.skipped ? ` (${data.skipped} already scheduled)` : ''}.`,
        });
      }
      await loadWeek(weekStart);
    } catch (e) {
      setFeedback({
        kind: 'error',
        msg: e instanceof Error ? e.message : 'Network error',
      });
    } finally {
      setPopulating(false);
    }
  };

  const updateStatus = async (taskId: string, status: string) => {
    // Optimistic.
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status } : t)),
    );
    try {
      await fetch(`/api/compass/timeline/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
    } catch {
      await loadWeek(weekStart);
    }
  };

  const deleteTask = async (taskId: string) => {
    if (!window.confirm('Delete this task?')) return;
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    try {
      await fetch(`/api/compass/timeline/${taskId}`, { method: 'DELETE' });
    } catch {
      await loadWeek(weekStart);
    }
  };

  const handleGenerateClick = async (task: TaskRow) => {
    // Flip status to in_progress in the background; the <Link> href
    // handles navigation so we don't block on the fetch.
    if (task.status === 'pending') {
      void updateStatus(task.id, 'in_progress');
    }
  };

  const addManualTask = async () => {
    if (!newTitle.trim() || adding) return;
    setAdding(true);
    setFeedback(null);
    try {
      const scheduledFor = new Date(newWhen);
      if (Number.isNaN(scheduledFor.getTime())) {
        setFeedback({ kind: 'error', msg: 'Invalid date/time.' });
        setAdding(false);
        return;
      }
      const res = await fetch('/api/compass/timeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          title: newTitle,
          taskType: newType,
          scheduledFor: scheduledFor.toISOString(),
          estimatedMinutes: newMinutes,
        }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        task?: TaskRow;
        error?: string;
      };
      if (!res.ok || !data.success) {
        setFeedback({ kind: 'error', msg: data.error ?? 'Add failed' });
        return;
      }
      setNewTitle('');
      setShowAdd(false);
      setFeedback({ kind: 'success', msg: 'Task added.' });
      await loadWeek(weekStart);
    } catch (e) {
      setFeedback({
        kind: 'error',
        msg: e instanceof Error ? e.message : 'Network error',
      });
    } finally {
      setAdding(false);
    }
  };

  const tasksByDay = useMemo(() => {
    const buckets: Record<number, TaskRow[]> = {
      0: [],
      1: [],
      2: [],
      3: [],
      4: [],
      5: [],
      6: [],
    };
    const weekStartMs = weekStart.getTime();
    for (const t of tasks) {
      const d = new Date(t.scheduledFor);
      const dayDiff = Math.floor((d.getTime() - weekStartMs) / (24 * 60 * 60 * 1000));
      if (dayDiff >= 0 && dayDiff < 7) {
        buckets[dayDiff].push(t);
      }
    }
    return buckets;
  }, [tasks, weekStart]);

  const doneCount = tasks.filter((t) => t.status === 'done').length;
  const today = new Date();
  const todayKey = isoMonday(today).toISOString();
  const isThisWeek = weekStart.toISOString() === todayKey;

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-6xl mx-auto">
      <header className="space-y-2">
        <CompassSubNav active="timeline" />
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-display text-display-md font-light tracking-tight">
              Strategic Timeline
            </h1>
            <p className="text-text-2 text-sm max-w-2xl">
              Weekly canvas of strategic tasks — separate from the Marketing
              Calendar (which holds tactical scheduled posts).
            </p>
          </div>
          <div className="flex items-center gap-1 text-xs font-mono text-text-3">
            <button
              type="button"
              onClick={() => setWeekStart(addDays(weekStart, -7))}
              className="px-2 py-1 hover:text-text-1"
            >
              ← prev
            </button>
            <button
              type="button"
              onClick={() => setWeekStart(isoMonday(new Date()))}
              className={`px-2 py-1 ${
                isThisWeek ? 'text-text-1' : 'hover:text-text-1'
              }`}
            >
              this week
            </button>
            <button
              type="button"
              onClick={() => setWeekStart(addDays(weekStart, 7))}
              className="px-2 py-1 hover:text-text-1"
            >
              next →
            </button>
          </div>
        </div>
      </header>

      {!hasMatrix && (
        <GlassCard className="p-5 border border-amber-500/30 bg-amber-500/5">
          <h3 className="font-display text-lg font-light mb-1">
            Priority Matrix not yet generated
          </h3>
          <p className="text-sm text-text-3 mb-3">
            Auto-populate pulls tasks from your Priority Matrix. Generate one
            first to seed this week, or add tasks manually below.
          </p>
          <Link href="/compass/priority">
            <Button size="sm">Open Priority Matrix →</Button>
          </Link>
        </GlassCard>
      )}

      <section className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-text-3">
          Week of{' '}
          <span className="text-text-1 font-medium">
            {formatDay(weekStart)}
          </span>{' '}
          · {tasks.length} task{tasks.length === 1 ? '' : 's'}
          {doneCount > 0 && (
            <span className="text-emerald-500 ml-1">
              ({doneCount} done)
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowAdd((s) => !s)}
          >
            {showAdd ? 'Cancel' : '+ Add task'}
          </Button>
          <Button
            size="sm"
            onClick={handlePopulate}
            disabled={populating || !hasMatrix}
          >
            {populating
              ? 'Populating…'
              : '⚡ Auto-populate from Priority Matrix'}
          </Button>
        </div>
      </section>

      {showAdd && (
        <GlassCard className="p-4 space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              placeholder="Task title (e.g. Decide pricing tier)"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="flex-1 px-3 py-2 bg-bg border border-border rounded-lg text-sm placeholder:text-text-3 focus:outline-none focus:border-border-bright"
              disabled={adding}
            />
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              className="px-3 py-2 bg-bg border border-border rounded-lg text-sm"
              disabled={adding}
            >
              {Object.keys(TASK_TYPE_ICON).map((t) => (
                <option key={t} value={t}>
                  {TASK_TYPE_ICON[t]} {t}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
            <input
              type="datetime-local"
              value={newWhen}
              onChange={(e) => setNewWhen(e.target.value)}
              className="px-3 py-2 bg-bg border border-border rounded-lg text-sm"
              disabled={adding}
            />
            <input
              type="number"
              min={5}
              max={600}
              step={5}
              value={newMinutes}
              onChange={(e) => setNewMinutes(Math.max(5, Number(e.target.value) || 30))}
              className="w-24 px-3 py-2 bg-bg border border-border rounded-lg text-sm"
              disabled={adding}
            />
            <span className="text-xs text-text-3">minutes</span>
            <Button
              size="sm"
              onClick={addManualTask}
              disabled={adding || !newTitle.trim()}
            >
              {adding ? 'Adding…' : 'Add'}
            </Button>
          </div>
        </GlassCard>
      )}

      {feedback && (
        <div
          className={`text-xs ${
            feedback.kind === 'error'
              ? 'text-danger'
              : feedback.kind === 'success'
                ? 'text-emerald-500'
                : 'text-text-2'
          }`}
        >
          {feedback.msg}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
        {DAY_NAMES.map((dayName, i) => {
          const dayDate = addDays(weekStart, i);
          const dayTasks = tasksByDay[i] ?? [];
          return (
            <DayColumn
              key={i}
              dayName={dayName}
              date={dayDate}
              tasks={dayTasks}
              projectId={project.id}
              onStatus={updateStatus}
              onDelete={deleteTask}
              onGenerate={handleGenerateClick}
            />
          );
        })}
      </div>

      {loading && (
        <div className="text-xs text-text-3 text-center">Loading week…</div>
      )}
    </div>
  );
}

function DayColumn({
  dayName,
  date,
  tasks,
  projectId,
  onStatus,
  onDelete,
  onGenerate,
}: {
  dayName: string;
  date: Date;
  tasks: TaskRow[];
  projectId: string;
  onStatus: (id: string, status: string) => void;
  onDelete: (id: string) => void;
  onGenerate: (task: TaskRow) => void;
}) {
  const today = new Date();
  const isToday =
    date.getUTCFullYear() === today.getUTCFullYear() &&
    date.getUTCMonth() === today.getUTCMonth() &&
    date.getUTCDate() === today.getUTCDate();
  return (
    <GlassCard
      className={`p-3 min-h-[260px] ${isToday ? 'border border-accent/40' : ''}`}
    >
      <div className="mb-2">
        <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3">
          {dayName}
        </div>
        <div className="font-display text-lg font-light text-text-1">
          {date.getUTCDate()}
        </div>
      </div>
      <div className="space-y-2">
        {tasks.length === 0 ? (
          <div className="text-[10px] font-mono text-text-3 italic">— —</div>
        ) : (
          tasks.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              projectId={projectId}
              onStatus={onStatus}
              onDelete={onDelete}
              onGenerate={onGenerate}
            />
          ))
        )}
      </div>
    </GlassCard>
  );
}

function TaskCard({
  task,
  projectId,
  onStatus,
  onDelete,
  onGenerate,
}: {
  task: TaskRow;
  projectId: string;
  onStatus: (id: string, status: string) => void;
  onDelete: (id: string) => void;
  onGenerate: (task: TaskRow) => void;
}) {
  const icon = TASK_TYPE_ICON[task.taskType] ?? TASK_TYPE_ICON.other;
  const isDone = task.status === 'done';
  const canGenerate =
    task.taskType === 'generate' &&
    Boolean(task.suggestedPlatform) &&
    Boolean(task.suggestedContentType);
  const href = canGenerate ? buildGenerateHref(task, projectId) : null;
  return (
    <div
      className={`p-2 border border-border rounded text-xs bg-bg ${
        isDone ? 'opacity-50' : ''
      }`}
    >
      <div className="flex items-start gap-1.5 mb-1">
        <span aria-hidden className="shrink-0">
          {icon}
        </span>
        <div className="flex-1 min-w-0">
          <div
            className={`font-medium leading-tight text-text-1 ${
              isDone ? 'line-through' : ''
            }`}
          >
            {task.title}
          </div>
          <div className="text-[10px] font-mono text-text-3 mt-0.5">
            {formatTime(task.scheduledFor)}
            {task.estimatedMinutes ? ` · ${task.estimatedMinutes}m` : ''}
          </div>
        </div>
      </div>
      {task.sourceContext && (
        <div className="text-[10px] text-text-3 italic mb-1.5 line-clamp-2">
          {task.sourceContext}
        </div>
      )}
      <div className="flex items-center gap-1 mt-1 pt-1 border-t border-border flex-wrap">
        <span
          className={`text-[9px] font-mono uppercase tracking-[0.1em] px-1.5 py-0.5 rounded ${STATUS_TINT[task.status] ?? STATUS_TINT.pending}`}
        >
          {task.status.replace('_', ' ')}
        </span>
        {canGenerate && href && !isDone && (
          <Link
            href={href}
            onClick={() => onGenerate(task)}
            className="text-[10px] font-mono text-accent hover:opacity-80"
          >
            generate →
          </Link>
        )}
        {!isDone && (
          <button
            type="button"
            onClick={() => onStatus(task.id, 'done')}
            className="text-[10px] font-mono text-text-3 hover:text-emerald-500"
          >
            done
          </button>
        )}
        {isDone && (
          <button
            type="button"
            onClick={() => onStatus(task.id, 'pending')}
            className="text-[10px] font-mono text-text-3 hover:text-text-1"
          >
            reopen
          </button>
        )}
        <button
          type="button"
          onClick={() => onDelete(task.id)}
          className="text-[10px] font-mono text-text-3 hover:text-danger ml-auto"
          aria-label="Delete task"
        >
          ×
        </button>
      </div>
    </div>
  );
}
