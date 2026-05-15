// PR #83 — Sprint 7.8: priority-ordered "connect more sources" banner.
//
// Replaces the old generic banner ("Missing: Meta, Reddit, ...")
// with a single, source-specific call to action that explains the
// VALUE of connecting (real CAC, audience research) instead of
// just naming what's missing.
//
// Priority order: Meta Ads > Reddit > everything else. We never
// stack two banners — one paged item at a time is plenty for a
// dashboard top-section.
//
// PR Sprint 7.25 Phase 3 — repainted on top of the platform redesign
// (blue glow banner with explicit CTA pill). API contract unchanged.
import Link from 'next/link';

interface Props {
  hasMeta: boolean;
  hasReddit: boolean;
}

interface Variant {
  copyLead: string;
  copyTail: string;
  href: string;
  cta: string;
}

const META_ADS_VARIANT: Variant = {
  copyLead: 'Connect Meta Ads',
  copyTail:
    'to see your real CAC and campaign ROI — not just estimated numbers.',
  href: '/integrations',
  cta: 'Connect Meta Ads',
};

const REDDIT_VARIANT: Variant = {
  copyLead: 'Connect Reddit',
  copyTail:
    'to unlock audience research — find real pain points to turn into posts.',
  href: '/integrations',
  cta: 'Connect Reddit',
};

export function ConnectSourceBanner({ hasMeta, hasReddit }: Props) {
  let variant: Variant | null = null;
  if (!hasMeta) variant = META_ADS_VARIANT;
  else if (!hasReddit) variant = REDDIT_VARIANT;

  if (!variant) return null;

  return (
    <div className="platform-meta-cta platform-reveal-3">
      <p className="platform-meta-cta-text">
        <b>{variant.copyLead}</b> {variant.copyTail}
      </p>
      <Link href={variant.href} className="platform-meta-cta-btn">
        {variant.cta}
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M3 8h10M9 4l4 4-4 4"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </Link>
    </div>
  );
}
