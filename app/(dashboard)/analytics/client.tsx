'use client';

// PR #83 — Sprint 7.8: regrouped analytics surface.
//
// Pre-PR-83 the page had two flat sections ("YOUR BUSINESS" with 4
// integration-driven KPIs + "HELM ACTIVITY" with 4 internal counters
// behind a collapsible). The new shape organizes 8+ widgets into 4
// semantic groups so the founder finds what they're looking for
// without reading every label:
//
//   GROWTH              — Users (Supabase) | Visitors (Vercel) | Waitlist Signups
//   CONTENT PERFORMANCE — Posts Published | Research Findings
//   ENGAGEMENT          — Post Engagement (was "Avg responses per page")
//   MONETIZATION        — CAC (Computed) | Ad Spend (Meta)
//
// Each widget uses the unified KpiCard (components/analytics/kpi-
// card.tsx) which knows how to render: value + delta + sparkline,
// OR the empty-state body when data is 0/—. Empty-state copy is
// driven by the per-widget config below.
//
// What this file does NOT touch:
//   - URL scope query param (`?scope=project|global`) — owned by
//     the parent page.tsx Link toggle (PR #18). We just respect
//     the `scope` prop.
//   - getDashboardData() aggregation math — that's in
//     lib/analytics/dashboard.ts.
//   - The SyncButton component below — same behavior as before.
import { useState } from 'react';
import type { Project, MetricSnapshot } from '@/lib/db/schema';
import { formatNumber, formatCurrency, timeAgo } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { KpiCard } from '@/components/analytics/kpi-card';
import { ConnectSourceBanner } from '@/components/analytics/connect-source-banner';

type SyncResultData = {
  synced: Array<Record<string, unknown>>;
  errors: string[];
};

interface KpiBlock {
  value: number;
  sparkline: number[];
  previous: number | null;
  period: '7d';
}

interface ResponseRate {
  value: number;
  total: number;
  activePages: number;
}

interface Props {
  project: Project | { id: string; name: string };
  snapshots: MetricSnapshot[];
  hasVercel: boolean;
  hasSupabase: boolean;
  hasMeta: boolean;
  hasReddit: boolean;
  lastSyncAt: Date | null;
  hasMappings: boolean;
  scope?: 'project' | 'global';
  // Internal Helm-activity KPIs (computed in
  // lib/analytics/dashboard.ts) — folded into the new groups.
  totalSignups: KpiBlock;
  postsPublished: KpiBlock;
  researchInsights: KpiBlock;
  validateResponseRate: ResponseRate;
}

