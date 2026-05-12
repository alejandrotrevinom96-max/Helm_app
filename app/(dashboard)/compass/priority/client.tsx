'use client';

// PR #68 — Sprint 7.1B: Compass Priority Matrix client.
//
// Two layouts side-by-side:
//   - 2×2 quadrant grid with item titles + scores (at-a-glance map)
//   - Detailed list per quadrant with source attribution + actions
//
// Actions per item:
//   - "Generate {type} on {platform}" — deep link to /marketing/generate
//     with prompt pre-encoded. Also flips userStatus to 'in_progress'
//     in the background.
//   - "Mark done" — userStatus='done', card dims.
//   - "Dismiss" — userStatus='dismissed', card hides.
//
// Manual quadrant override is reachable via a small menu (future
// extension); v1 keeps the auto-derived quadrant from Opus scoring.
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { GlassCard } from '@/components/ui/glass-card';
import { Button } from '@/components/ui/button';

interface MatrixSummary {
  id: string;
  totalItems: number | null;
  itemsDoNow: number | null;
  itemsScheduled: number | null;
  itemsFillers: number | null;
  itemsAvoid: number | null;
  expiresAt: string | null;
  createdAt: string;
}

interface PriorityItemRow {
  id: string;
  title: string;
  description: string | null;
  impactScore: number;
  effortScore: number;
  quadrant: string;
  userOverrideQuadrant: string | null;
  sourceType: string | null;
  sourceContext: string | null;
  suggestedAction: string | null;
  suggestedContentType: string | null;
  suggestedPlatform: string | null;
  userStatus: string;
  reasoning: string | null;
}

interface Props {
  project: { id: string; name: string };
  hasBrandAnalysis: boolean;
  initialMatrix: MatrixSummary | null;
  initialItems: PriorityItemRow[];
}

const QUADRANTS: Array<{
  key: 'do_now' | 'scheduled' | 'fillers' | 'avoid';
  title: string;
  subtitle: string;
  tint: string;
}> = [
  {
    key: 'do_now',
    title: 'Do now',
    subtitle: 'High impact · Low effort',
    tint: 'border-emerald-500/40 bg-emerald-500/5',
  },
  {
    key: 'scheduled',
    title: 'Schedule',
    subtitle: 'High impact · High effort',
    tint: 'border-accent/40 bg-accent/5',
  },
  {
    key: 'fillers',
    title: 'Fillers',
    subtitle: 'Low impact · Low effort',
    tint: 'border-amber-500/40 bg-amber-500/5',
  },
  {
    key: 'avoid',
    title: 'Avoid',
    subtitle: 'Low impact · High effort',
    tint: 'border-danger/40 bg-danger/5',
  },
];

function effectiveQuadrant(item: PriorityItemRow): string {
  return item.userOverrideQuadrant ?? item.quadrant;
}

function statusTint(s: string): string {
  switch (s) {
    case 'done':
      return 'bg-emerald-500/15 text-emerald-500';
    case 'in_progress':
      return 'bg-accent/15 text-accent';
    case 'dismissed':
      return 'bg-text-3/15 text-text-3';
    default:
      return 'bg-bg-elev text-text-3';
  }
}

function sourceTypeLabel(t: string | null): string {
  switch (t) {
    case 'pain_point':
      return 'pain point';
    case 'opportunity':
      return 'opportunity';
    case 'competitor_gap':
      return 'competitor gap';
    case 'content_gap':
      return 'content gap';
    default:
      return 'signal';
  }
}

function buildGenerateHref(item: PriorityItemRow, projectId: string): string {
  if (!item.suggestedContentType || !item.suggestedPlatform) {
    return '/marketing/generate';
  }
  const prompt = [
    item.title,
    item.description ?? '',
    item.suggestedAction
      ? `\nNext step: ${item.suggestedAction}`
      : '',
    item.sourceContext
      ? `\nSignal: ${item.sourceContext}`
      : '',
  ]
    .filter(Boolean)
    .join('\n')
    .trim();
  const qs = new URLSearchParams({
    projectId,
    platform: item.suggestedPlatform,
    type: item.suggestedContentType,
    prompt,
    from: 'compass-priority',
  });
  return `/marketing/generate?${qs.toString()}`;
}

