'use client';

// PR #24 — Sprint 2.3 (initial drag-drop within the calendar).
// PR #25 — Sprint 2.4 lifts drag state up to CalendarClient so the
// Drafts pool drawer can participate in the same drag operation.
//
// Calendar grid. Two layouts share most of the logic:
//   - Week view:  7 columns × 1 tall row (200px+ per cell)
//   - Month view: 6 rows × 7 cols, smaller cells, shows up to 3 posts
//                 per day with a "+N more" overflow indicator
//
// Drag handling uses the native HTML5 DnD API (no library). Internal
// chips (already-scheduled posts) AND external chips (drafts from the
// pool) push themselves into the parent's `draggedItem` state via
// `onDragStart`. `handleDrop` reads from props, not local state, so
// the source of the drag is irrelevant to this component — onDrop
// fires for both.
import type { CalendarPost } from '@/app/api/marketing/calendar/route';

// Minimal shape used for drags — supports both already-scheduled
// CalendarPost rows and generated_posts drafts. The `source`
// discriminator tells the parent which API to call after the drop.
export interface DraggedItem {
  id: string;
  source: 'scheduled' | 'generated';
  platform: string;
  content: string;
  scheduledFor: string | null;
}

interface Props {
  posts: CalendarPost[];
  currentDate: Date;
  viewMode: 'week' | 'month';
  draggedItem: DraggedItem | null;
  dragOverKey: string | null;
  onDragStart: (item: DraggedItem) => void;
  onDragEnd: () => void;
  onDragOverDay: (key: string | null) => void;
  onDrop: (item: DraggedItem, date: Date) => void;
}

const PLATFORM_COLOR: Record<string, string> = {
  instagram: 'border-l-pink-500',
  facebook: 'border-l-blue-600',
  linkedin: 'border-l-sky-700',
  threads: 'border-l-text-2',
  reddit: 'border-l-orange-500',
};

