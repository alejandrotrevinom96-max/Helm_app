'use client';

// PR #83 — Sprint 7.8: regrouped analytics surface.
//
// 4 semantic groups: GROWTH / CONTENT PERFORMANCE / ENGAGEMENT /
// MONETIZATION. Each widget uses the unified KpiCard (which knows
// how to render value + delta + sparkline OR empty-state body).
//
// PR Sprint 7.25 Phase 3 — repainted on top of the platform redesign
// (color-dotted section heads, mono sources row, glowing metric
// cards). Sync logic + scope handling + aggregation math are
// unchanged; only the visual layer moved.
import { useState } from 'react';
import type { Project, MetricSnapshot } from '@/lib/db/schema';
import { formatNumber, formatCurrency, timeAgo } from '@/lib/utils';
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
  totalSignups: KpiBlock;
  postsPublished: KpiBlock;
  researchInsights: KpiBlock;
  validateResponseRate: ResponseRate;
}

export function AnalyticsClient({
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

  const LEGACY_SUPABASE_METRICS = new Set(['signups']);
  const supabaseMetricsSet = new Set<string>();
  for (const s of snapshots) {
    if (s.source !== 'supabase') continue;
    if (LEGACY_SUPABASE_METRICS.has(s.metric)) continue;
    supabaseMetricsSet.add(s.metric);
  }
  const supabaseMetrics = Array.from(supabaseMetricsSet).sort();

  const signups = supabaseMetrics.reduce((sum, m) => sum + aggregate(m), 0);
  const cac = signups > 0 ? spend / signups : 0;

  const labelForMetric = (metric: string): string => {
    if (metric === 'auth.users') return 'Auth users';
    return metric.charAt(0).toUpperCase() + metric.slice(1);
  };

  const sources: string[] = [];
  if (hasVercel) sources.push('Vercel');
  if (hasSupabase) sources.push('Supabase');
  if (hasMeta) sources.push('Meta Ads');

  return (
    <div>
      {/* Sources row */}
      <div className="platform-sources-row platform-reveal-2">
        <div className="platform-sources-list">
          <span>Sources</span>
          {sources.length === 0 ? (
            <span style={{ color: 'var(--text-3)' }}>none connected</span>
          ) : (
            sources.map((s) => (
              <span key={s} className="platform-sources-pair">
                <span className="dot" />
                {s}
              </span>
            ))
          )}
          <span style={{ color: 'var(--text-3)' }}>
            ·{' '}
            {lastSyncAt
              ? `last synced ${timeAgo(lastSyncAt)} ago`
              : 'never synced'}
          </span>
        </div>
        <div className="platform-sources-actions">
          <SyncButton />
          <a href="/integrations" className="platform-manage-link">
            Manage →
          </a>
        </div>
      </div>

      <ConnectSourceBanner hasMeta={hasMeta} hasReddit={hasReddit} />

      {/* ──────────────── GROWTH ──────────────── */}
      <section className="platform-section platform-reveal-3">
        <div className="platform-section-head platform-section-growth">
          <span className="dot" />
          <span>Growth</span>
        </div>
        <div className="platform-metrics-grid">
          {supabaseMetrics.length === 0 ? (
            <KpiCard
              label="Users"
              source="supabase"
              empty={{
                title: 'No users tracked yet',
                subtext:
                  'Map a Supabase table in Integrations to surface signups.',
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
        </div>
      </section>

      {/* ─────────── CONTENT PERFORMANCE ─────────── */}
      <section className="platform-section platform-reveal-4">
        <div className="platform-section-head platform-section-content">
          <span className="dot" />
          <span>Content performance</span>
        </div>
        <div className="platform-metrics-grid platform-metrics-grid-2">
          <KpiCard
            label="Posts published"
            source="helm"
            glow="blue"
            value={formatNumber(postsPublished.value)}
            delta={{
              current: postsPublished.value,
              previous: postsPublished.previous,
              period: postsPublished.period,
            }}
            sparkline={postsPublished.sparkline}
            footer={
              <>
                last <b>30 days</b>
              </>
            }
          />
          <KpiCard
            label="Research findings"
            source="helm"
            glow="orange"
            value={formatNumber(researchInsights.value)}
            delta={{
              current: researchInsights.value,
              previous: researchInsights.previous,
              period: researchInsights.period,
            }}
            sparkline={researchInsights.sparkline}
            footer={
              <>
                all-time · sparkline <b>14d</b>
              </>
            }
          />
        </div>
      </section>

      {/* ──────────────── ENGAGEMENT ──────────────── */}
      <section className="platform-section platform-reveal-5">
        <div className="platform-section-head platform-section-engagement">
          <span className="dot" />
          <span>Engagement</span>
        </div>
        <div className="platform-metrics-grid">
          {validateResponseRate.value === 0 ? (
            <KpiCard
              label="Post engagement"
              source="helm"
              glow="orange"
              empty={{
                title: 'No engagement tracked yet',
                subtext:
                  'Publish a post with a clear CTA to start collecting.',
                ctaLabel: 'Generate a post →',
                ctaHref: '/marketing/generate',
              }}
            />
          ) : (
            <KpiCard
              label="Post engagement"
              source="helm"
              glow="orange"
              value={validateResponseRate.value}
              footer={`${validateResponseRate.total} total · ${validateResponseRate.activePages} pages`}
            />
          )}
        </div>
      </section>

      {/* ──────────────── MONETIZATION ──────────────── */}
      <section className="platform-section platform-reveal-6">
        <div className="platform-section-head platform-section-monetization">
          <span className="dot" />
          <span>Monetization</span>
        </div>
        <div className="platform-metrics-grid platform-metrics-grid-2">
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
        </div>

        {!hasMappings && scope === 'project' && (
          <p className="platform-footer-note">
            No project mapped to <b>Vercel</b> / <b>Supabase</b> /{' '}
            <b>Meta</b> yet. Open <a href="/integrations">Integrations</a>{' '}
            to map this project so live metrics flow in.
          </p>
        )}
      </section>
    </div>
  );
}

function SyncButton() {
  const [loading, setLoading] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [result, setResult] = useState<SyncResultData | null>(null);

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
    <div style={{ display: 'inline-flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-end' }}>
      <button
        type="button"
        onClick={sync}
        disabled={loading}
        className={`platform-sync-btn${loading ? ' platform-sync-btn-spinning' : ''}`}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M3 12a9 9 0 0 1 14.85-6.85L21 8M21 3v5h-5M21 12a9 9 0 0 1-14.85 6.85L3 16M3 21v-5h5" />
        </svg>
        {loading ? 'Syncing…' : 'Sync now'}
      </button>
      {resultMessage && (
        <span className="platform-field-help">{resultMessage}</span>
      )}
      {errorCount > 0 && (
        <button
          type="button"
          onClick={() => setShowDetails(!showDetails)}
          className="platform-field-help"
          style={{
            background: 'transparent',
            border: 0,
            cursor: 'pointer',
            textDecoration: 'underline',
            padding: 0,
          }}
        >
          {errorCount} warning{errorCount === 1 ? '' : 's'}{' '}
          {showDetails ? '(hide)' : '(show)'}
        </button>
      )}
      {showDetails && result && result.errors.length > 0 && (
        <ul
          className="platform-footer-note"
          style={{
            margin: 0,
            padding: '10px 12px',
            maxWidth: '320px',
            textAlign: 'left',
            listStyle: 'none',
          }}
        >
          {result.errors.map((e, i) => (
            <li key={i} style={{ wordBreak: 'break-word' }}>
              • {e}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