export function PriorityClient({
  project,
  hasBrandAnalysis,
  initialMatrix,
  initialItems,
}: Props) {
  const [matrix, setMatrix] = useState<MatrixSummary | null>(initialMatrix);
  const [items, setItems] = useState<PriorityItemRow[]>(initialItems);
  const [busy, setBusy] = useState<'idle' | 'generating'>('idle');
  const [feedback, setFeedback] = useState<{
    kind: 'success' | 'error' | 'info';
    msg: string;
  } | null>(null);
  const [hideDismissed, setHideDismissed] = useState(true);

  const generate = async (force: boolean) => {
    if (busy !== 'idle') return;
    setBusy('generating');
    setFeedback(null);
    try {
      const res = await fetch('/api/compass/priority-matrix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, force }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        cached?: boolean;
        matrix?: MatrixSummary & {
          createdAt: string | Date;
          expiresAt: string | Date | null;
        };
        items?: PriorityItemRow[];
        error?: string;
        hint?: string;
      };
      if (!res.ok || !data.success) {
        setFeedback({
          kind: 'error',
          msg: data.error ?? data.hint ?? 'Matrix generation failed',
        });
        return;
      }
      if (data.matrix) {
        setMatrix({
          id: data.matrix.id,
          totalItems: data.matrix.totalItems,
          itemsDoNow: data.matrix.itemsDoNow,
          itemsScheduled: data.matrix.itemsScheduled,
          itemsFillers: data.matrix.itemsFillers,
          itemsAvoid: data.matrix.itemsAvoid,
          createdAt:
            typeof data.matrix.createdAt === 'string'
              ? data.matrix.createdAt
              : new Date(data.matrix.createdAt).toISOString(),
          expiresAt: data.matrix.expiresAt
            ? typeof data.matrix.expiresAt === 'string'
              ? data.matrix.expiresAt
              : new Date(data.matrix.expiresAt).toISOString()
            : null,
        });
      }
      if (data.items) setItems(data.items);
      setFeedback({
        kind: data.cached ? 'info' : 'success',
        msg: data.cached
          ? 'Loaded cached matrix (still fresh).'
          : `Generated ${data.items?.length ?? 0} strategic moves.`,
      });
    } catch (e) {
      setFeedback({
        kind: 'error',
        msg: e instanceof Error ? e.message : 'Network error',
      });
    } finally {
      setBusy('idle');
    }
  };

  const updateItem = async (
    itemId: string,
    patch: { userStatus?: string; userOverrideQuadrant?: string | null },
  ) => {
    // Optimistic.
    setItems((prev) =>
      prev.map((i) =>
        i.id === itemId
          ? {
              ...i,
              userStatus:
                patch.userStatus !== undefined ? patch.userStatus : i.userStatus,
              userOverrideQuadrant:
                patch.userOverrideQuadrant !== undefined
                  ? patch.userOverrideQuadrant
                  : i.userOverrideQuadrant,
            }
          : i,
      ),
    );
    try {
      await fetch(`/api/compass/priority-items/${itemId}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
    } catch {
      /* swallow — UI already optimistic, errors are rare */
    }
  };

  const handleGenerateContent = async (item: PriorityItemRow) => {
    // Flip status to in_progress in the background; navigation
    // happens via the Link's href so we don't block on the fetch.
    if (item.userStatus === 'pending') {
      void updateItem(item.id, { userStatus: 'in_progress' });
    }
  };

  const visibleItems = useMemo(
    () =>
      hideDismissed
        ? items.filter((i) => i.userStatus !== 'dismissed')
        : items,
    [items, hideDismissed],
  );

  const byQuadrant = useMemo(() => {
    const acc: Record<string, PriorityItemRow[]> = {
      do_now: [],
      scheduled: [],
      fillers: [],
      avoid: [],
    };
    for (const it of visibleItems) {
      const q = effectiveQuadrant(it);
      if (acc[q]) acc[q].push(it);
    }
    return acc;
  }, [visibleItems]);

  const expiresAt = matrix?.expiresAt ? new Date(matrix.expiresAt) : null;
  const expired = expiresAt ? expiresAt.getTime() < Date.now() : false;

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-6xl mx-auto">
      <header className="space-y-2">
        <CompassSubNav active="priority" />
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-display text-display-md font-light tracking-tight">
              Priority Matrix
            </h1>
            <p className="text-text-2 text-sm max-w-2xl">
              Strategic moves scored Impact × Effort. Each item is sourced
              from your brand analysis, positioning benchmark, audience pain
              points, or content history — never generic advice.
            </p>
          </div>
          {matrix && (
            <span className="text-[11px] font-mono text-text-3">
              {matrix.totalItems} items ·{' '}
              {expired
                ? 'expired'
                : expiresAt
                  ? `fresh until ${expiresAt.toLocaleDateString()}`
                  : ''}
            </span>
          )}
        </div>
      </header>

      {!hasBrandAnalysis && (
        <GlassCard className="p-5 border border-amber-500/30 bg-amber-500/5">
          <h3 className="font-display text-lg font-light mb-1">
            Brand analysis required
          </h3>
          <p className="text-sm text-text-3 mb-3">
            The matrix seeds from your project's niche + audience layers + pain
            points. Run Smart Auto-configure first.
          </p>
          <Link href="/research">
            <Button size="sm">Open Research →</Button>
          </Link>
        </GlassCard>
      )}

      <section className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => generate(false)}
          disabled={busy !== 'idle' || !hasBrandAnalysis}
        >
          {busy === 'generating'
            ? 'Generating…'
            : matrix
              ? '↻ Refresh matrix'
              : '⚡ Generate matrix'}
        </Button>
        {matrix && (
          <button
            type="button"
            onClick={() => generate(true)}
            disabled={busy !== 'idle' || !hasBrandAnalysis}
            className="text-xs font-mono text-text-3 hover:text-text-1 disabled:opacity-50"
          >
            force regenerate
          </button>
        )}
        <label className="text-xs font-mono text-text-3 inline-flex items-center gap-2 cursor-pointer ml-auto">
          <input
            type="checkbox"
            checked={hideDismissed}
            onChange={(e) => setHideDismissed(e.target.checked)}
            className="accent-accent"
          />
          hide dismissed
        </label>
      </section>

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

      {matrix && visibleItems.length > 0 && (
        <>
          <QuadrantGrid byQuadrant={byQuadrant} />
          <ItemsList
            byQuadrant={byQuadrant}
            projectId={project.id}
            onUpdate={updateItem}
            onGenerate={handleGenerateContent}
          />
        </>
      )}

      {matrix && visibleItems.length === 0 && (
        <GlassCard className="p-6 text-center text-text-3 text-sm">
          All items dismissed or done. Regenerate to surface new moves.
        </GlassCard>
      )}
    </div>
  );
}

// Sibling-page nav so the founder can hop between Compass surfaces
// without going through the dashboard sidebar each time.
function CompassSubNav({
  active,
}: {
  active: 'home' | 'priority' | 'competitors';
}) {
  const tabs: Array<{ key: typeof active; href: string; label: string }> = [
    { key: 'home', href: '/compass', label: 'Score' },
    { key: 'priority', href: '/compass/priority', label: 'Priority' },
    { key: 'competitors', href: '/compass/competitors', label: 'Competitors' },
  ];
  return (
    <div className="flex items-center gap-1 text-xs font-mono uppercase tracking-[0.15em] text-text-3">
      <Link href="/compass" className="hover:text-text-1 transition-colors">
        Compass
      </Link>
      <span>/</span>
      {tabs.map((t, i) => (
        <span key={t.key} className="flex items-center gap-1">
          <Link
            href={t.href}
            className={
              t.key === active
                ? 'text-text-1'
                : 'hover:text-text-1 transition-colors'
            }
          >
            {t.label}
          </Link>
          {i < tabs.length - 1 && <span className="opacity-50">·</span>}
        </span>
      ))}
    </div>
  );
}

function QuadrantGrid({
  byQuadrant,
}: {
  byQuadrant: Record<string, PriorityItemRow[]>;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {QUADRANTS.map((q) => {
        const list = byQuadrant[q.key] ?? [];
        return (
          <GlassCard key={q.key} className={`p-4 border ${q.tint}`}>
            <div className="flex items-baseline justify-between mb-2">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-2">
                  {q.title}
                </div>
                <div className="text-[10px] font-mono text-text-3">
                  {q.subtitle}
                </div>
              </div>
              <span className="text-xs font-mono text-text-3">
                {list.length}
              </span>
            </div>
            {list.length === 0 ? (
              <div className="text-xs text-text-3 italic">— empty —</div>
            ) : (
              <ul className="space-y-1.5">
                {list.map((i) => (
                  <li
                    key={i.id}
                    className={`text-xs ${
                      i.userStatus === 'done'
                        ? 'opacity-50 line-through'
                        : ''
                    }`}
                  >
                    <div className="font-medium text-text-1">
                      {i.title}
                    </div>
                    <div className="text-text-3 font-mono">
                      Impact {i.impactScore} · Effort {i.effortScore}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </GlassCard>
        );
      })}
    </div>
  );
}

function ItemsList({
  byQuadrant,
  projectId,
  onUpdate,
  onGenerate,
}: {
  byQuadrant: Record<string, PriorityItemRow[]>;
  projectId: string;
  onUpdate: (
    id: string,
    patch: { userStatus?: string; userOverrideQuadrant?: string | null },
  ) => void;
  onGenerate: (item: PriorityItemRow) => void;
}) {
  return (
    <div className="space-y-5">
      {QUADRANTS.map((q) => {
        const list = byQuadrant[q.key] ?? [];
        if (list.length === 0) return null;
        return (
          <section key={q.key} className="space-y-2">
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-xl font-light">{q.title}</h2>
              <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3">
                {q.subtitle} · {list.length}
              </span>
            </div>
            <div className="space-y-2">
              {list.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  projectId={projectId}
                  onUpdate={onUpdate}
                  onGenerate={onGenerate}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ItemCard({
  item,
  projectId,
  onUpdate,
  onGenerate,
}: {
  item: PriorityItemRow;
  projectId: string;
  onUpdate: (
    id: string,
    patch: { userStatus?: string; userOverrideQuadrant?: string | null },
  ) => void;
  onGenerate: (item: PriorityItemRow) => void;
}) {
  const isDone = item.userStatus === 'done';
  const canGenerate =
    Boolean(item.suggestedContentType) && Boolean(item.suggestedPlatform);
  const href = canGenerate ? buildGenerateHref(item, projectId) : null;

  return (
    <GlassCard
      className={`p-4 ${isDone ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-medium text-text-1">
              {isDone ? '✓ ' : ''}
              {item.title}
            </span>
            <span
              className={`text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-0.5 rounded ${statusTint(item.userStatus)}`}
            >
              {item.userStatus.replace('_', ' ')}
            </span>
            <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3">
              {sourceTypeLabel(item.sourceType)}
            </span>
          </div>
          {item.description && (
            <p className="text-sm text-text-2 mb-1">{item.description}</p>
          )}
          {item.sourceContext && (
            <p className="text-xs text-text-3 italic">
              Signal: {item.sourceContext}
            </p>
          )}
        </div>
        <div className="text-right shrink-0 text-xs font-mono">
          <div>
            <span className="text-text-3">impact </span>
            <span className="text-text-1">{item.impactScore}</span>
          </div>
          <div>
            <span className="text-text-3">effort </span>
            <span className="text-text-1">{item.effortScore}</span>
          </div>
        </div>
      </div>

      {item.reasoning && (
        <p className="text-xs text-text-3 italic border-l-2 border-accent/40 pl-3 mb-3">
          {item.reasoning}
        </p>
      )}

      {item.suggestedAction && (
        <p className="text-xs text-text-2 mb-3">
          <span className="text-text-3">Next step: </span>
          {item.suggestedAction}
        </p>
      )}

      <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-border">
        {canGenerate && href && !isDone && (
          <Link href={href}>
            <Button
              size="sm"
              onClick={() => onGenerate(item)}
            >
              ⚡ Generate {item.suggestedContentType?.replace(/_/g, ' ')} on{' '}
              {item.suggestedPlatform}
            </Button>
          </Link>
        )}
        {item.userStatus !== 'done' && (
          <button
            type="button"
            onClick={() => onUpdate(item.id, { userStatus: 'done' })}
            className="text-xs font-mono text-text-3 hover:text-emerald-500"
          >
            mark done
          </button>
        )}
        {item.userStatus === 'done' && (
          <button
            type="button"
            onClick={() => onUpdate(item.id, { userStatus: 'pending' })}
            className="text-xs font-mono text-text-3 hover:text-text-1"
          >
            reopen
          </button>
        )}
        {item.userStatus !== 'dismissed' && (
          <button
            type="button"
            onClick={() => onUpdate(item.id, { userStatus: 'dismissed' })}
            className="text-xs font-mono text-text-3 hover:text-danger ml-auto"
          >
            dismiss
          </button>
        )}
      </div>
    </GlassCard>
  );
}