const STATUS_TINT: Record<string, string> = {
  scheduled: 'bg-bg',
  notified: 'bg-bg',
  posted: 'bg-emerald-500/5',
  cancelled: 'bg-danger/5 line-through opacity-60',
};

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function generateDays(date: Date, mode: 'week' | 'month'): Date[] {
  if (mode === 'week') {
    const start = new Date(date);
    start.setDate(date.getDate() - date.getDay());
    start.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, i) => {
      const day = new Date(start);
      day.setDate(start.getDate() + i);
      return day;
    });
  }
  // Month view: 6×7 grid covering the month + leading/trailing
  // adjacent-month days so every row is full.
  const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const startDate = new Date(firstDay);
  startDate.setDate(firstDay.getDate() - firstDay.getDay());
  const endDate = new Date(lastDay);
  endDate.setDate(lastDay.getDate() + (6 - lastDay.getDay()));
  const days: Date[] = [];
  const cur = new Date(startDate);
  while (cur <= endDate) {
    days.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

function calendarPostToDragItem(post: CalendarPost): DraggedItem {
  return {
    id: post.id,
    source: 'scheduled',
    platform: post.platform,
    content: post.content,
    scheduledFor: post.scheduledFor,
  };
}

export function CalendarView({
  posts,
  currentDate,
  viewMode,
  draggedItem,
  dragOverKey,
  onDragStart,
  onDragEnd,
  onDragOverDay,
  onDrop,
}: Props) {
  const days = generateDays(currentDate, viewMode);
  const today = new Date();

  const postsForDay = (d: Date) =>
    posts.filter((p) => isSameDay(new Date(p.scheduledFor), d));

  const dayKey = (d: Date) =>
    `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

  const handleChipDragStart = (
    e: React.DragEvent<HTMLDivElement>,
    post: CalendarPost
  ) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', post.id);
    onDragStart(calendarPostToDragItem(post));
  };

  const handleDayDragOver = (
    e: React.DragEvent<HTMLDivElement>,
    key: string
  ) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverKey !== key) onDragOverDay(key);
  };

  const handleDayDragLeave = (
    e: React.DragEvent<HTMLDivElement>,
    key: string
  ) => {
    // Only clear if we're actually leaving this cell (not just moving
    // into a child of the cell).
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    if (dragOverKey === key) onDragOverDay(null);
  };

  const handleDayDrop = (
    e: React.DragEvent<HTMLDivElement>,
    date: Date
  ) => {
    e.preventDefault();
    onDragOverDay(null);
    if (!draggedItem) return;
    // Drop on the same day a scheduled post is already on = no-op (the
    // user probably grabbed the wrong cell). Drafts have scheduledFor
    // null so this guard never fires for pool drops.
    if (
      draggedItem.scheduledFor &&
      isSameDay(new Date(draggedItem.scheduledFor), date)
    ) {
      onDragEnd();
      return;
    }
    onDrop(draggedItem, date);
  };

  // ===== WEEK VIEW =====
  if (viewMode === 'week') {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {days.map((day) => {
          const dayPosts = postsForDay(day);
          const k = dayKey(day);
          const isToday = isSameDay(day, today);
          const isOver = dragOverKey === k;
          return (
            <div
              key={k}
              onDragOver={(e) => handleDayDragOver(e, k)}
              onDragLeave={(e) => handleDayDragLeave(e, k)}
              onDrop={(e) => handleDayDrop(e, day)}
              className={`
                min-h-[200px] p-3 rounded-lg border transition-colors
                ${
                  isOver
                    ? 'border-accent bg-accent/10'
                    : 'border-border bg-bg-elev/30'
                }
                ${isToday ? 'ring-1 ring-accent ring-offset-2 ring-offset-bg' : ''}
              `}
            >
              <div className="mb-2">
                <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3">
                  {day.toLocaleDateString(undefined, { weekday: 'short' })}
                </div>
                <div
                  className={`text-2xl font-display font-light ${
                    isToday ? 'text-accent' : ''
                  }`}
                >
                  {day.getDate()}
                </div>
              </div>

              <div className="space-y-2">
                {dayPosts.map((post) => (
                  <div
                    key={post.id}
                    draggable
                    onDragStart={(e) => handleChipDragStart(e, post)}
                    onDragEnd={onDragEnd}
                    className={`
                      p-2 border-l-2 ${PLATFORM_COLOR[post.platform] ?? 'border-l-text-3'}
                      border border-border rounded text-xs cursor-move hover:border-border-bright hover:bg-bg
                      transition-colors
                      ${STATUS_TINT[post.status] ?? 'bg-bg'}
                    `}
                  >
                    <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-3 mb-1">
                      {fmtTime(post.scheduledFor)} · {post.platform}
                    </div>
                    <div className="line-clamp-3 text-text-1">
                      {post.content}
                    </div>
                  </div>
                ))}
                {dayPosts.length === 0 && (
                  <div className="text-[10px] text-text-3 italic">
                    No posts
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // ===== MONTH VIEW =====
  return (
    <div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div
            key={d}
            className="text-center text-[10px] font-mono uppercase tracking-[0.1em] text-text-3 py-2"
          >
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const dayPosts = postsForDay(day);
          const k = dayKey(day);
          const isToday = isSameDay(day, today);
          const isCurrentMonth = day.getMonth() === currentDate.getMonth();
          const isOver = dragOverKey === k;
          return (
            <div
              key={k}
              onDragOver={(e) => handleDayDragOver(e, k)}
              onDragLeave={(e) => handleDayDragLeave(e, k)}
              onDrop={(e) => handleDayDrop(e, day)}
              className={`
                min-h-[100px] p-2 rounded border transition-colors
                ${
                  isOver
                    ? 'border-accent bg-accent/10'
                    : 'border-border'
                }
                ${!isCurrentMonth ? 'opacity-40' : ''}
                ${
                  isToday
                    ? 'ring-1 ring-accent bg-accent/5'
                    : 'bg-bg-elev/30'
                }
              `}
            >
              <div
                className={`text-sm mb-1 ${isToday ? 'text-accent font-medium' : 'text-text-2'}`}
              >
                {day.getDate()}
              </div>
              <div className="space-y-1">
                {dayPosts.slice(0, 3).map((post) => (
                  <div
                    key={post.id}
                    draggable
                    onDragStart={(e) => handleChipDragStart(e, post)}
                    onDragEnd={onDragEnd}
                    title={post.content}
                    className={`
                      px-1.5 py-1 border-l-2 ${PLATFORM_COLOR[post.platform] ?? 'border-l-text-3'}
                      border border-border rounded text-[10px] cursor-move
                      hover:border-border-bright hover:bg-bg truncate transition-colors
                      ${STATUS_TINT[post.status] ?? 'bg-bg'}
                    `}
                  >
                    {fmtTime(post.scheduledFor)} {post.platform}
                  </div>
                ))}
                {dayPosts.length > 3 && (
                  <div className="text-[10px] text-text-3">
                    +{dayPosts.length - 3} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
