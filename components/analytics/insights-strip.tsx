'use client';

// PR #83 — Sprint 7.8: "This week" AI-generated insights strip at
// the top of /analytics.
//
// Client-side fetch on mount so the page itself stays a server
// component (no Suspense boundary cost, no streaming complexity).
// While loading: 2 skeleton rows. On error or empty array: render
// nothing (silent fail — the page degrades to plain widgets). On
// success: 2–3 rows with a directional icon (↑/↓/→) inferred from
// `type` and the text from Haiku.
//
// The endpoint is global-scoped (no projectId param). If we
// per-project this later, pass `scope` + `projectId` through here.
import { useEffect, useState } from 'react';

interface Insight {
  type: 'up' | 'down' | 'neutral';
  text: string;
}

const ICONS: Record<Insight['type'], string> = {
  up: '↑',
  down: '↓',
  neutral: '→',
};

const TINTS: Record<Insight['type'], string> = {
  up: 'text-emerald-500',
  down: 'text-danger',
  neutral: 'text-text-3',
};

export function InsightsStrip() {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'ready'; insights: Insight[] }
    | { kind: 'error' }
  >({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/analytics/insights', {
          cache: 'no-store',
        });
        if (!res.ok) {
          if (!cancelled) setState({ kind: 'error' });
          return;
        }
        const data = (await res.json()) as { insights?: Insight[] };
        if (cancelled) return;
        const insights = Array.isArray(data.insights) ? data.insights : [];
        setState({ kind: 'ready', insights });
      } catch {
        if (!cancelled) setState({ kind: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Skeleton — 2 rows of shimmer-ish bars at the height of an
  // actual insight item, so the layout doesn't jump when data
  // arrives.
  //
  // Hotfix: pre-fix the row background was `bg-bg-elev/40`,
  // which in dark mode resolved to oklch(18% 0 0) @ 40%
  // opacity — visibly DARKER than the page bg (oklch(15%)),
  // producing the "zona negra opaca entre secciones" the
  // founder reported. Swapped to `.glass` (var(--surface-1) +
  // backdrop blur) so the strip blends with every other
  // Editorial Glass surface on the page.
  if (state.kind === 'loading') {
    return (
      <section aria-label="This week — loading" className="mb-6">
        <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
          This week
        </div>
        <div className="grid grid-cols-1 gap-2">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="glass flex items-center gap-2 p-3 rounded-lg"
            >
              <span className="w-3 h-3 rounded-full bg-text-3/15 animate-pulse" />
              <span className="h-3 flex-1 rounded bg-text-3/15 animate-pulse" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  // Silent fail — caller never sees the strip when there's nothing
  // useful to surface.
  if (state.kind === 'error' || state.insights.length === 0) {
    return null;
  }

  return (
    <section aria-label="This week" className="mb-6">
      <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
        This week
      </div>
      <div className="grid grid-cols-1 gap-2">
        {state.insights.map((insight, i) => (
          <div
            key={i}
            className="glass flex items-start gap-2 p-3 rounded-lg text-sm text-text-2"
          >
            <span
              className={`text-base leading-none shrink-0 ${TINTS[insight.type]}`}
              aria-hidden
            >
              {ICONS[insight.type]}
            </span>
            <span>{insight.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