export function AnalyticsClient({
  project,
  snapshots,
  hasVercel,
  hasSupabase,
  hasMeta,
  hasReddit,
  lastSyncAt,
  hasMappings,
  scope = 'project',
  totalSignups,
  postsPublished,
  researchInsights,
  validateResponseRate,
}: Props) {
  // --- snapshot aggregation (same math as pre-PR-83) ---
  // Each metric snapshot stores the ABSOLUTE value at sync time;
  // we dedupe by (projectId, source) in global scope and take the
  // single row in project scope. See PR #18 for why.
  const aggregate = (metric: string): number => {
    if (scope === 'project') {
      const row = snapshots.find((s) => s.metric === metric);
      return row ? Number(row.value) : 0;
    }
    const latestPerKey = new Map<string, number>();
    for (const s of snapshots) {
      if (s.metric !== metric) continue;
      const key = `${s.projectId}:${s.source}`;
      if (!latestPerKey.has(key)) latestPerKey.set(key, Number(s.value));
    }
    let total = 0;
    for (const v of latestPerKey.values()) total += v;
    return total;
  };

  const visitors = aggregate('visitors');
  const spend = aggregate('spend');

  // Supabase metrics — one widget per tracked table (PR #19).
  // Filter the legacy `signups` metric (PR #19 cleanup).
  const LEGACY_SUPABASE_METRICS = new Set(['signups']);
  const supabaseMetricsSet = new Set<string>();
  for (const s of snapshots) {
    if (s.source !== 'supabase') continue;
    if (LEGACY_SUPABASE_METRICS.has(s.metric)) continue;
    supabaseMetricsSet.add(s.metric);
  }
  const supabaseMetrics = Array.from(supabaseMetricsSet).sort();

  // Sum across Supabase tables to get a total "users" number for
  // the CAC denominator. Best-effort — see PR #19 comment.
  const signups = supabaseMetrics.reduce(
    (sum, m) => sum + aggregate(m),
    0,
  );
  const cac = signups > 0 ? spend / signups : 0;

  const labelForMetric = (metric: string): string => {
    if (metric === 'auth.users') return 'Auth users';
    return metric.charAt(0).toUpperCase() + metric.slice(1);
  };

  const sources = [
    hasVercel && 'Vercel',
    hasSupabase && 'Supabase',
    hasMeta && 'Meta Ads',
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div>
      <div className="flex items-center justify-end gap-3 mb-4 flex-wrap">
        <span className="text-xs text-text-3">
          Sources: {sources || 'none connected'}
        </span>
        <SyncButton lastSyncAt={lastSyncAt} />
        <a
          href="/integrations"
          className="text-xs text-accent hover:underline"
        >
          Manage →
        </a>
      </div>

      <ConnectSourceBanner hasMeta={hasMeta} hasReddit={hasReddit} />

      {/* ──────────────── GROWTH ──────────────── */}
      <GroupSection label="Growth">
        {/* Each Supabase-tracked table renders as its own card.
            Falls back to a single empty card when no Supabase
            metric exists yet. */}
        {supabaseMetrics.length === 0 ? (
          <KpiCard
            label="Users"
            source="supabase"
            empty={{
              title: 'No users tracked yet',
              subtext: 'Map a Supabase table in Integrations to surface signups.',
              ctaLabel: 'Connect Supabase →',
              ctaHref: '/integrations',
            }}
          />
        ) : (
          supabaseMetrics.map((metric) => {
            const v = aggregate(metric);
            return (
              <KpiCard
                key={metric}
                label={labelForMetric(metric)}
                source="supabase"
                value={formatNumber(v)}
              />
            );
          })
        )}

        {/* Visitors: when Vercel snapshot is 0, distinguish
            "connected but no traffic yet" (24h lag) from "not
            connected" (no Vercel integration). */}
        {visitors === 0 ? (
          <KpiCard
            label="Visitors"
            source="vercel"
            empty={
              hasVercel
                ? {
                    title: 'No visitors tracked yet',
                    subtext:
                      'Vercel Analytics may take 24h after first deploy.',
                  }
                : {
                    title: 'Vercel not connected',
                    subtext:
                      'Connect Vercel to track visitors, deployments, and traffic.',
                    ctaLabel: 'Connect Vercel →',
                    ctaHref: '/integrations',
                  }
            }
          />
        ) : (
          <KpiCard
            label="Visitors"
            source="vercel"
            value={formatNumber(visitors)}
          />
        )}

        {/* Waitlist signups — internal counter from
            getDashboardData(). Empty state when zero. */}
        {totalSignups.value === 0 ? (
          <KpiCard
            label="Waitlist signups"
            source="helm"
            empty={{
              title: 'No waitlist signups yet',
              subtext:
                'Share your waitlist page or add a CTA to your next post.',
              ctaLabel: 'Create waitlist page →',
              ctaHref: '/marketing',
            }}
          />
        ) : (
          <KpiCard
            label="Waitlist signups"
            source="helm"
            value={formatNumber(totalSignups.value)}
            delta={{
              current: totalSignups.value,
              previous: totalSignups.previous,
              period: totalSignups.period,
            }}
            sparkline={totalSignups.sparkline}
            footer="all-time · sparkline 14d"
          />
        )}
      </GroupSection>

      {/* ─────────── CONTENT PERFORMANCE ─────────── */}
      <GroupSection label="Content performance">
        <KpiCard
          label="Posts published"
          source="helm"
          value={formatNumber(postsPublished.value)}
          delta={{
            current: postsPublished.value,
            previous: postsPublished.previous,
            period: postsPublished.period,
          }}
          sparkline={postsPublished.sparkline}
          footer="last 30 days"
        />
        <KpiCard
          label="Research findings"
          source="helm"
          value={formatNumber(researchInsights.value)}
          delta={{
            current: researchInsights.value,
            previous: researchInsights.previous,
            period: researchInsights.period,
          }}
          sparkline={researchInsights.sparkline}
          footer="all-time · sparkline 14d"
        />
      </GroupSection>

      {/* ──────────────── ENGAGEMENT ──────────────── */}
      <GroupSection label="Engagement">
        {validateResponseRate.value === 0 ? (
          <KpiCard
            label="Post engagement"
            source="helm"
            empty={{
              title: 'No engagement tracked yet',
              subtext: 'Publish a post with a clear CTA to start collecting.',
              ctaLabel: 'Generate a post →',
              ctaHref: '/marketing/generate',
            }}
          />
        ) : (
          <KpiCard
            label="Post engagement"
            source="helm"
            value={validateResponseRate.value}
            footer={`${validateResponseRate.total} total · ${validateResponseRate.activePages} pages`}
          />
        )}
      </GroupSection>

      {/* ──────────────── MONETIZATION ──────────────── */}
      <GroupSection label="Monetization">
        {cac === 0 ? (
          <KpiCard
            label="CAC"
            source="computed"
            empty={{
              title: 'CAC unavailable',
              subtext:
                'Connect Meta Ads to calculate your acquisition cost.',
              ctaLabel: 'Connect Meta Ads →',
              ctaHref: '/integrations',
            }}
          />
        ) : (
          <KpiCard
            label="CAC"
            source="computed"
            value={formatCurrency(cac)}
          />
        )}

        {spend === 0 ? (
          <KpiCard
            label="Ad spend"
            source="meta"
            empty={{
              title: 'No ad spend data',
              subtext: 'Connect Meta Ads to track campaign spend.',
              ctaLabel: 'Connect Meta Ads →',
              ctaHref: '/integrations',
            }}
          />
        ) : (
          <KpiCard
            label="Ad spend"
            source="meta"
            value={formatCurrency(spend)}
          />
        )}
      </GroupSection>

      {!hasMappings && scope === 'project' && (
        <p className="text-xs text-text-3 mt-6">
          No project mapped to Vercel/Supabase/Meta yet. Open Integrations
          to map this project so live metrics flow in.
        </p>
      )}
    </div>
  );
}

function GroupSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-accent mb-3">
        {label}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        {children}
      </div>
    </section>
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
        setResultMessage(
          `✓ Synced ${count} source${count === 1 ? '' : 's'}`,
        );
        setTimeout(() => location.reload(), 1500);
      } else {
        setResultMessage(`Error: ${data.error ?? 'unknown'}`);
      }
    } catch (e) {
      setResultMessage(
        `Error: ${e instanceof Error ? e.message : String(e)}`,
      );
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
            'glass rounded-lg p-3',
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
