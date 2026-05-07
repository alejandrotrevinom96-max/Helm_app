'use client';

// PR #25 — Sprint 2.4: Drafts pool drawer in Calendar.
//
// Right-rail drawer that lists the active project's drafts (status='draft')
// as draggable chips. The user reported "I have 10 posts I just generated;
// I should be able to see them on the right and drag them onto the
// calendar." This solves that.
//
// Two states:
//   - Collapsed: 48px-wide vertical strip with count + "Drafts" label
//   - Expanded:  320px panel with search + scrollable list + footer hint
//
// The drag itself uses HTML5 DnD. We DON'T own drag state here — the
// parent (CalendarClient) lifts it via `onDragStart(post)` so the
// CalendarView's drop handler can access the same dragged item.
//
// `refreshKey` is a parent-controlled counter: bump it to force a refetch
// after a drop succeeds (the just-scheduled draft should disappear).
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Inbox } from 'lucide-react';
import type { LibraryPost } from '@/app/api/marketing/library/route';

interface Props {
  projectId: string;
  isOpen: boolean;
  onToggle: () => void;
  onDragStart: (post: LibraryPost) => void;
  onDragEnd: () => void;
  refreshKey: number;
}

export function DraftsPool({
  projectId,
  isOpen,
  onToggle,
  onDragStart,
  onDragEnd,
  refreshKey,
}: Props) {
  const [drafts, setDrafts] = useState<LibraryPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    const fetchDrafts = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          projectId,
          status: 'draft',
        });
        const res = await fetch(`/api/marketing/library?${params}`);
        const data: { posts?: LibraryPost[] } = await res.json();
        if (!cancelled) {
          setDrafts(data.posts ?? []);
        }
      } catch {
        if (!cancelled) setDrafts([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchDrafts();
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshKey]);

  // Local-only filter so typing in search is instant — the underlying
  // request already returned every draft (typically a few dozen at most).
  const filtered = search.trim()
    ? drafts.filter((d) =>
        d.content.toLowerCase().includes(search.trim().toLowerCase())
      )
    : drafts;

  // ===== COLLAPSED =====
  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="
          flex flex-col items-center gap-2 py-4 px-2
          border border-border rounded-lg bg-bg-elev/30
          hover:bg-accent/10 hover:border-accent transition-colors
          self-start
        "
        title="Open drafts pool"
        aria-label="Open drafts pool"
      >
        <ChevronLeft className="w-4 h-4 text-text-3" />
        <div className="writing-vertical text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 py-2">
          Drafts
        </div>
        <div className="text-xs font-mono text-accent font-medium">
          {drafts.length}
        </div>
      </button>
    );
  }

  // ===== EXPANDED =====
  return (
    <aside
      className="
        w-full lg:w-80 lg:flex-shrink-0
        border border-border rounded-lg bg-bg-elev/30
        flex flex-col
        max-h-[70vh] lg:max-h-none lg:h-[min(80vh,800px)]
        self-start
      "
    >
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Inbox className="w-4 h-4 text-accent" />
          <h3 className="font-display text-base font-light">Drafts</h3>
          <span className="text-xs font-mono text-text-3">
            ({drafts.length})
          </span>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="text-text-3 hover:text-text-1 transition-colors"
          title="Collapse drafts pool"
          aria-label="Collapse drafts pool"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="p-3 border-b border-border">
        <input
          type="text"
          placeholder="Search drafts…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-xs outline-none focus:border-accent"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading ? (
          <div className="text-center py-8 text-text-3 text-xs">
            Loading drafts…
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-8 text-text-3 text-xs">
            {search.trim() ? 'No drafts match search' : 'No drafts yet'}
          </div>
        ) : (
          filtered.map((draft) => (
            <DraftChip
              key={draft.id}
              draft={draft}
              onDragStart={() => onDragStart(draft)}
              onDragEnd={onDragEnd}
            />
          ))
        )}
      </div>

      <div className="p-3 border-t border-border">
        <p className="text-[10px] text-text-3 leading-relaxed">
          Drag any draft to a day to schedule it. You&apos;ll pick a golden
          time after drop.
        </p>
      </div>
    </aside>
  );
}

function DraftChip({
  draft,
  onDragStart,
  onDragEnd,
}: {
  draft: LibraryPost;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        // Some browsers require setData to actually start the drag.
        // We use the id as a payload but the real source-of-truth is
        // the lifted state in the parent.
        e.dataTransfer.setData('text/plain', draft.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className="
        group p-3 bg-bg border border-border rounded-lg cursor-move
        hover:border-accent hover:bg-bg-elev transition-colors
      "
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[9px] font-mono uppercase tracking-[0.1em] text-text-3 bg-bg-elev px-1.5 py-0.5 rounded">
          {draft.platform}
        </span>
        <div
          className="text-text-3 group-hover:text-accent text-xs"
          aria-hidden
        >
          ⋮⋮
        </div>
      </div>

      <p className="text-xs text-text-1 line-clamp-3 leading-relaxed whitespace-pre-wrap">
        {draft.content}
      </p>

      {draft.visualUrl && (
        <div className="mt-2 flex items-center gap-1 text-[10px] text-text-3">
          <span>🖼</span>
          <span>Image attached</span>
        </div>
      )}
    </div>
  );
}
