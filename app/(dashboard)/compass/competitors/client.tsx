'use client';

// PR #67 — Sprint 7.1A: Compass / Positioning Benchmark client.
//
// Three vertical phases that mirror the backend flow:
//   1. Detect — Opus suggests 8-15 competitors with C-3 confidence
//      scoring. Auto-approve 85+, surface 60-84 for review.
//   2. Approve + Scrape — founder confirms suggested rows, hits
//      Scrape to extract each homepage's positioning. Batches of 5.
//   3. Generate benchmark — once we have ≥3 scraped competitors,
//      Opus synthesizes market gap + opportunities + comparison
//      matrix. 14-day cache.
//
// The page server-hydrates an initial list + last benchmark so the
// founder never sees a flash of empty state when revisiting.
import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { GlassCard } from '@/components/ui/glass-card';
import { Button } from '@/components/ui/button';
import { CompassSubNav } from '@/components/compass/sub-nav';

interface CompetitorRow {
  id: string;
  name: string;
  url: string;
  type: string | null;
  confidenceScore: number | null;
  approvedByUser: boolean;
  scrapeStatus: string | null;
  scrapeError: string | null;
  positioningSummary: string | null;
  headline: string | null;
  valueProp: string | null;
  contentAngles: string[] | null;
  detectedBy: string | null;
}

interface DimScore {
  us?: number;
  competitorsAvg?: number;
  reasoning?: string;
}

interface Opportunity {
  opportunity?: string;
  rationale?: string;
  effort?: 'low' | 'medium' | 'high' | string;
  expectedImpact?: string;
}

interface DefensiveWeakness {
  area?: string;
  whoWins?: string;
  whyTheyWin?: string;
  ourMove?: string;
}

interface BenchmarkPayload {
  id: string;
  marketGap: string | null;
  uniquePositioning: string | null;
  opportunities: unknown;
  defensiveWeaknesses: unknown;
  comparisonDimensions: unknown;
  competitorsAnalyzed: number | null;
  expiresAt: string | null;
  createdAt: string;
}

interface Props {
  project: { id: string; name: string };
  initialCompetitors: CompetitorRow[];
  initialBenchmark: BenchmarkPayload | null;
  hasBrandAnalysis: boolean;
}

const AUTO_THRESHOLD = 85;
const SUGGEST_THRESHOLD = 60;

function typeTint(t: string | null): string {
  switch (t) {
    case 'direct':
      return 'bg-danger/15 text-danger';
    case 'adjacent':
      return 'bg-amber-500/15 text-amber-500';
    case 'inspirational':
      return 'bg-accent/15 text-accent';
    default:
      return 'bg-text-3/15 text-text-2';
  }
}

function effortTint(e: string | undefined): string {
  if (e === 'low') return 'bg-emerald-500/15 text-emerald-500';
  if (e === 'medium') return 'bg-amber-500/15 text-amber-500';
  if (e === 'high') return 'bg-danger/15 text-danger';
  return 'bg-text-3/15 text-text-3';
}

