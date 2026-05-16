'use client';

// PR #83 — Sprint 7.8: "This week" AI-generated insights strip at
// the top of /analytics.
// PR Sprint B-finish: surface cache freshness + manual Refresh.
//
// Client-side fetch on mount so the page itself stays a server
// component (no Suspense boundary cost, no streaming complexity).
// While loading: 3 skeleton rows (same height as a real item to
// avoid layout jump). On error or empty array: render nothing
// (silent fail). On success: 2–3 rows with a directional icon
// (↑/↓/→) inferred from `type` and the text from the model.
//
// PR Sprint 7.25 Phase 3 — repainted on top of the platform redesign
// (platform-insight rows with up/down/flat tinted icon chips).
//
// PR Sprint B-finish — adds a small meta row under the section
// label with "Last refreshed X min ago" + a ↻ Refresh button.
// The button hits `?refresh=true` to bypass the cache; the
// server still writes the result back so the next page load is
// instant.
import { useCallback, useEffect, useState } from 'react';

interface Insight {
  type: 'up' | 'down' | 'neutral';
  text: string;
}

type Variant = 'up' | 'down' | 'flat';

const TYPE_TO_VARIANT: Record<Insight['type'], Variant> = {
  up: 'up',
  down: 'down',
  neutral: 'flat',
};

// Render "X min ago" / "X h ago" / "X d ago". Defensive against
// future generatedAt timestamps (in case clock skew gives a
// negative delta) — clamps to "just now".
function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function ArrowIcon({ variant }: { variant: Variant }) {
  if (variant === 'up') {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M5 19l7-7 7 7M12 12V5" />
      </svg>
    );
  }
  if (variant === 'down') {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M19 5l-7 7-7-7M12 12v7" />
      </svg>
    );
  }
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 12h14M13 8l4 4-4 4" />
    </svg>
  );
}

interface ReadyState {
  kind: 'ready';
  insights: Insight[];
  generatedAt: string | null;
}

type State =
  | { kind: 'loading' }
  | ReadyState
  | { kind: 'error' };

export function InsightsStrip() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

  // Single fetch helper used by both the mount effect and the
  // manual ↻ Refresh button. `refresh=true` flips the server-side
  // cache short-circuit off so the founder gets fresh bullets;
  // the server still writes the result back to the cache.
  const fetchInsights = useCallback(
    async ({ refresh }: { refresh: boolean }): Promise<void> => {
      try {
        const url = refresh
          ? '/api/analytics/insights?refresh=true'
          : '/api/analytics/insights';
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) {
          setState({ kind: 'error' });
          return;
        }
        const data = (await res.json()) as {
          insights?: Insight[];
          generatedAt?: string;
        };
        const insights = Array.isArray(data.insights) ? data.insights : [];
        setState({
          kind: 'ready',
          insights,
          generatedAt: data.generatedAt ?? null,
        });
      } catch {
        setState({ kind: 'error' });
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        if (cancelled) return;
        await fetchInsights({ refresh: false });
      })();
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [fetchInsights]);

  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    await fetchInsights({ refresh: true });
    setRefreshing(false);
  }, [fetchInsights, refreshing]);

  if (state.kind === 'loading') {
    return (
      <section
        aria-label="This week — loading"
        className="platform-insights platform-reveal-2"
      >
        <div className="platform-insights-label">
          This week · loading insights
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="platform-insight platform-insight-flat">
            <span
              className="platform-insight-ico"
              style={{ opacity: 0.4 }}
              aria-hidden
            />
            <span
              className="platform-insight-text"
              style={{
                height: '14px',
                background:
                  'linear-gradient(90deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))',
                borderRadius: '4px',
              }}
            />
          </div>
        ))}
      </section>
    );
  }

  // Silent fail
  if (state.kind === 'error' || state.insights.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="This week"
      className="platform-insights platform-reveal-2"
    >
      <div
        className="platform-insights-label"
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <span>
          This week · {state.insights.length} insight
          {state.insights.length === 1 ? '' : 's'}
        </span>
        {/* PR Sprint B-finish — freshness chip + Refresh button.
            generatedAt may be null on the first render path
            where the server didn't return it; skip the timestamp
            in that case but still render the button. */}
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '10px',
            textTransform: 'none',
            letterSpacing: '0',
            color: 'var(--text-3)',
          }}
        >
          {state.generatedAt && (
            <span>Last refreshed {formatRelative(state.generatedAt)}</span>
          )}
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            aria-label="Refresh insights"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--accent)',
              cursor: refreshing ? 'wait' : 'pointer',
              fontSize: '11px',
              fontFamily: 'inherit',
              padding: '2px 6px',
              opacity: refreshing ? 0.6 : 1,
            }}
          >
            {refreshing ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </span>
      </div>
      {state.insights.map((insight, i) => {
        const variant = TYPE_TO_VARIANT[insight.type];
        return (
          <div
            key={i}
            className={`platform-insight platform-insight-${variant}`}
          >
            <span className="platform-insight-ico">
              <ArrowIcon variant={variant} />
            </span>
            <p className="platform-insight-text">{insight.text}</p>
          </div>
        );
      })}
    </section>
  );
}
