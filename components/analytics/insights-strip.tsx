'use client';

// PR #83 — Sprint 7.8: "This week" AI-generated insights strip at
// the top of /analytics.
//
// Client-side fetch on mount so the page itself stays a server
// component (no Suspense boundary cost, no streaming complexity).
// While loading: 3 skeleton rows (same height as a real item to
// avoid layout jump). On error or empty array: render nothing
// (silent fail). On success: 2–3 rows with a directional icon
// (↑/↓/→) inferred from `type` and the text from Haiku.
//
// PR Sprint 7.25 Phase 3 — repainted on top of the platform redesign
// (platform-insight rows with up/down/flat tinted icon chips).
import { useEffect, useState } from 'react';

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

export function InsightsStrip() {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'ready'; insights: Insight[] }
    | { kind: 'error' }
  >({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
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
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

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
      <div className="platform-insights-label">
        This week · {state.insights.length} insight
        {state.insights.length === 1 ? '' : 's'}
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
