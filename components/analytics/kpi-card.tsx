// PR #83 — Sprint 7.8: unified KPI card.
//
// Replaces the two ad-hoc KPI components that lived in
// app/(dashboard)/analytics/client.tsx (numeric value + Badge) and
// app/(dashboard)/analytics/helm-activity-section.tsx (value +
// Sparkline). Both grew separately and started diverging in
// behavior; this is the single source.
//
// Shape:
//   - eyebrow label (small caps) + source pill (top row)
//   - either: prominent value + optional delta line + optional
//     sparkline (the "has-value" variant — uses the Instrument
//     Serif 76px gradient number)
//   - or: empty-state body (title + subtext + optional CTA)
//
// `empty` takes precedence over `value` — when present, the entire
// card swaps to the empty-state body.
//
// PR Sprint 7.25 Phase 3 — repainted on top of the platform redesign
// (platform-metric-card with per-source glow, 76px Instrument Serif
// gradient number, mono source pill row, mono delta chips).
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Sparkline } from '@/components/ui/sparkline';

type Source =
  | 'supabase'
  | 'vercel'
  | 'helm'
  | 'meta'
  | 'computed'
  | (string & {});

interface DeltaProps {
  current: number;
  previous: number | null;
  period?: string;
}

interface Props {
  label: string;
  value?: ReactNode;
  source?: Source;
  delta?: DeltaProps;
  sparkline?: number[];
  footer?: ReactNode;
  empty?: {
    title: string;
    subtext: string;
    ctaLabel?: string;
    ctaHref?: string;
  };
  /** Glow tint for the card. Defaults map from `source` when not
   *  set: supabase→green, vercel→blue, helm→orange,
   *  meta→blue, computed→purple. */
  glow?: 'green' | 'blue' | 'orange' | 'purple' | 'red';
}

const SOURCE_DEFAULT_GLOW: Record<string, Props['glow']> = {
  supabase: 'green',
  vercel: 'blue',
  helm: 'orange',
  meta: 'blue',
  computed: 'purple',
};

const SOURCE_PILL_LABEL: Record<string, string> = {
  supabase: 'Supabase',
  vercel: 'Vercel',
  helm: 'Helm',
  meta: 'Meta',
  computed: 'Computed',
};

function formatDelta(current: number, previous: number): {
  symbol: string;
  text: string;
  variant: 'up' | 'down' | 'flat';
} {
  const diff = current - previous;
  if (diff === 0) {
    return { symbol: '→', text: 'No change', variant: 'flat' };
  }
  if (diff > 0) {
    return { symbol: '↑', text: `+${diff}`, variant: 'up' };
  }
  return { symbol: '↓', text: `${diff}`, variant: 'down' };
}

export function KpiCard({
  label,
  value,
  source,
  delta,
  sparkline,
  footer,
  empty,
  glow,
}: Props) {
  const resolvedGlow =
    glow ?? (source ? SOURCE_DEFAULT_GLOW[source] : undefined) ?? 'blue';
  const pillLabel = source ? SOURCE_PILL_LABEL[source] ?? source : null;
  const sourceClass = source ? `platform-source-pill-${source}` : '';

  if (empty) {
    return (
      <div className={`platform-metric-card platform-card-glow-${resolvedGlow}`}>
        <div className="platform-metric-card-head">
          <span className="platform-metric-card-lbl">{label}</span>
          {pillLabel && (
            <span className={`platform-source-pill ${sourceClass}`}>
              {pillLabel}
            </span>
          )}
        </div>
        <h3 className="platform-metric-card-title">{empty.title}</h3>
        <p className="platform-metric-card-desc">{empty.subtext}</p>
        {empty.ctaLabel && empty.ctaHref ? (
          <Link
            href={empty.ctaHref}
            className={
              resolvedGlow === 'blue'
                ? 'platform-cta-link platform-cta-link-blue'
                : resolvedGlow === 'purple'
                  ? 'platform-cta-link platform-cta-link-purple'
                  : 'platform-cta-link'
            }
          >
            {empty.ctaLabel}
            <svg viewBox="0 0 16 16" fill="none" aria-hidden>
              <path
                d="M3 8h10M9 4l4 4-4 4"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
        ) : null}
      </div>
    );
  }

  const showDelta =
    delta &&
    delta.previous !== null &&
    typeof delta.current === 'number' &&
    typeof delta.previous === 'number';
  const deltaInfo = showDelta
    ? formatDelta(delta!.current, delta!.previous as number)
    : null;
  const period = delta?.period ?? '7d';

  return (
    <div
      className={`platform-metric-card platform-metric-card-has-value platform-card-glow-${resolvedGlow}`}
    >
      <div className="platform-metric-card-head">
        <span className="platform-metric-card-lbl">{label}</span>
        {pillLabel && (
          <span className={`platform-source-pill ${sourceClass}`}>
            {pillLabel}
          </span>
        )}
      </div>
      <div className="platform-big-num">{value ?? '—'}</div>
      {sparkline && sparkline.length > 0 && (
        <div
          className="platform-sparkline"
          style={{
            color:
              resolvedGlow === 'green'
                ? 'var(--d-green-2)'
                : resolvedGlow === 'orange'
                  ? 'var(--d-orange-2)'
                  : resolvedGlow === 'purple'
                    ? 'var(--d-purple-2)'
                    : 'var(--d-blue-2)',
          }}
        >
          <Sparkline
            data={sparkline}
            width={300}
            height={56}
            ariaLabel={`${label} trend`}
          />
        </div>
      )}
      <div className="platform-meta-row">
        <span>{footer ?? null}</span>
        {deltaInfo && (
          <span className={`platform-delta platform-delta-${deltaInfo.variant}`}>
            <span aria-hidden>{deltaInfo.symbol}</span>
            {deltaInfo.text}
            {deltaInfo.variant !== 'flat' && (
              <span style={{ color: 'var(--text-3)', marginLeft: '4px' }}>
                vs {period}
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
