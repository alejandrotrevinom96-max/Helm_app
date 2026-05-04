'use client';

import { useState } from 'react';
import type { Project, ResearchFinding } from '@/lib/db/schema';
import { timeAgo, formatRelativeDate } from '@/lib/utils';
import { GlassCard } from '@/components/ui/glass-card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SimpleMarkdown } from '@/components/ui/simple-markdown';
import { KeywordChips } from './keyword-chips';
import { CompetitorComparison } from './competitor-comparison';

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
    initialConfig.weeklyInsightAt
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

  // Pagination state — first page came from the server. We append more
  // findings via /api/research/findings as the user clicks Load more.
  const [allFindings, setAllFindings] = useState<ResearchFinding[]>(findings);
  const [hasMore, setHasMore] = useState(findings.length === 50);
  const [loadingMore, setLoadingMore] = useState(false);

  const persistConfig = async (
    patch: Partial<{
      keywords: string[];
      competitors: string[];
      excludeWords: string[];
      sources: Sources;
    }>
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
        // Auto-clear the green tick so the next save can flash it again.
        setTimeout(() => setConfigSaved(false), 2000);
      }
    } catch (e) {
      setConfigError(e instanceof Error ? e.message : String(e));
    }
  };

  // Optimistic local update + fire-and-forget persistence
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
    (f) => filter === 'all' || f.source === filter
  );

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const sourceParam = filter !== 'all' ? `&source=${filter}` : '';
      const res = await fetch(
        `/api/research/findings?projectId=${project.id}&offset=${allFindings.length}&limit=20${sourceParam}`
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
    <div className="p-4 md:p-8">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-3 mb-6 md:mb-8">
        <div>
          <h1 className="font-display text-display-md font-light tracking-tight">
            Research
          </h1>
          <p className="text-text-2 mt-2 max-w-2xl text-sm">
            Pain points and opportunities from your community
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={generateInsight}
            disabled={synthLoading}
          >
            {synthLoading ? 'Synthesizing…' : 'Generate insight'}
          </Button>
          <Button size="sm" onClick={scan} disabled={scanLoading}>
            {scanLoading ? 'Scanning…' : 'Scan now ↻'}
          </Button>
        </div>
      </div>

      {scanStatus && (
        <div className="mb-4 text-xs text-text-2">{scanStatus}</div>
      )}
      {synthError && (
        <div className="mb-4 text-xs text-danger">{synthError}</div>
      )}
      {initialConfig.lastSyncedAt && !scanLoading && (
        <div className="mb-4 text-[11px] font-mono text-text-3">
          Last scan: {formatRelativeDate(initialConfig.lastSyncedAt)}
        </div>
      )}

      {/* Configuration card (collapsible) */}
      <GlassCard className="p-5 mb-6">
        <button
          onClick={() => setConfigOpen(!configOpen)}
          className="w-full flex justify-between items-center"
        >
          <span className="font-display text-lg font-light">Configuration</span>
          <span className="text-text-3 text-lg">{configOpen ? '−' : '+'}</span>
        </button>

        {configOpen && (
          <div className="mt-4 space-y-5">
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
              <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
                Sources
              </div>
              <div className="flex flex-wrap gap-2">
                {SOURCE_KEYS.map((s) => (
                  <button
                    key={s}
                    onClick={() => updateSources({ ...sources, [s]: !sources[s] })}
                    className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
                      sources[s]
                        ? 'border-accent bg-accent-soft text-accent'
                        : 'border-border text-text-3 hover:border-border-bright'
                    }`}
                  >
                    {SOURCE_LABELS[s]}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-text-3 mt-2">
                Twitter/X, Facebook, Instagram are not supported — their APIs
                either cost $100+/mo or don&apos;t allow public-content search.
              </p>
            </div>

            {configError && (
              <div className="flex items-center gap-3 text-xs text-danger">
                <span>⚠ {configError}</span>
                <button
                  onClick={() => setConfigError(null)}
                  className="underline hover:text-text-1"
                >
                  dismiss
                </button>
              </div>
            )}
            {configSaved && !configError && (
              <div className="text-xs text-success">✓ Saved</div>
            )}
          </div>
        )}
      </GlassCard>

      {/* Synthesizing skeleton — only when there's no insight yet to show
          in place. If there's a previous one, the user keeps seeing it with
          the Regenerate button in loading state. */}
      {synthLoading && !weeklyInsight && (
        <GlassCard elevated className="p-5 md:p-6 mb-6" aria-label="Synthesizing insight">
          <Skeleton className="h-3 w-32 mb-3" />
          <Skeleton className="h-7 w-3/4 mb-4" />
          <div className="space-y-2 mb-4">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-4/6" />
          </div>
          <p className="text-xs text-text-3 italic">
            Claude Opus is synthesizing… ~30-60 seconds.
          </p>
        </GlassCard>
      )}

      {/* Insight banner */}
      {weeklyInsight && (
        <GlassCard elevated className="p-5 md:p-6 mb-6">
          <div className="flex justify-between items-start mb-3 gap-3 flex-wrap">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-accent mb-1">
                Insight of the week
              </div>
              <div className="text-xs text-text-3">
                Generated {weeklyInsightAt ? formatRelativeDate(weeklyInsightAt) : ''}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={generateInsight}
              disabled={synthLoading}
            >
              {synthLoading ? 'Regenerating…' : 'Regenerate'}
            </Button>
          </div>
          <SimpleMarkdown text={weeklyInsight} />
        </GlassCard>
      )}

      {/* Tab navigation */}
      <div className="flex gap-1 border-b border-border mb-4">
        <button
          onClick={() => setActiveTab('all')}
          className={`px-4 py-2 text-xs border-b-2 -mb-px transition-colors ${
            activeTab === 'all'
              ? 'border-accent text-accent'
              : 'border-transparent text-text-2 hover:text-text-1'
          }`}
        >
          All findings
        </button>
        <button
          onClick={() => setActiveTab('competitors')}
          className={`px-4 py-2 text-xs border-b-2 -mb-px transition-colors ${
            activeTab === 'competitors'
              ? 'border-accent text-accent'
              : 'border-transparent text-text-2 hover:text-text-1'
          }`}
        >
          Competitive landscape
          {competitors.length > 0 && (
            <span className="ml-1.5 text-[10px] text-text-3">
              ({competitors.length})
            </span>
          )}
        </button>
      </div>

      {activeTab === 'all' ? (
        <>
          {/* Source filter chips */}
          <div className="flex flex-wrap gap-2 mb-4">
            {(['all', 'reddit', 'hackernews', 'indiehackers'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`text-[10px] font-mono uppercase tracking-[0.1em] px-3 py-1.5 rounded transition-colors ${
                  filter === s
                    ? 'bg-accent-soft text-accent'
                    : 'text-text-3 hover:text-text-1'
                }`}
              >
                {s === 'all'
                  ? `All (${counts.all})`
                  : `${SOURCE_LABELS[s as keyof Sources]} (${counts[s]})`}
              </button>
            ))}
          </div>

          {visibleFindings.length === 0 && findings.length === 0 && (
            <GlassCard className="p-8 md:p-12 text-center">
              <p className="font-display text-2xl mb-2">No findings yet</p>
              <p className="text-text-2 text-sm">
                Add keywords above and click <em className="text-text-1">Scan now</em>{' '}
                to search Reddit, HN, and Indie Hackers for matching posts.
              </p>
            </GlassCard>
          )}

          {visibleFindings.length === 0 && findings.length > 0 && (
            <p className="text-text-3 text-sm">
              No findings from {filter}. Try a different filter or scan again.
            </p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
            {visibleFindings.map((f) => (
              <FindingCard key={f.id} finding={f} />
            ))}
          </div>

          {hasMore && allFindings.length > 0 && (
            <div className="flex justify-center mt-6">
              <Button variant="ghost" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : 'Load more findings'}
              </Button>
            </div>
          )}
        </>
      ) : (
        <CompetitorComparison projectId={project.id} />
      )}
    </div>
  );
}

function FindingCard({ finding }: { finding: ResearchFinding }) {
  return (
    <a
      href={finding.url}
      target="_blank"
      rel="noopener"
      className="glass rounded-2xl p-5 hover:border-border-bright transition-all hover:-translate-y-0.5 block"
    >
      <div className="flex justify-between items-center mb-3 gap-2">
        <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3">
          {finding.source}
        </span>
        <span
          className={`text-[11px] font-mono px-2 py-1 rounded-full whitespace-nowrap ${
            (finding.matchScore ?? 0) > 80
              ? 'bg-accent-soft text-accent'
              : 'bg-success-soft text-success'
          }`}
        >
          {finding.matchScore} match
        </span>
      </div>
      <h3 className="text-sm font-medium mb-2 leading-snug">{finding.title}</h3>
      {finding.snippet && (
        <p className="text-xs text-text-2 mb-3 line-clamp-2">{finding.snippet}</p>
      )}
      <div className="flex justify-between text-[11px] text-text-3 font-mono">
        <span>
          ↑ {finding.upvotes ?? 0} · 💬 {finding.comments ?? 0}
        </span>
        <span>{finding.postedAt && timeAgo(finding.postedAt)}</span>
      </div>
    </a>
  );
}
