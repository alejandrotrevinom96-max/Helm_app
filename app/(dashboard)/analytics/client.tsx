'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Project, MetricSnapshot } from '@/lib/db/schema';
import { formatNumber, formatCurrency, timeAgo } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { GlassCard } from '@/components/ui/glass-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SetupIllustration } from '@/components/illustrations/setup';

type SyncResultData = {
  synced: Array<Record<string, unknown>>;
  errors: string[];
};

export function AnalyticsClient({
  project,
  snapshots,
  hasVercel,
  hasSupabase,
  hasMeta,
  lastSyncAt,
  hasMappings,
}: {
  project: Project;
  snapshots: MetricSnapshot[];
  hasVercel: boolean;
  hasSupabase: boolean;
  hasMeta: boolean;
  lastSyncAt: Date | null;
  hasMappings: boolean;
}) {
  const router = useRouter();

  const visitors = snapshots
    .filter((s) => s.metric === 'visitors')
    .reduce((sum, s) => sum + Number(s.value), 0);
  const signups = snapshots
    .filter((s) => s.metric === 'signups')
    .reduce((sum, s) => sum + Number(s.value), 0);
  const spend = snapshots
    .filter((s) => s.metric === 'spend')
    .reduce((sum, s) => sum + Number(s.value), 0);
  const cac = signups > 0 ? spend / signups : 0;

  const noData = snapshots.length === 0;
  const missingIntegrations = [
    !hasVercel && 'Vercel',
    !hasSupabase && 'Supabase',
    !hasMeta && 'Meta Ads',
  ].filter(Boolean) as string[];

  const sources = [
    hasVercel && 'Vercel',
    hasSupabase && 'Supabase',
    hasMeta && 'Meta Ads',
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="p-4 md:p-8">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-4 mb-6 md:mb-8">
        <div>
          <h1 className="font-display text-display-md font-light tracking-tight">
            Analytics
          </h1>
          <p className="text-text-2 mt-2 max-w-2xl text-sm">
            Cross-referenced metrics from {sources || 'no integrations yet'}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <SyncButton lastSyncAt={lastSyncAt} />
          <a href="/integrations" className="text-sm text-accent hover:underline">
            Manage →
          </a>
        </div>
      </div>

      {missingIntegrations.length > 0 && hasMappings && (
        <GlassCard className="mb-6 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Connect more sources for richer insights</p>
            <p className="text-xs text-text-3 mt-1">
              Missing: {missingIntegrations.join(', ')}
            </p>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => router.push('/integrations')}
            className="self-start sm:self-auto"
          >
            Connect
          </Button>
        </GlassCard>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
        <KPI label="Visitors" value={formatNumber(visitors)} source="vercel" />
        <KPI label="Signups" value={formatNumber(signups)} source="supabase" />
        <KPI label="CAC" value={cac > 0 ? formatCurrency(cac) : '—'} source="computed" />
        <KPI label="Ad Spend" value={spend > 0 ? formatCurrency(spend) : '—'} source="meta" />
      </div>

      {noData && !hasMappings && (
        <GlassCard className="p-8 md:p-12 text-center">
          <SetupIllustration className="w-32 mx-auto mb-6 opacity-80" />
          <h2 className="font-display text-2xl md:text-3xl font-light mb-3">
            Set up integrations for{' '}
            <em className="editorial-italic">{project.name}</em>
          </h2>
          <p className="text-text-2 max-w-md mx-auto mb-8 text-sm">
            Helm needs to know which Vercel + Supabase project corresponds to “{project.name}”.
            Map them once and metrics will flow.
          </p>
          <div className="flex gap-3 justify-center">
            <Button onClick={() => router.push('/integrations')}>
              Map projects →
            </Button>
          </div>
        </GlassCard>
      )}

      {noData && hasMappings && (
        <GlassCard className="p-8 md:p-12 text-center">
          <p className="font-display text-2xl mb-2">No data yet</p>
          <p className="text-text-2 text-sm mb-6 max-w-md mx-auto">
            Mappings are configured but no snapshots have synced yet. The cron runs once a
            day; tap “Sync now” to pull data immediately.
          </p>
        </GlassCard>
      )}
    </div>
  );
}

function KPI({ label, value, source }: { label: string; value: string; source: string }) {
  return (
    <GlassCard hover className="p-4 md:p-6">
      <div className="flex justify-between items-start mb-4 md:mb-6 gap-2">
        <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 truncate">
          {label}
        </span>
        <Badge>{source}</Badge>
      </div>
      <div className="font-display text-metric font-light tracking-tight truncate">
        {value}
      </div>
    </GlassCard>
  );
}

function SyncButton({ lastSyncAt }: { lastSyncAt: Date | null }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SyncResultData | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const sync = async () => {
    setLoading(true);
    setResult(null);
    setResultMessage(null);
    setShowDetails(false);
    try {
      const r = await fetch('/api/sync/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'all' }),
      });
      const data = await r.json();
      if (r.ok) {
        const count = Array.isArray(data.synced) ? data.synced.length : 0;
        setResult(data);
        setResultMessage(`✓ Synced ${count} source${count === 1 ? '' : 's'}`);
        setTimeout(() => location.reload(), 1500);
      } else {
        setResultMessage(`Error: ${data.error ?? 'unknown'}`);
      }
    } catch (e) {
      setResultMessage(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const errorCount = result?.errors?.length ?? 0;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {resultMessage && (
          <span className="text-xs text-text-2">{resultMessage}</span>
        )}
        <Button variant="outline" size="sm" onClick={sync} disabled={loading}>
          {loading ? 'Syncing…' : 'Sync now ↻'}
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-mono text-text-3">
          {lastSyncAt
            ? `Last synced ${timeAgo(lastSyncAt)} ago`
            : 'Never synced'}
        </span>
        {errorCount > 0 && (
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-[11px] text-text-3 hover:text-text-1 underline"
          >
            {errorCount} warning{errorCount === 1 ? '' : 's'}{' '}
            {showDetails ? '(hide)' : '(show)'}
          </button>
        )}
      </div>
      {showDetails && result && result.errors.length > 0 && (
        <ul
          className={cn(
            'mt-2 text-[11px] text-text-2 space-y-1 max-w-xs text-left',
            'glass rounded-lg p-3'
          )}
        >
          {result.errors.map((e, i) => (
            <li key={i} className="break-words">
              • {e}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
