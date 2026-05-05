'use client';

import { useState } from 'react';
import { GlassCard } from '@/components/ui/glass-card';
import { Sparkline } from '@/components/ui/sparkline';

interface KpiData {
  value: number;
  sparkline: number[];
}

interface ResponseRate {
  value: number;
  total: number;
  activePages: number;
}

interface Props {
  totalSignups: KpiData;
  postsPublished: KpiData;
  researchInsights: KpiData;
  validateResponseRate: ResponseRate;
}

// Collapsible "Helm activity" section. Default closed because the
// real-product metrics (Your business) above are usually the answer
// the user is looking for; Helm-internal counts are secondary context
// they only need when debugging their own workspace.
export function HelmActivitySection({
  totalSignups,
  postsPublished,
  researchInsights,
  validateResponseRate,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <section className="border-t border-border pt-8 mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start justify-between gap-4 text-left group"
        aria-expanded={open}
      >
        <div>
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-accent mb-1">
            Helm activity
          </div>
          <h2 className="font-display text-2xl font-light mb-1 group-hover:text-accent transition-colors">
            What you&apos;re doing in Helm
          </h2>
          <p className="text-sm text-text-2">
            Waitlists, posts, and research signals from your Helm workspace.
          </p>
        </div>
        <div className="text-xs font-mono uppercase tracking-[0.1em] text-text-3 mt-2 whitespace-nowrap">
          {open ? 'Hide ▴' : 'Show ▾'}
        </div>
      </button>

      {open && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          <GlassCard className="p-5">
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
              Waitlist signups
            </div>
            <div className="font-display text-3xl font-light tracking-tight mb-2">
              {totalSignups.value}
            </div>
            <div className="text-accent">
              <Sparkline
                data={totalSignups.sparkline}
                width={100}
                height={24}
                ariaLabel="signups trend"
              />
            </div>
            <div className="text-[10px] text-text-3 mt-1">
              all-time · sparkline 14d
            </div>
          </GlassCard>

          <GlassCard className="p-5">
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
              Posts published
            </div>
            <div className="font-display text-3xl font-light tracking-tight mb-2">
              {postsPublished.value}
            </div>
            <div className="text-accent">
              <Sparkline
                data={postsPublished.sparkline}
                width={100}
                height={24}
                ariaLabel="posts trend"
              />
            </div>
            <div className="text-[10px] text-text-3 mt-1">last 30 days</div>
          </GlassCard>

          <GlassCard className="p-5">
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
              Research findings
            </div>
            <div className="font-display text-3xl font-light tracking-tight mb-2">
              {researchInsights.value}
            </div>
            <div className="text-accent">
              <Sparkline
                data={researchInsights.sparkline}
                width={100}
                height={24}
                ariaLabel="findings trend"
              />
            </div>
            <div className="text-[10px] text-text-3 mt-1">
              all-time · sparkline 14d
            </div>
          </GlassCard>

          <GlassCard className="p-5">
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
              Avg responses per page
            </div>
            <div className="font-display text-3xl font-light tracking-tight mb-2">
              {validateResponseRate.value}
            </div>
            <div className="text-[10px] text-text-3 mt-2">
              {validateResponseRate.total} total ·{' '}
              {validateResponseRate.activePages} pages
            </div>
          </GlassCard>
        </div>
      )}
    </section>
  );
}
