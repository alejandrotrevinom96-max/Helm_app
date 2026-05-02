'use client';

import { useState } from 'react';
import type { Project, MetricSnapshot } from '@/lib/db/schema';
import { formatNumber, formatCurrency } from '@/lib/utils';

export function AnalyticsClient({
  project,
  snapshots,
  hasVercel,
  hasSupabase,
  hasMeta,
}: {
  project: Project;
  snapshots: MetricSnapshot[];
  hasVercel: boolean;
  hasSupabase: boolean;
  hasMeta: boolean;
}) {
  const visitors = snapshots.filter(s => s.metric === 'visitors').reduce((sum, s) => sum + Number(s.value), 0);
  const signups = snapshots.filter(s => s.metric === 'signups').reduce((sum, s) => sum + Number(s.value), 0);
  const spend = snapshots.filter(s => s.metric === 'spend').reduce((sum, s) => sum + Number(s.value), 0);
  const cac = signups > 0 ? spend / signups : 0;

  const noData = snapshots.length === 0;
  const missingIntegrations = [
    !hasVercel && 'Vercel',
    !hasSupabase && 'Supabase',
    !hasMeta && 'Meta Ads',
  ].filter(Boolean);

  return (
    <div className="p-8">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="font-display text-4xl font-medium tracking-tight">Analytics</h1>
          <p className="text-text-dim mt-1 text-sm">
            Cross-referenced metrics from {[hasVercel && 'Vercel', hasSupabase && 'Supabase', hasMeta && 'Meta Ads'].filter(Boolean).join(', ') || 'no integrations yet'}
          </p>
        </div>
        <a href="/integrations" className="text-sm text-accent hover:underline">
          Manage integrations →
        </a>
      </div>

      {missingIntegrations.length > 0 && (
        <div className="bg-accent-soft border border-accent/20 rounded-xl p-4 mb-6 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Connect more sources for richer insights</p>
            <p className="text-xs text-text-dim mt-1">
              Missing: {missingIntegrations.join(', ')}
            </p>
          </div>
          <a href="/integrations" className="bg-accent text-bg px-4 py-2 rounded-lg text-sm font-medium">
            Connect
          </a>
        </div>
      )}

      <div className="grid grid-cols-4 gap-4 mb-6">
        <KPI label="Visitors" value={formatNumber(visitors)} source="vercel" />
        <KPI label="Signups" value={formatNumber(signups)} source="supabase" />
        <KPI label="CAC" value={cac > 0 ? formatCurrency(cac) : '—'} source="computed" />
        <KPI label="Ad Spend" value={spend > 0 ? formatCurrency(spend) : '—'} source="meta" />
      </div>

      {noData && (
        <div className="bg-bg-elev border border-border rounded-xl p-12 text-center">
          <p className="font-display text-2xl mb-2">No data yet</p>
          <p className="text-text-dim mb-6">
            Connect your first integration to start collecting metrics. They sync hourly.
          </p>
          <a href="/integrations" className="inline-block bg-accent text-bg px-6 py-3 rounded-lg font-medium">
            Connect integrations
          </a>
        </div>
      )}
    </div>
  );
}

function KPI({ label, value, source }: { label: string; value: string; source: string }) {
  return (
    <div className="bg-bg-elev border border-border rounded-xl p-5">
      <div className="flex justify-between items-center mb-3">
        <div className="text-xs font-mono uppercase tracking-wider text-text-faint">{label}</div>
        <div className="text-[10px] font-mono px-1.5 py-0.5 bg-bg border border-border rounded text-text-faint">
          {source}
        </div>
      </div>
      <div className="font-display text-4xl font-medium tracking-tight">{value}</div>
    </div>
  );
}
