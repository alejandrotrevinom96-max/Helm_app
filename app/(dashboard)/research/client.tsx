'use client';

// PR Sprint 7.25 Phase 4 — Research page redesign on top of the
// platform design system. AmbientBackground wraps the page; the
// page-head adopts the purple "live" eyebrow + animated gradient
// accent; action buttons use the new platform-btn classes; the
// finding cards + source-filter chips + tabs all move to platform-*
// classes. The inner complex blocks (PainPointCard, BrandAnalysisCard,
// KeywordChips, AutoConfigSection, CompetitorComparison) keep their
// own styling because they already render against the dark canvas
// — touching them would multiply the diff for no visible payoff.
// Every API integration (scan / synthesize / extract / config PATCH
// / findings pagination / insights load) is byte-identical to
// pre-Phase-4.
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import type { Project, ResearchFinding } from '@/lib/db/schema';
import { timeAgo, formatRelativeDate } from '@/lib/utils';
import { AmbientBackground } from '@/components/ui/ambient-background';
import { GlassCard } from '@/components/ui/glass-card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { SimpleMarkdown } from '@/components/ui/simple-markdown';
import { KeywordChips } from './keyword-chips';
import { CompetitorComparison } from './competitor-comparison';
import { AutoConfigSection } from './auto-config-section';
import {
  PainPointCard,
  type PainPoint,
} from '@/components/research/PainPointCard';
import { BrandAnalysisCard } from '@/components/research/BrandAnalysisCard';

type Sources = {
  reddit: boolean;
  hackernews: boolean;
  indiehackers: boolean;
  googleTrends: boolean;
};

type Filter = 'all' | 'reddit' | 'hackernews' | 'indiehackers';

const SOURCE_LABELS: Record<keyof Sources, string> = {
  reddit: 'Reddit',
  hackernews: 'Hacker News',
  indiehackers: 'Indie Hackers',
  googleTrends: 'Google Trends',
};

const SOURCE_KEYS = ['reddit', 'hackernews', 'indiehackers', 'googleTrends'] as const;

interface InitialConfig {
  keywords: string[];
  competitors: string[];
  excludeWords: string[];
  sources: Sources;
  weeklyInsight: string | null;
  weeklyInsightAt: Date | string | null;
  lastSyncedAt: Date | string | null;
}

