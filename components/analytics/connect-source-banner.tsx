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
// Caller passes the set of connected providers and the variant
// picks itself. When everything is connected, the component
// returns null so the parent has zero layout cost.
import Link from 'next/link';
import { GlassCard } from '@/components/ui/glass-card';

interface Props {
  hasMeta: boolean;
  hasReddit: boolean;
  // hasMappings is only relevant for the legacy "no project
  // mapped" empty state — kept as a prop so the parent can decide
  // whether to render the banner at all. We just gate on the
  // missing source list inside.
}

interface Variant {
  copy: string;
  href: string;
  cta: string;
}

const META_ADS_VARIANT: Variant = {
  copy: 'Connect Meta Ads to see your real CAC and campaign ROI — not just estimated numbers.',
  href: '/integrations',
  cta: 'Connect Meta Ads →',
};

const REDDIT_VARIANT: Variant = {
  copy: 'Connect Reddit to unlock audience research — find real pain points to turn into posts.',
  href: '/integrations',
  cta: 'Connect Reddit →',
};

export function ConnectSourceBanner({ hasMeta, hasReddit }: Props) {
  let variant: Variant | null = null;
  if (!hasMeta) variant = META_ADS_VARIANT;
  else if (!hasReddit) variant = REDDIT_VARIANT;

  if (!variant) return null;

  return (
    <GlassCard className="mb-6 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <p className="text-sm text-text-2">{variant.copy}</p>
      <Link
        href={variant.href}
        className="text-sm font-medium text-accent hover:underline self-start sm:self-auto whitespace-nowrap"
      >
        {variant.cta}
      </Link>
    </GlassCard>
  );
}
