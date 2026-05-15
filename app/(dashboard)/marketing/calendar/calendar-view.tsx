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
import { getPlatformStyle } from '@/lib/platforms/colors';
// PR Sprint 7.24 — Prompt 4. Per-content-type colored dots used in
// the month-view daily density indicator (one dot per post on a
// day, colored by the post's content type). Same color palette
// the Library + drafts pool use, so the visual language is
// consistent across the whole Marketing surface.
import { ContentTypeDot } from '@/components/marketing/ContentTypeBadge';

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
  // PR #43 — Sprint 6.7.1: click handler. Calendar chips were
  // drag-only pre-PR-43; the founder reported that clicking a
  // post should open a detail modal with the caption + visual +
  // share button. We pass the click up to CalendarClient which
  // owns the modal state. Only chips with a real id call this
  // (drafts pool chips have their own drag wiring).
  onPostClick?: (post: CalendarPost) => void;
}

// PR #42 — Sprint 6.7: brand-color borders on calendar chips.
// Pre-PR-42 we used Tailwind palette approximations (pink-500 for
// IG, etc.); now we share the canonical brand color map with the
// drafts pool + library + share modal so a post visually
// identifies as the same "Instagram pink" everywhere it appears.

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
  onPostClick,
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
                min-h-[200px] p-3 rounded-lg border-2 transition-all
                ${
                  // PR Sprint 7.24 — Prompt 4. Enhanced drag
                  // feedback. Pre-fix the highlight was a 1px
                  // accent border + 10%-opacity tint — too
                  // subtle on dark theme. Now: 2px solid border
                  // + ring shadow + accent background, so the
                  // founder can't miss where they're about to drop.
                  isOver
                    ? 'border-accent bg-accent/15 shadow-lg shadow-accent/20 cursor-copy'
                    : 'border-transparent bg-bg-elev/30'
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
                {dayPosts.map((post) => {
                  const style = getPlatformStyle(post.platform);
                  return (
                  <div
                    key={post.id}
                    draggable
                    onDragStart={(e) => handleChipDragStart(e, post)}
                    onDragEnd={onDragEnd}
                    onClick={() => onPostClick?.(post)}
                    role={onPostClick ? 'button' : undefined}
                    tabIndex={onPostClick ? 0 : undefined}
                    onKeyDown={(e) => {
                      if (
                        onPostClick &&
                        (e.key === 'Enter' || e.key === ' ')
                      ) {
                        e.preventDefault();
                        onPostClick(post);
                      }
                    }}
                    className={`
                      p-2 border-l-4
                      border border-border rounded text-xs cursor-pointer hover:border-border-bright hover:bg-bg
                      transition-colors
                      ${STATUS_TINT[post.status] ?? 'bg-bg'}
                    `}
                    style={{ borderLeftColor: style.brand }}
                  >
                    <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-3 mb-1 flex items-center gap-1 flex-wrap">
                      <span>{fmtTime(post.scheduledFor)} · {post.platform}</span>
                      {/* PR #62 — Sprint 7.0.5: per-format chip from
                          the structured-drafts flow. Renders only
                          when contentType is set (Sprint 7.0.6 will
                          populate it server-side on schedule). */}
                      {post.contentType && (
                        <span
                          className="text-accent"
                          title={`Content format: ${post.contentType}`}
                          aria-label={`Format: ${post.contentType}`}
                        >
                          · {post.contentType.replace(/_/g, ' ')}
                        </span>
                      )}
                      {/* PR #30 — Story marker. Pink to match IG. */}
                      {post.isStory && (
                        <span
                          className="text-pink-500"
                          title="Instagram Story"
                          aria-label="Instagram Story"
                        >
                          📸
                        </span>
                      )}
                      {/* PR #32 — Reel marker. Purple distinguishes from
                          Story pink. */}
                      {post.isReel && (
                        <span
                          className="text-purple-500"
                          title={
                            post.reelProcessingStatus === 'meta_processing'
                              ? 'Reel — Meta is processing'
                              : 'Instagram Reel'
                          }
                          aria-label="Instagram Reel"
                        >
                          🎬
                        </span>
                      )}
                      {/* PR #29 — auto-publish indicator. Tiny so it
                          doesn't dominate the chip. */}
                      {post.publishStatus === 'published' && (
                        <span
                          className="text-emerald-500"
                          title="Published"
                          aria-label="Published"
                        >
                          ✓
                        </span>
                      )}
                      {post.publishStatus === 'failed' && (
                        <span
                          className="text-danger"
                          title="Publishing failed"
                          aria-label="Publishing failed"
                        >
                          ⚠
                        </span>
                      )}
                    </div>
                    <div className="line-clamp-3 text-text-1">
                      {post.content}
                    </div>
                  </div>
                  );
                })}
                {dayPosts.length === 0 && (
                  <div
                    className={`text-[10px] italic ${
                      // PR Sprint 7.24 — Prompt 4. Invite when
                      // dragging. The user reported they couldn't
                      // tell where to drop because empty cells
                      // looked identical to non-targets. Now an
                      // active drag bumps the empty-state copy to
                      // accent + a drop arrow so the affordance
                      // is unambiguous.
                      draggedItem
                        ? 'text-accent font-medium not-italic'
                        : 'text-text-3'
                    }`}
                  >
                    {draggedItem ? '↓ Drop a draft here' : 'No posts'}
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
                min-h-[100px] p-2 rounded border-2 transition-all
                ${
                  // PR Sprint 7.24 — Prompt 4. Same enhanced drag
                  // feedback as week view: 2px solid + ring +
                  // accent tint so the drop target is unambiguous
                  // at month-view scale (cells are smaller and
                  // the 1px border was easy to miss).
                  isOver
                    ? 'border-accent bg-accent/15 shadow-lg shadow-accent/20 cursor-copy'
                    : 'border-transparent'
                }
                ${!isCurrentMonth ? 'opacity-40' : ''}
                ${
                  isToday
                    ? 'ring-1 ring-accent bg-accent/5'
                    : 'bg-bg-elev/30'
                }
              `}
            >
              <div className="flex items-center justify-between gap-1 mb-1">
                <div
                  className={`text-sm ${isToday ? 'text-accent font-medium' : 'text-text-2'}`}
                >
                  {day.getDate()}
                </div>
                {/* PR Sprint 7.24 — Prompt 4. Per-content-type
                    density dots. One dot per post, colored by the
                    content type (carousel-blue / photo-green /
                    ugc-amber / text-gray). Lets the founder skim
                    the month and see at a glance which days are
                    heavy + which formats dominate without
                    expanding each cell. Cap at 6 to keep cells
                    tidy; "+N" sits next to the row for overflow. */}
                {dayPosts.length > 0 && (
                  <div
                    className="flex items-center gap-0.5 shrink-0"
                    aria-label={`${dayPosts.length} post${dayPosts.length === 1 ? '' : 's'} on this day`}
                  >
                    {dayPosts.slice(0, 6).map((p) => (
                      <ContentTypeDot
                        key={p.id}
                        contentType={p.contentType ?? null}
                        size={5}
                      />
                    ))}
                    {dayPosts.length > 6 && (
                      <span className="text-[8px] font-mono text-text-3 ml-0.5">
                        +{dayPosts.length - 6}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div className="space-y-1">
                {dayPosts.slice(0, 3).map((post) => {
                  const style = getPlatformStyle(post.platform);
                  return (
                  <div
                    key={post.id}
                    draggable
                    onDragStart={(e) => handleChipDragStart(e, post)}
                    onDragEnd={onDragEnd}
                    onClick={() => onPostClick?.(post)}
                    role={onPostClick ? 'button' : undefined}
                    tabIndex={onPostClick ? 0 : undefined}
                    onKeyDown={(e) => {
                      if (
                        onPostClick &&
                        (e.key === 'Enter' || e.key === ' ')
                      ) {
                        e.preventDefault();
                        onPostClick(post);
                      }
                    }}
                    title={post.content}
                    className={`
                      px-1.5 py-1 border-l-4
                      border border-border rounded text-[10px] cursor-pointer
                      hover:border-border-bright hover:bg-bg truncate transition-colors
                      ${STATUS_TINT[post.status] ?? 'bg-bg'}
                    `}
                    style={{ borderLeftColor: style.brand }}
                  >
                    <span>{fmtTime(post.scheduledFor)} {post.platform}</span>
                    {/* PR #62 — Sprint 7.0.5: format chip. */}
                    {post.contentType && (
                      <span
                        className="ml-1 text-accent"
                        aria-label={`Format: ${post.contentType}`}
                      >
                        · {post.contentType.replace(/_/g, ' ')}
                      </span>
                    )}
                    {post.isStory && (
                      <span
                        className="text-pink-500 ml-1"
                        aria-label="Instagram Story"
                      >
                        📸
                      </span>
                    )}
                    {post.isReel && (
                      <span
                        className="text-purple-500 ml-1"
                        aria-label="Instagram Reel"
                      >
                        🎬
                      </span>
                    )}
                    {post.publishStatus === 'published' && (
                      <span className="text-emerald-500 ml-1" aria-label="Published">✓</span>
                    )}
                    {post.publishStatus === 'failed' && (
                      <span className="text-danger ml-1" aria-label="Publishing failed">⚠</span>
                    )}
                  </div>
                  );
                })}
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