export function ResearchClient({
  project,
  findings,
  initialConfig,
}: {
  project: Project;
  findings: ResearchFinding[];
  initialConfig: InitialConfig;
}) {
  const [keywords, setKeywords] = useState(initialConfig.keywords);
  const [competitors, setCompetitors] = useState(initialConfig.competitors);
  const [excludeWords, setExcludeWords] = useState(initialConfig.excludeWords);
  const [sources, setSources] = useState<Sources>(initialConfig.sources);
  const [weeklyInsight, setWeeklyInsight] = useState(initialConfig.weeklyInsight);
  const [weeklyInsightAt, setWeeklyInsightAt] = useState<Date | string | null>(
    initialConfig.weeklyInsightAt,
  );

  const [configOpen, setConfigOpen] = useState(initialConfig.keywords.length === 0);
  const [filter, setFilter] = useState<Filter>('all');
  const [activeTab, setActiveTab] = useState<'all' | 'competitors'>('all');

  const [scanLoading, setScanLoading] = useState(false);
  const [scanStatus, setScanStatus] = useState<string | null>(null);
  const [synthLoading, setSynthLoading] = useState(false);
  const [synthError, setSynthError] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [configSaved, setConfigSaved] = useState(false);

  const [allFindings, setAllFindings] = useState<ResearchFinding[]>(findings);
  const [hasMore, setHasMore] = useState(findings.length === 50);
  const [loadingMore, setLoadingMore] = useState(false);

  const [painPoints, setPainPoints] = useState<PainPoint[]>([]);
  const [painSummary, setPainSummary] = useState<string | null>(null);
  const [painSkippedReason, setPainSkippedReason] = useState<string | null>(
    null,
  );
  const [extractLoading, setExtractLoading] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractHint, setExtractHint] = useState<string | null>(null);

  const loadInsights = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/research/insights?projectId=${project.id}`,
        { cache: 'no-store' },
      );
      const data: {
        hasInsight?: boolean;
        insight?: {
          painPoints?: PainPoint[];
          summary?: string | null;
          skippedReason?: string | null;
        };
      } = await res.json();
      if (res.ok && data.hasInsight && data.insight) {
        setPainPoints(data.insight.painPoints ?? []);
        setPainSummary(data.insight.summary ?? null);
        setPainSkippedReason(data.insight.skippedReason ?? null);
      }
    } catch {
      // non-fatal
    }
  }, [project.id]);

  useEffect(() => {
    loadInsights();
  }, [loadInsights]);

  const extractPainPoints = async () => {
    setExtractError(null);
    setExtractHint(null);
    setExtractLoading(true);
    try {
      const res = await fetch('/api/research/extract-pain-points', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id }),
      });
      const data: {
        success?: boolean;
        painPoints?: PainPoint[];
        summary?: string | null;
        skippedReason?: string | null;
        hint?: string;
        error?: string;
        sourcesNeeded?: boolean;
      } = await res.json();
      if (!res.ok) {
        setExtractError(data.error ?? 'Extraction failed');
        return;
      }
      setPainPoints(data.painPoints ?? []);
      setPainSummary(data.summary ?? null);
      setPainSkippedReason(data.skippedReason ?? null);
      if (data.hint) setExtractHint(data.hint);
    } catch (e) {
      setExtractError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setExtractLoading(false);
    }
  };

  const persistConfig = async (
    patch: Partial<{
      keywords: string[];
      competitors: string[];
      excludeWords: string[];
      sources: Sources;
    }>,
  ) => {
    setConfigError(null);
    try {
      const res = await fetch('/api/research/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, ...patch }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setConfigError(data.error ?? `Save failed (${res.status})`);
      } else {
        setConfigSaved(true);
        setTimeout(() => setConfigSaved(false), 2000);
      }
    } catch (e) {
      setConfigError(e instanceof Error ? e.message : String(e));
    }
  };

  const updateKeywords = (next: string[]) => {
    setKeywords(next);
    persistConfig({ keywords: next });
  };
  const updateCompetitors = (next: string[]) => {
    setCompetitors(next);
    persistConfig({ competitors: next });
  };
  const updateExcludeWords = (next: string[]) => {
    setExcludeWords(next);
    persistConfig({ excludeWords: next });
  };
  const updateSources = (next: Sources) => {
    setSources(next);
    persistConfig({ sources: next });
  };

  const scan = async () => {
    setScanLoading(true);
    setScanStatus(null);
    try {
      const res = await fetch('/api/research/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id }),
      });
      const data = await res.json();
      if (res.ok) {
        setScanStatus(`✓ Scanned ${data.scanned}, inserted ${data.inserted}`);
        setTimeout(() => location.reload(), 1500);
      } else {
        setScanStatus(`Error: ${data.hint || data.error || 'failed'}`);
      }
    } catch (e) {
      setScanStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setScanLoading(false);
    }
  };

  const generateInsight = async () => {
    setSynthLoading(true);
    setSynthError(null);
    try {
      const res = await fetch('/api/research/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id }),
      });
      const data = await res.json();
      if (res.ok && data.insight) {
        setWeeklyInsight(data.insight);
        setWeeklyInsightAt(new Date());
      } else {
        setSynthError(data.hint || data.error || 'Synthesize failed');
      }
    } catch (e) {
      setSynthError(e instanceof Error ? e.message : String(e));
    } finally {
      setSynthLoading(false);
    }
  };

  const counts: Record<Filter, number> = {
    all: allFindings.length,
    reddit: allFindings.filter((f) => f.source === 'reddit').length,
    hackernews: allFindings.filter((f) => f.source === 'hackernews').length,
    indiehackers: allFindings.filter((f) => f.source === 'indiehackers').length,
  };

  const visibleFindings = allFindings.filter(
    (f) => filter === 'all' || f.source === filter,
  );

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const sourceParam = filter !== 'all' ? `&source=${filter}` : '';
      const res = await fetch(
        `/api/research/findings?projectId=${project.id}&offset=${allFindings.length}&limit=20${sourceParam}`,
      );
      const data = await res.json();
      if (res.ok && Array.isArray(data.findings)) {
        setAllFindings((prev) => [...prev, ...data.findings]);
        setHasMore(!!data.hasMore);
      } else {
        setHasMore(false);
      }
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <AmbientBackground accentTint="purple">
      <main className="platform-main platform-main-wide">
        <header className="platform-page-head platform-page-head-row platform-reveal-1">
          <div>
            <span className="platform-eyebrow platform-eyebrow-purple">
              live · audience signals
            </span>
            <h1>
              Research<span className="accent-purple-grad">.</span>
            </h1>
            <p className="sub">
              Pain points and opportunities from your community — extracted
              from Reddit, HN, and Indie Hackers conversations.
            </p>
            {initialConfig.lastSyncedAt && !scanLoading && (
              <div className="platform-last-scan">
                Last scan{' '}
                <b>{formatRelativeDate(initialConfig.lastSyncedAt)}</b>
              </div>
            )}
          </div>

          <div className="platform-page-head-actions">
            <Link
              href="/research/sources"
              className="platform-btn platform-btn-ghost"
            >
              Sources →
            </Link>
            <button
              type="button"
              onClick={generateInsight}
              disabled={synthLoading}
              className="platform-btn platform-btn-ghost"
            >
              {synthLoading ? 'Synthesizing…' : 'Generate insight'}
            </button>
            <button
              type="button"
              onClick={scan}
              disabled={scanLoading}
              className="platform-btn platform-btn-primary"
            >
              {scanLoading ? 'Scanning…' : 'Scan now ↻'}
            </button>
          </div>
        </header>

        {scanStatus && (
          <div
            className="platform-field-help"
            style={{ marginBottom: '14px' }}
          >
            {scanStatus}
          </div>
        )}
        {synthError && (
          <div
            className="platform-field-help"
            style={{ color: 'var(--d-red-2)', marginBottom: '14px' }}
          >
            {synthError}
          </div>
        )}

        {/* Pain points this week */}
        <section className="platform-reveal-2" style={{ marginBottom: '28px' }}>
          <div className="platform-section-row">
            <h2 className="platform-section-title">
              Pain points{' '}
              <span className="accent-blue-purple">this week</span>
            </h2>
            <button
              onClick={extractPainPoints}
              disabled={extractLoading}
              className="platform-extract-pill"
            >
              {extractLoading ? 'Extracting…' : '↻ Extract now'}
            </button>
          </div>
          {extractError && (
            <div
              className="platform-field-help"
              style={{
                color: 'var(--d-red-2)',
                padding: '10px 12px',
                background: 'rgba(239,68,68,0.06)',
                border: '1px solid rgba(239,68,68,0.22)',
                borderRadius: '10px',
                marginBottom: '12px',
              }}
            >
              {extractError}
            </div>
          )}
          {extractHint && painPoints.length === 0 && (
            <div
              className="platform-field-help"
              style={{ marginBottom: '12px' }}
            >
              {extractHint}
            </div>
          )}
          {painSummary && painPoints.length > 0 && (
            <p
              className="platform-desc"
              style={{ marginBottom: '14px', maxWidth: '60ch' }}
            >
              {painSummary}
            </p>
          )}
          {painPoints.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {painPoints.map((p, i) => (
                <PainPointCard
                  key={`${p.theme}-${i}`}
                  painPoint={p}
                  projectId={project.id}
                />
              ))}
            </div>
          ) : (
            <div
              className="platform-card platform-card-glow-purple"
              style={{ textAlign: 'center', marginBottom: 0 }}
            >
              <p className="platform-desc">
                {painSkippedReason ??
                  'No pain points yet. Connect sources in /research/sources first, run a scan, then hit Extract.'}
              </p>
            </div>
          )}
        </section>

        {/* Brand analysis card stays as-is — has its own purple/blue
            glass styling that already matches the platform palette. */}
        <section
          className="platform-reveal-3"
          style={{ marginBottom: '28px' }}
        >
          <BrandAnalysisCard projectId={project.id} />
        </section>

        {/* Configuration card (collapsible) — wrapped in platform-card
            for the new look; inner inputs keep their existing forms. */}
        <section
          className="platform-card platform-card-glow-blue platform-reveal-4"
        >
          <button
            type="button"
            onClick={() => setConfigOpen(!configOpen)}
            style={{
              width: '100%',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'transparent',
              border: 0,
              padding: 0,
              cursor: 'pointer',
              color: 'inherit',
            }}
          >
            <span className="platform-h2" style={{ margin: 0 }}>
              Configuration
            </span>
            <span style={{ color: 'var(--text-3)', fontSize: '20px' }}>
              {configOpen ? '−' : '+'}
            </span>
          </button>

          {configOpen && (
            <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '22px' }}>
              <AutoConfigSection
                projectId={project.id}
                onApplied={() => window.location.reload()}
              />

              <KeywordChips
                label="Keywords"
                values={keywords}
                onAdd={(v) => updateKeywords([...keywords, v])}
                onRemove={(v) => updateKeywords(keywords.filter((k) => k !== v))}
                placeholder="e.g. indie hacker, micro-saas"
              />
              <KeywordChips
                label="Competitors"
                values={competitors}
                onAdd={(v) => updateCompetitors([...competitors, v])}
                onRemove={(v) =>
                  updateCompetitors(competitors.filter((k) => k !== v))
                }
                placeholder="e.g. posthog, baremetrics"
              />
              <KeywordChips
                label="Exclude words"
                values={excludeWords}
                accent="danger"
                onAdd={(v) => updateExcludeWords([...excludeWords, v])}
                onRemove={(v) =>
                  updateExcludeWords(excludeWords.filter((k) => k !== v))
                }
                placeholder="words to filter out"
              />

              <div>
                <div className="platform-field-label">Sources</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {SOURCE_KEYS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() =>
                        updateSources({ ...sources, [s]: !sources[s] })
                      }
                      className={`platform-source-chip${
                        sources[s] ? ' platform-source-chip-on' : ''
                      }`}
                    >
                      {SOURCE_LABELS[s]}
                    </button>
                  ))}
                </div>
                <p className="platform-field-help" style={{ marginTop: '8px' }}>
                  Twitter/X, Facebook, Instagram are not supported — their
                  APIs either cost $100+/mo or don&apos;t allow public-content
                  search.
                </p>
              </div>

              {configError && (
                <div className="platform-field-help" style={{ color: 'var(--d-red-2)' }}>
                  ⚠ {configError}{' '}
                  <button
                    type="button"
                    onClick={() => setConfigError(null)}
                    style={{
                      background: 'transparent',
                      border: 0,
                      cursor: 'pointer',
                      color: 'inherit',
                      textDecoration: 'underline',
                    }}
                  >
                    dismiss
                  </button>
                </div>
              )}
              {configSaved && !configError && (
                <div
                  className="platform-field-help"
                  style={{ color: 'var(--d-green-2)' }}
                >
                  ✓ Saved
                </div>
              )}
            </div>
          )}
        </section>

        {/* Synthesizing skeleton */}
        {synthLoading && !weeklyInsight && (
          <GlassCard
            elevated
            className="p-5 md:p-6 mb-6 mt-6"
            aria-label="Synthesizing insight"
          >
            <Skeleton className="h-3 w-32 mb-3" />
            <Skeleton className="h-7 w-3/4 mb-4" />
            <div className="space-y-2 mb-4">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
              <Skeleton className="h-3 w-4/6" />
            </div>
            <p className="text-xs text-text-3 italic">
              Helm is synthesizing… ~30-60 seconds.
            </p>
          </GlassCard>
        )}

        {/* Insight banner */}
        {weeklyInsight && (
          <section
            className="platform-card platform-card-glow-orange platform-reveal-5"
            style={{ marginTop: '24px' }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: '12px',
                gap: '12px',
                flexWrap: 'wrap',
              }}
            >
              <div>
                <div className="platform-lbl" style={{ color: 'var(--d-orange-2)' }}>
                  Insight of the week
                </div>
                <div className="platform-field-help">
                  Generated{' '}
                  {weeklyInsightAt ? formatRelativeDate(weeklyInsightAt) : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={generateInsight}
                disabled={synthLoading}
                className="platform-btn platform-btn-ghost"
              >
                {synthLoading ? 'Regenerating…' : 'Regenerate'}
              </button>
            </div>
            <SimpleMarkdown text={weeklyInsight} />
          </section>
        )}

        {/* Tab navigation */}
        <div className="platform-tab-row" style={{ marginTop: '32px' }}>
          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={`platform-tab${
              activeTab === 'all' ? ' platform-tab-on' : ''
            }`}
          >
            All findings
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('competitors')}
            className={`platform-tab${
              activeTab === 'competitors' ? ' platform-tab-on' : ''
            }`}
          >
            Competitive landscape
            {competitors.length > 0 && (
              <span className="platform-tab-count">
                ({competitors.length})
              </span>
            )}
          </button>
        </div>

        {activeTab === 'all' ? (
          <>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '8px',
                marginBottom: '16px',
              }}
            >
              {(['all', 'reddit', 'hackernews', 'indiehackers'] as const).map(
                (s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setFilter(s)}
                    className={`platform-source-chip${
                      filter === s ? ' platform-source-chip-on' : ''
                    }`}
                  >
                    {s === 'all'
                      ? `All (${counts.all})`
                      : `${SOURCE_LABELS[s as keyof Sources]} (${counts[s]})`}
                  </button>
                ),
              )}
            </div>

            {visibleFindings.length === 0 && findings.length === 0 && (
              <GlassCard className="p-0">
                <EmptyState
                  title="No findings yet"
                  description="Add keywords above and click Scan now to search Reddit, HN, and Indie Hackers for posts that match your project."
                  icon={
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                  }
                />
              </GlassCard>
            )}

            {visibleFindings.length === 0 && findings.length > 0 && (
              <EmptyState
                compact
                title={`No findings from ${filter}`}
                description="Try a different source filter or run another scan."
              />
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
              {visibleFindings.map((f) => (
                <FindingCard key={f.id} finding={f} />
              ))}
            </div>

            {hasMore && allFindings.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  marginTop: '24px',
                }}
              >
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="platform-btn platform-btn-ghost"
                >
                  {loadingMore ? 'Loading…' : 'Load more findings'}
                </button>
              </div>
            )}
          </>
        ) : (
          <CompetitorComparison projectId={project.id} />
        )}
      </main>
    </AmbientBackground>
  );
}

function FindingCard({ finding }: { finding: ResearchFinding }) {
  const score = finding.matchScore ?? 0;
  const isHot = score > 80;
  return (
    <a
      href={finding.url}
      target="_blank"
      rel="noopener"
      className="platform-finding-card"
    >
      <div className="platform-finding-card-head">
        <span className="platform-finding-card-source">{finding.source}</span>
        <span
          className={`platform-finding-card-score ${
            isHot
              ? 'platform-finding-card-score-hot'
              : 'platform-finding-card-score-warm'
          }`}
        >
          {finding.matchScore} match
        </span>
      </div>
      <h3 className="platform-finding-card-title">{finding.title}</h3>
      {finding.snippet && (
        <p className="platform-finding-card-snippet">{finding.snippet}</p>
      )}
      <div className="platform-finding-card-meta">
        <span>
          ↑ {finding.upvotes ?? 0} · 💬 {finding.comments ?? 0}
        </span>
        <span>{finding.postedAt && timeAgo(finding.postedAt)}</span>
      </div>
    </a>
  );
}