export function CompetitorsClient({
  project,
  initialCompetitors,
  initialBenchmark,
  hasBrandAnalysis,
}: Props) {
  const [list, setList] = useState<CompetitorRow[]>(initialCompetitors);
  const [benchmark, setBenchmark] = useState<BenchmarkPayload | null>(
    initialBenchmark,
  );
  const [busy, setBusy] = useState<
    'idle' | 'detecting' | 'scraping' | 'generating'
  >('idle');
  const [feedback, setFeedback] = useState<{
    kind: 'success' | 'error' | 'info';
    msg: string;
  } | null>(null);
  const [manualName, setManualName] = useState('');
  const [manualUrl, setManualUrl] = useState('');
  const [addingManual, setAddingManual] = useState(false);

  const refreshList = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/compass/competitors?projectId=${project.id}`,
        { cache: 'no-store' },
      );
      const data = (await res.json()) as { competitors?: CompetitorRow[] };
      if (data.competitors) setList(data.competitors);
    } catch {
      /* non-fatal */
    }
  }, [project.id]);

  const handleDetect = async () => {
    if (busy !== 'idle') return;
    setBusy('detecting');
    setFeedback(null);
    try {
      const res = await fetch('/api/compass/detect-competitors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        detected?: number;
        autoApproved?: number;
        suggested?: number;
        error?: string;
        hint?: string;
      };
      if (!res.ok || !data.success) {
        setFeedback({
          kind: 'error',
          msg: data.error ?? data.hint ?? 'Detection failed',
        });
        return;
      }
      setFeedback({
        kind: 'success',
        msg: `Detected ${data.detected}: ${data.autoApproved} auto-approved (≥85) · ${data.suggested} suggested (60-84).`,
      });
      await refreshList();
    } catch (e) {
      setFeedback({
        kind: 'error',
        msg: e instanceof Error ? e.message : 'Network error',
      });
    } finally {
      setBusy('idle');
    }
  };

  const handleApprove = async (id: string, approved: boolean) => {
    // Optimistic flip.
    setList((prev) =>
      prev.map((c) => (c.id === id ? { ...c, approvedByUser: approved } : c)),
    );
    try {
      await fetch(`/api/compass/competitors/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved }),
      });
    } catch {
      // Re-sync from server if we drift.
      await refreshList();
    }
  };

  const handleAddManual = async () => {
    if (!manualName.trim() || !manualUrl.trim() || addingManual) return;
    setAddingManual(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/compass/competitors/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          name: manualName.trim(),
          url: manualUrl.trim(),
        }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        setFeedback({ kind: 'error', msg: data.error ?? 'Add failed' });
        return;
      }
      setManualName('');
      setManualUrl('');
      setFeedback({ kind: 'success', msg: 'Added.' });
      await refreshList();
    } catch (e) {
      setFeedback({
        kind: 'error',
        msg: e instanceof Error ? e.message : 'Network error',
      });
    } finally {
      setAddingManual(false);
    }
  };

  const handleScrape = async () => {
    if (busy !== 'idle') return;
    setBusy('scraping');
    setFeedback(null);
    try {
      const res = await fetch('/api/compass/competitors/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        scraped?: number;
        failed?: number;
        attempted?: number;
        remaining?: number;
        hint?: string;
        error?: string;
      };
      if (!res.ok || !data.success) {
        setFeedback({
          kind: 'error',
          msg: data.error ?? 'Scrape failed',
        });
        return;
      }
      const tail = data.remaining ? ` · ${data.remaining} remaining (re-run)` : '';
      setFeedback({
        kind: data.scraped ? 'success' : 'info',
        msg: `Scraped ${data.scraped ?? 0} · failed ${data.failed ?? 0}${tail}`,
      });
      await refreshList();
    } catch (e) {
      setFeedback({
        kind: 'error',
        msg: e instanceof Error ? e.message : 'Network error',
      });
    } finally {
      setBusy('idle');
    }
  };

  const handleGenerate = async (force = false) => {
    if (busy !== 'idle') return;
    setBusy('generating');
    setFeedback(null);
    try {
      const res = await fetch('/api/compass/generate-benchmark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, force }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        cached?: boolean;
        benchmark?: BenchmarkPayload | null;
        competitorsAnalyzed?: number;
        error?: string;
        hint?: string;
      };
      if (!res.ok || !data.success) {
        setFeedback({
          kind: 'error',
          msg: data.error ?? data.hint ?? 'Benchmark failed',
        });
        return;
      }
      if (data.benchmark) {
        setBenchmark({
          id: data.benchmark.id,
          marketGap: data.benchmark.marketGap,
          uniquePositioning: data.benchmark.uniquePositioning,
          opportunities:
            (data.benchmark as { opportunitiesAccionable?: unknown })
              .opportunitiesAccionable ??
            (data.benchmark as { opportunities?: unknown }).opportunities ??
            [],
          defensiveWeaknesses: data.benchmark.defensiveWeaknesses,
          comparisonDimensions: data.benchmark.comparisonDimensions,
          competitorsAnalyzed: data.benchmark.competitorsAnalyzed,
          expiresAt:
            typeof data.benchmark.expiresAt === 'string'
              ? data.benchmark.expiresAt
              : null,
          createdAt:
            typeof data.benchmark.createdAt === 'string'
              ? data.benchmark.createdAt
              : new Date().toISOString(),
        });
      }
      setFeedback({
        kind: data.cached ? 'info' : 'success',
        msg: data.cached
          ? 'Loaded cached benchmark (still fresh).'
          : `Benchmark generated from ${data.competitorsAnalyzed ?? '?'} competitors.`,
      });
    } catch (e) {
      setFeedback({
        kind: 'error',
        msg: e instanceof Error ? e.message : 'Network error',
      });
    } finally {
      setBusy('idle');
    }
  };

  // Buckets for rendering.
  const autoApproved = useMemo(
    () =>
      list.filter(
        (c) =>
          c.approvedByUser &&
          (c.confidenceScore ?? 0) >= AUTO_THRESHOLD &&
          c.detectedBy === 'ai',
      ),
    [list],
  );
  const suggested = useMemo(
    () =>
      list.filter(
        (c) =>
          !c.approvedByUser &&
          (c.confidenceScore ?? 0) >= SUGGEST_THRESHOLD &&
          (c.confidenceScore ?? 0) < AUTO_THRESHOLD,
      ),
    [list],
  );
  const manualOnes = useMemo(
    () => list.filter((c) => c.detectedBy === 'user'),
    [list],
  );
  const approvedPending = useMemo(
    () =>
      list.filter(
        (c) => c.approvedByUser && c.scrapeStatus !== 'success',
      ).length,
    [list],
  );
  const scrapedCount = useMemo(
    () => list.filter((c) => c.scrapeStatus === 'success').length,
    [list],
  );

  return (
    <div className="p-4 md:p-8 space-y-8 max-w-5xl mx-auto">
      <header className="space-y-2">
        <CompassSubNav active="competitors" />
        <h1 className="font-display text-display-md font-light tracking-tight">
          Positioning Benchmark
        </h1>
        <p className="text-text-2 text-sm max-w-2xl">
          Real competitors — AI-detected with confidence scoring, scraped for
          public positioning, synthesized into a market-gap map.
        </p>
      </header>

      {!hasBrandAnalysis && (
        <GlassCard className="p-5 border border-amber-500/30 bg-amber-500/5">
          <h3 className="font-display text-lg font-light mb-1">
            Brand analysis required
          </h3>
          <p className="text-sm text-text-3 mb-3">
            Detection seeds from your brand's niche + audience layers. Run
            Smart Auto-configure first.
          </p>
          <Link href="/research">
            <Button size="sm">Open Research →</Button>
          </Link>
        </GlassCard>
      )}

      <section className="flex flex-wrap items-center gap-2">
        <Button
          onClick={handleDetect}
          disabled={busy !== 'idle' || !hasBrandAnalysis}
        >
          {busy === 'detecting' ? 'Detecting…' : '🧭 Detect competitors'}
        </Button>
        <Button
          variant="secondary"
          onClick={handleScrape}
          disabled={busy !== 'idle' || approvedPending === 0}
        >
          {busy === 'scraping'
            ? 'Scraping…'
            : `🔍 Scrape approved (${approvedPending})`}
        </Button>
        <Button
          variant="secondary"
          onClick={() => handleGenerate(false)}
          disabled={busy !== 'idle' || scrapedCount < 3}
          title={
            scrapedCount < 3
              ? `Need ≥3 scraped competitors (have ${scrapedCount})`
              : undefined
          }
        >
          {busy === 'generating' ? 'Generating…' : '⚡ Generate benchmark'}
        </Button>
        {benchmark && (
          <button
            type="button"
            onClick={() => handleGenerate(true)}
            disabled={busy !== 'idle' || scrapedCount < 3}
            className="text-xs font-mono text-text-3 hover:text-text-1 disabled:opacity-50"
          >
            ↻ Force regenerate
          </button>
        )}
      </section>

      {feedback && (
        <div
          className={`text-xs ${
            feedback.kind === 'error'
              ? 'text-danger'
              : feedback.kind === 'success'
                ? 'text-emerald-500'
                : 'text-text-2'
          }`}
        >
          {feedback.msg}
        </div>
      )}

      {/* Manual-add row */}
      <GlassCard className="p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-display text-base font-light">Add manually</h3>
          <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3">
            user-added rows auto-approved
          </span>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            placeholder="Brand name"
            value={manualName}
            onChange={(e) => setManualName(e.target.value)}
            className="px-3 py-2 bg-bg border border-border rounded-lg text-sm placeholder:text-text-3 focus:outline-none focus:border-border-bright sm:max-w-xs"
            disabled={addingManual}
          />
          <input
            type="url"
            placeholder="https://competitor.com"
            value={manualUrl}
            onChange={(e) => setManualUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddManual();
              }
            }}
            className="flex-1 px-3 py-2 bg-bg border border-border rounded-lg text-sm placeholder:text-text-3 focus:outline-none focus:border-border-bright"
            disabled={addingManual}
          />
          <Button
            size="sm"
            onClick={handleAddManual}
            disabled={addingManual || !manualName.trim() || !manualUrl.trim()}
          >
            {addingManual ? 'Adding…' : 'Add'}
          </Button>
        </div>
      </GlassCard>

      {/* Sections */}
      {autoApproved.length > 0 && (
        <Section
          title={`Auto-approved (${autoApproved.length})`}
          subtitle="Confidence ≥85"
        >
          {autoApproved.map((c) => (
            <CompetitorRowCard
              key={c.id}
              competitor={c}
              onApprove={handleApprove}
            />
          ))}
        </Section>
      )}

      {suggested.length > 0 && (
        <Section
          title={`Suggested for approval (${suggested.length})`}
          subtitle="Confidence 60-84 — your call"
        >
          {suggested.map((c) => (
            <CompetitorRowCard
              key={c.id}
              competitor={c}
              onApprove={handleApprove}
              showApproveCta
            />
          ))}
        </Section>
      )}

      {manualOnes.length > 0 && (
        <Section
          title={`Manually added (${manualOnes.length})`}
          subtitle="Your picks"
        >
          {manualOnes.map((c) => (
            <CompetitorRowCard
              key={c.id}
              competitor={c}
              onApprove={handleApprove}
            />
          ))}
        </Section>
      )}

      {benchmark && <BenchmarkBlock benchmark={benchmark} />}
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-xl font-light">{title}</h2>
        {subtitle && (
          <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3">
            {subtitle}
          </span>
        )}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function CompetitorRowCard({
  competitor,
  onApprove,
  showApproveCta,
}: {
  competitor: CompetitorRow;
  onApprove: (id: string, approved: boolean) => void;
  showApproveCta?: boolean;
}) {
  return (
    <GlassCard className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center flex-wrap gap-2 mb-1">
            <span className="font-medium text-text-1">{competitor.name}</span>
            <span
              className={`text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-0.5 rounded ${typeTint(competitor.type)}`}
            >
              {competitor.type ?? 'unknown'}
            </span>
            <span className="text-[10px] font-mono text-text-3">
              {competitor.confidenceScore ?? '?'}%
            </span>
            {competitor.scrapeStatus === 'success' && (
              <span className="text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-500">
                scraped
              </span>
            )}
            {competitor.scrapeStatus === 'failed' && (
              <span
                className="text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-0.5 rounded bg-danger/15 text-danger"
                title={competitor.scrapeError ?? undefined}
              >
                scrape failed
              </span>
            )}
          </div>
          <a
            href={competitor.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-mono text-text-3 hover:text-text-1 transition-colors break-all"
          >
            {competitor.url} ↗
          </a>
          {competitor.positioningSummary && (
            <p className="text-xs text-text-3 mt-1">
              {competitor.positioningSummary}
            </p>
          )}
          {competitor.headline && (
            <p className="text-sm italic text-text-1 mt-2">
              &ldquo;{competitor.headline}&rdquo;
            </p>
          )}
          {competitor.contentAngles && competitor.contentAngles.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {competitor.contentAngles.slice(0, 6).map((a, i) => (
                <span
                  key={i}
                  className="text-[10px] font-mono px-2 py-0.5 rounded bg-bg-elev text-text-2"
                >
                  {a}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          {showApproveCta && (
            <Button
              size="sm"
              onClick={() => onApprove(competitor.id, true)}
            >
              Approve
            </Button>
          )}
          {competitor.approvedByUser && (
            <button
              type="button"
              onClick={() => onApprove(competitor.id, false)}
              className="text-[11px] font-mono text-text-3 hover:text-danger"
            >
              remove
            </button>
          )}
        </div>
      </div>
    </GlassCard>
  );
}

function BenchmarkBlock({ benchmark }: { benchmark: BenchmarkPayload }) {
  const dims =
    benchmark.comparisonDimensions &&
    typeof benchmark.comparisonDimensions === 'object'
      ? (benchmark.comparisonDimensions as Record<string, DimScore>)
      : {};
  const opportunities = Array.isArray(benchmark.opportunities)
    ? (benchmark.opportunities as Opportunity[])
    : [];
  const weaknesses = Array.isArray(benchmark.defensiveWeaknesses)
    ? (benchmark.defensiveWeaknesses as DefensiveWeakness[])
    : [];

  const expiresAt = benchmark.expiresAt ? new Date(benchmark.expiresAt) : null;
  const expired = expiresAt ? expiresAt.getTime() < Date.now() : false;

  return (
    <section className="space-y-5 pt-2">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-2xl font-light">Benchmark</h2>
        <span className="text-[11px] font-mono text-text-3">
          {benchmark.competitorsAnalyzed} competitors ·{' '}
          {expired
            ? 'expired'
            : expiresAt
              ? `fresh until ${expiresAt.toLocaleDateString()}`
              : 'no expiry'}
        </span>
      </div>

      {benchmark.marketGap && (
        <GlassCard className="p-5 border border-accent/30 bg-accent/5">
          <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3 mb-1">
            Market gap
          </div>
          <p className="text-base text-text-1">{benchmark.marketGap}</p>
        </GlassCard>
      )}

      {benchmark.uniquePositioning && (
        <GlassCard className="p-5">
          <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3 mb-1">
            Unique positioning
          </div>
          <p className="text-base italic text-text-1">
            &ldquo;{benchmark.uniquePositioning}&rdquo;
          </p>
        </GlassCard>
      )}

      {Object.keys(dims).length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3 mb-1">
            Comparison matrix
          </div>
          {Object.entries(dims).map(([dim, data]) => {
            const us = data.us ?? 0;
            const avg = data.competitorsAvg ?? 0;
            const verdict =
              us > avg + 10
                ? { label: '✓ we lead', tint: 'text-emerald-500' }
                : us < avg - 10
                  ? { label: '⚠ they lead', tint: 'text-danger' }
                  : { label: '= even', tint: 'text-text-2' };
            return (
              <GlassCard key={dim} className="p-4">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
                  <span className="font-mono uppercase tracking-[0.1em] text-xs text-text-2">
                    {dim}
                  </span>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-text-3">
                      us <span className="font-mono text-text-1">{us}</span>
                    </span>
                    <span className="text-text-3">
                      avg{' '}
                      <span className="font-mono text-text-1">{avg}</span>
                    </span>
                    <span className={`font-mono ${verdict.tint}`}>
                      {verdict.label}
                    </span>
                  </div>
                </div>
                {data.reasoning && (
                  <p className="text-xs text-text-3">{data.reasoning}</p>
                )}
              </GlassCard>
            );
          })}
        </div>
      )}

      {opportunities.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3">
            Actionable opportunities
          </div>
          {opportunities.map((o, i) => (
            <GlassCard key={i} className="p-4">
              <div className="flex items-start justify-between gap-2 mb-1">
                <h3 className="font-medium text-text-1">
                  {o.opportunity ?? 'untitled'}
                </h3>
                {o.effort && (
                  <span
                    className={`text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-0.5 rounded ${effortTint(o.effort)}`}
                  >
                    {o.effort} effort
                  </span>
                )}
              </div>
              {o.rationale && (
                <p className="text-xs text-text-2">{o.rationale}</p>
              )}
              {o.expectedImpact && (
                <p className="text-xs text-accent mt-1">
                  Impact: {o.expectedImpact}
                </p>
              )}
            </GlassCard>
          ))}
        </div>
      )}

      {weaknesses.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3">
            Where competitors win — don&apos;t fight here
          </div>
          {weaknesses.map((w, i) => (
            <GlassCard
              key={i}
              className="p-4 border border-danger/20 bg-danger/5"
            >
              <div className="font-medium text-text-1 text-sm mb-1">
                {w.area ?? 'area'}
                {w.whoWins && (
                  <span className="text-text-3 ml-2">— {w.whoWins} wins</span>
                )}
              </div>
              {w.whyTheyWin && (
                <p className="text-xs text-text-2 mb-1">{w.whyTheyWin}</p>
              )}
              {w.ourMove && (
                <p className="text-xs text-accent">→ Our move: {w.ourMove}</p>
              )}
            </GlassCard>
          ))}
        </div>
      )}
    </section>
  );
}
