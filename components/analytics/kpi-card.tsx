// PR #83 — Sprint 7.8: unified KPI card.
//
// Replaces the two ad-hoc KPI components that lived in
// app/(dashboard)/analytics/client.tsx (numeric value + Badge) and
// app/(dashboard)/analytics/helm-activity-section.tsx (value +
// Sparkline). Both grew separately and started diverging in
// behavior; this is the single source.
//
// Shape:
//   - eyebrow label (small caps)
//   - either: prominent value + optional delta line + optional
//     sparkline
//   - or: <EmptyWidget /> body (when caller passes `empty`)
//
// `empty` takes precedence over `value` — when present, the entire
// card swaps to the empty-state body. That way the caller doesn't
// have to think about "what counts as empty" — they decide once
// (e.g. CAC === 0 → empty) and pass the appropriate prop.
import type { ReactNode } from 'react';
import { GlassCard } from '@/components/ui/glass-card';
import { Badge } from '@/components/ui/badge';
import { Sparkline } from '@/components/ui/sparkline';
import { EmptyWidget } from './empty-widget';

interface DeltaProps {
  current: number;
  previous: number | null;
  period?: string;
}

interface Props {
  label: string;
  value?: ReactNode;
  source?: string;
  // Optional delta line beneath the number. `previous: null` hides
  // the line — see lib/analytics/dashboard.ts for the "no prior
  // window data" semantic.
  delta?: DeltaProps;
  sparkline?: number[];
  footer?: ReactNode;
  empty?: {
    title: string;
    subtext: string;
    ctaLabel?: string;
    ctaHref?: string;
  };
}

function formatDelta(current: number, previous: number): {
  symbol: string;
  text: string;
  tint: string;
} {
  const diff = current - previous;
  if (diff === 0) {
    return {
      symbol: '→',
      text: 'No change',
      tint: 'text-text-3',
    };
  }
  if (diff > 0) {
    return {
      symbol: '↑',
      text: `+${diff}`,
      tint: 'text-emerald-500',
    };
  }
  return {
    symbol: '↓',
    text: `${diff}`,
    tint: 'text-danger',
  };
}

export function KpiCard({
  label,
  value,
  source,
  delta,
  sparkline,
  footer,
  empty,
}: Props) {
  if (empty) {
    return (
      <GlassCard className="p-4 md:p-5">
        <div className="flex items-start justify-between gap-2 mb-3">
          <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 truncate">
            {label}
          </span>
          {source && <Badge>{source}</Badge>}
        </div>
        <EmptyWidget {...empty} />
      </GlassCard>
    );
  }

  const showDelta =
    delta &&
    delta.previous !== null &&
    typeof delta.current === 'number' &&
    typeof delta.previous === 'number';
  const period = delta?.period ?? '7d';

  return (
    <GlassCard className="p-4 md:p-5">
      <div className="flex items-start justify-between gap-2 mb-3">
        <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 truncate">
          {label}
        </span>
        {source && <Badge>{source}</Badge>}
      </div>
      <div className="font-display text-3xl md:text-4xl font-light tracking-tight truncate">
        {value ?? '—'}
      </div>
      {showDelta && delta && (
        <DeltaLine
          {...formatDelta(delta.current, delta.previous as number)}
          period={period}
        />
      )}
      {sparkline && sparkline.length > 0 && (
        <div className="text-accent mt-2">
          <Sparkline
            data={sparkline}
            width={100}
            height={24}
            ariaLabel={`${label} trend`}
          />
        </div>
      )}
      {footer && (
        <div className="text-[10px] text-text-3 mt-2">{footer}</div>
      )}
    </GlassCard>
  );
}

function DeltaLine({
  symbol,
  text,
  tint,
  period,
}: {
  symbol: string;
  text: string;
  tint: string;
  period: string;
}) {
  return (
    <div className={`text-xs mt-1 ${tint}`}>
      <span aria-hidden>{symbol}</span> {text}{' '}
      <span className="text-text-3">
        {symbol === '→' ? '' : `vs last ${period}`}
      </span>
    </div>
  );
}
