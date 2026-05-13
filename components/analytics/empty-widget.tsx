// PR #83 — Sprint 7.8: empty-state body for an analytics widget.
//
// Renders INSIDE an existing GlassCard / KPI wrapper — the parent
// keeps the same outer box size so the grid stays aligned whether
// the widget has data or not. We deliberately do NOT pull GlassCard
// in here; the caller composes both layers so the empty card looks
// identical in dimensions to a populated one.
//
// CTA is optional. Some empty states ("Vercel may take 24h after
// first deploy") are honest waits with no action — no CTA. Others
// ("Connect Meta Ads") are paywalled on an integration — show the
// CTA href.
import Link from 'next/link';

interface Props {
  title: string;
  subtext: string;
  ctaLabel?: string;
  ctaHref?: string;
}

export function EmptyWidget({ title, subtext, ctaLabel, ctaHref }: Props) {
  return (
    <div className="flex flex-col h-full">
      <div className="text-sm font-medium text-text-1 mb-1.5 leading-tight">
        {title}
      </div>
      <p className="text-xs text-text-3 leading-relaxed mb-2">{subtext}</p>
      {ctaLabel && ctaHref ? (
        <Link
          href={ctaHref}
          className="text-xs text-accent hover:underline mt-auto"
        >
          {ctaLabel}
        </Link>
      ) : null}
    </div>
  );
}
