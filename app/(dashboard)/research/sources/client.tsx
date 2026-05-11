'use client';

// PR #56 — Sprint 7.0: founder-facing UI for source discovery.
//
// Two sections:
//   1. Connected — sources the founder has already approved. Live
//      list, server-hydrated.
//   2. Discover — Discover-button-driven workflow:
//      a. POST /api/research/discover (Reddit search)
//      b. POST /api/research/suggest-sources (Haiku ranking)
//      c. Founder hits Connect or Skip on each card
//
// We do a "discover-then-rank" two-step because discover may return
// zero new candidates (everything already decided on), and we don't
// want to bill a Haiku call just to learn that.
import { useState } from 'react';
import Link from 'next/link';
import { GlassCard } from '@/components/ui/glass-card';
import { Button } from '@/components/ui/button';
import { SourceMatchCard, type SuggestedSource } from '@/components/research/SourceMatchCard';

interface ConnectedSource {
  id: string;
  platform: string;
  identifier: string;
  displayName: string;
  url: string;
  memberCount: number | null;
  description: string | null;
  language: string | null;
  signalScore: number;
  connectedAt: string | null;
  findingsCount: number;
  lastScannedAt: string | null;
}

interface Props {
  project: { id: string; name: string };
  connected: ConnectedSource[];
  // PR #59 — Sprint 7.0.3: Reddit RSS opt-in (server-hydrated)
  initialRedditOptin: boolean;
}

function formatRelativeShort(iso: string | null): string {
  if (!iso) return 'never';
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (hours < 1) return 'just now';
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface DiscoverResponse {
  discovered: number;
  // Sprint 7.0 used `seedTermsUsed`; 7.0.1 also returns
  // `searchTermsUsed` (same value, friendlier name). Either populates.
  seedTermsUsed?: string[];
  searchTermsUsed?: string[];
  warnings?: string[];
  sources: Array<{
    id: string;
    platform: string;
    identifier: string;
    displayName: string;
    url: string;
    memberCount: number | null;
    description: string | null;
    language: string | null;
  }>;
  error?: string;
  hint?: string;
}

interface SuggestResponse {
  ranked: SuggestedSource[];
  error?: string;
}

export function SourcesClient({
  project,
  connected,
  initialRedditOptin,
}: Props) {
  const [connectedList, setConnectedList] = useState(connected);
  const [suggestions, setSuggestions] = useState<SuggestedSource[]>([]);
  const [busy, setBusy] = useState<'discover' | 'rank' | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // PR #57 — Sprint 7.0.1: surface the terms the server actually used
  // + any non-fatal warnings (e.g. YouTube key missing) so the founder
  // can see what was searched and why coverage might be partial.
  const [searchTerms, setSearchTerms] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [errorHint, setErrorHint] = useState<string | null>(null);

  // PR #59 — Sprint 7.0.3: Reddit RSS state. Opt-in must be accepted
  // before the founder can add subreddits or trigger a scan.
  const [redditOptin, setRedditOptin] = useState(initialRedditOptin);
  const [subredditInput, setSubredditInput] = useState('');
  const [addingSubreddit, setAddingSubreddit] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [rssFeedback, setRssFeedback] = useState<{
    kind: 'success' | 'error' | 'info';
    msg: string;
  } | null>(null);
  // PR #62 — Sprint 7.0.5: auto-connect top-5 button.
  const [autoConnecting, setAutoConnecting] = useState(false);

  const runDiscovery = async () => {
    setError(null);
    setErrorHint(null);
    setStatus(null);
    setSearchTerms([]);
    setWarnings([]);
    setBusy('discover');
    try {
      const dRes = await fetch('/api/research/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id }),
      });
      const dData = (await dRes.json()) as DiscoverResponse;
      if (!dRes.ok) {
        setError(dData.error ?? 'Discovery failed');
        setErrorHint(dData.hint ?? null);
        return;
      }
      const usedTerms = dData.searchTermsUsed ?? dData.seedTermsUsed ?? [];
      setSearchTerms(usedTerms);
      setWarnings(dData.warnings ?? []);
      if (dData.discovered === 0) {
        setStatus(
          'No new communities to suggest. Run again after adding more keywords in Research → Configuration, or check your Connected list.',
        );
        setSuggestions([]);
        return;
      }
      setStatus(
        `Discovered ${dData.discovered} new candidates. Ranking…`,
      );

      // Step 2: rank what we just found.
      setBusy('rank');
      const sRes = await fetch('/api/research/suggest-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          sourceIds: dData.sources.map((s) => s.id),
        }),
      });
      const sData = (await sRes.json()) as SuggestResponse;
      if (!sRes.ok) {
        setError(sData.error ?? 'Ranking failed');
        return;
      }
      setSuggestions(sData.ranked);
      setStatus(`Ready: ${sData.ranked.length} candidates ranked by Brand Fit.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setBusy(null);
    }
  };

  const handleConnect = async (sourceId: string) => {
    try {
      const res = await fetch('/api/research/connect-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, sourceId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Connect failed');
        return;
      }
      // Move from suggestions → connected list.
      const moved = suggestions.find((s) => s.id === sourceId);
      setSuggestions((prev) => prev.filter((s) => s.id !== sourceId));
      if (moved) {
        setConnectedList((prev) => [
          ...prev,
          {
            id: moved.id,
            platform: moved.platform,
            identifier: moved.identifier,
            displayName: moved.displayName,
            url: moved.url,
            memberCount: moved.memberCount,
            description: moved.description,
            language: moved.language,
            signalScore: moved.signalScore,
            connectedAt: new Date().toISOString(),
            findingsCount: 0,
            lastScannedAt: null,
          },
        ]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    }
  };

  const handleSkip = async (sourceId: string) => {
    try {
      const res = await fetch('/api/research/skip-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, sourceId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Skip failed');
        return;
      }
      setSuggestions((prev) => prev.filter((s) => s.id !== sourceId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    }
  };

  // PR #59 — Sprint 7.0.3: Reddit RSS opt-in handler.
  const enableRedditRss = async () => {
    setRssFeedback(null);
    try {
      const res = await fetch('/api/research/reddit-optin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, optin: true }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        setRssFeedback({
          kind: 'error',
          msg: data.error ?? 'Failed to enable Reddit RSS',
        });
        return;
      }
      setRedditOptin(true);
      setRssFeedback({
        kind: 'success',
        msg: 'Reddit RSS enabled. Add subreddits below.',
      });
    } catch (e) {
      setRssFeedback({
        kind: 'error',
        msg: e instanceof Error ? e.message : 'Network error',
      });
    }
  };

  const refreshConnected = async () => {
    try {
      const res = await fetch(
        `/api/research/project-sources?projectId=${project.id}&status=connected`,
        { cache: 'no-store' },
      );
      const data = (await res.json()) as {
        sources?: Array<{
          sourceId: string;
          platform: string;
          identifier: string;
          displayName: string;
          url: string;
          memberCount: number | null;
          description: string | null;
          signalScore: number | null;
          findingsCount: number | null;
          lastScannedAt: string | null;
          connectedAt: string | null;
        }>;
      };
      if (data.sources) {
        setConnectedList(
          data.sources.map((s) => ({
            id: s.sourceId,
            platform: s.platform,
            identifier: s.identifier,
            displayName: s.displayName,
            url: s.url,
            memberCount: s.memberCount,
            description: s.description,
            language: null,
            signalScore: s.signalScore ?? 50,
            connectedAt: s.connectedAt,
            findingsCount: s.findingsCount ?? 0,
            lastScannedAt: s.lastScannedAt,
          })),
        );
      }
    } catch {
      // non-fatal — list will refresh on navigation
    }
  };

  const addSubreddit = async () => {
    const trimmed = subredditInput.trim();
    if (!trimmed || addingSubreddit) return;
    setAddingSubreddit(true);
    setRssFeedback(null);
    try {
      const res = await fetch('/api/research/add-subreddit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, subreddit: trimmed }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        alreadyConnected?: boolean;
        error?: string;
      };
      if (!res.ok || !data.success) {
        setRssFeedback({
          kind: 'error',
          msg: data.error ?? 'Failed to add subreddit',
        });
        return;
      }
      setSubredditInput('');
      if (data.alreadyConnected) {
        setRssFeedback({ kind: 'info', msg: 'Already in your connected list.' });
      } else {
        setRssFeedback({ kind: 'success', msg: 'Subreddit added.' });
      }
      await refreshConnected();
    } catch (e) {
      setRssFeedback({
        kind: 'error',
        msg: e instanceof Error ? e.message : 'Network error',
      });
    } finally {
      setAddingSubreddit(false);
    }
  };

  const runScan = async () => {
    if (scanning) return;
    setScanning(true);
    setRssFeedback(null);
    try {
      const res = await fetch('/api/research/scan-rss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        findingsAdded?: number;
        sourcesScanned?: number;
        redditHealth?: { healthy: boolean; message: string };
        error?: string;
        hint?: string;
      };
      if (!res.ok || !data.success) {
        setRssFeedback({
          kind: 'error',
          msg: data.error ?? data.hint ?? 'Scan failed',
        });
        return;
      }
      const healthHint = data.redditHealth && !data.redditHealth.healthy
        ? ` (${data.redditHealth.message})`
        : '';
      setRssFeedback({
        kind: 'success',
        msg: `Scanned ${data.sourcesScanned ?? 0} subreddits, ${data.findingsAdded ?? 0} new findings.${healthHint}`,
      });
      await refreshConnected();
    } catch (e) {
      setRssFeedback({
        kind: 'error',
        msg: e instanceof Error ? e.message : 'Network error',
      });
    } finally {
      setScanning(false);
    }
  };

  // PR #62 — Sprint 7.0.5: auto-connect top-5 from the latest
  // brand_analysis row. Endpoint enforces predictedRelevance >= 80,
  // caps at 5, and skips Reddit when opt-in is off.
  const runAutoConnect = async () => {
    if (autoConnecting) return;
    setAutoConnecting(true);
    setRssFeedback(null);
    try {
      const res = await fetch('/api/research/auto-connect-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        autoConnected?: number;
        skippedOptinHint?: string | null;
        error?: string;
        hint?: string;
      };
      if (!res.ok || !data.success) {
        setRssFeedback({
          kind: 'error',
          msg: data.error ?? data.hint ?? 'Auto-connect failed',
        });
        return;
      }
      const count = data.autoConnected ?? 0;
      setRssFeedback({
        kind: count > 0 ? 'success' : 'info',
        msg:
          count > 0
            ? `Auto-connected ${count} source${count === 1 ? '' : 's'} (relevance ≥ 80).${
                data.skippedOptinHint ? ' ' + data.skippedOptinHint : ''
              }`
            : data.skippedOptinHint ??
              'No high-confidence sources available. Run Brand Analysis first.',
      });
      await refreshConnected();
    } catch (e) {
      setRssFeedback({
        kind: 'error',
        msg: e instanceof Error ? e.message : 'Network error',
      });
    } finally {
      setAutoConnecting(false);
    }
  };

  // Show the Reddit-specific UI prominently when the founder hasn't
  // accepted yet — otherwise it lives quietly alongside Discover.
  const redditConnectedCount = connectedList.filter(
    (s) => s.platform === 'reddit',
  ).length;

  return (
    <div className="p-4 md:p-8 space-y-8">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-3">
        <div>
          <div className="flex items-center gap-3 text-text-3 text-xs font-mono uppercase tracking-[0.15em] mb-2">
            <Link href="/research" className="hover:text-text-1 transition-colors">
              Research
            </Link>
            <span>/</span>
            <span>Sources</span>
          </div>
          <h1 className="font-display text-display-md font-light tracking-tight">
            Sources
          </h1>
          <p className="text-text-2 mt-2 max-w-2xl text-sm">
            Connect the communities where your audience actually hangs out.
            We&apos;ll discover candidates from your brand bible — you decide
            which ones to monitor.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* PR #59 — Sprint 7.0.3: Scan button only shows when opt-in
              is accepted AND there's at least one connected reddit
              source — otherwise it has nothing to scan. */}
          {redditOptin && redditConnectedCount > 0 && (
            <Button variant="secondary" onClick={runScan} disabled={scanning}>
              {scanning ? 'Scanning…' : 'Scan now ↻'}
            </Button>
          )}
          <Button onClick={runDiscovery} disabled={busy !== null}>
            {busy === 'discover'
              ? 'Discovering…'
              : busy === 'rank'
                ? 'Ranking…'
                : 'Discover sources ↻'}
          </Button>
          {/* PR #62 — Sprint 7.0.5: auto-connect the top-5 high-
              confidence (relevance ≥ 80) sources from the latest
              brand analysis. Capped at 5 per call to stay within
              Reddit's RSS rate-limit contract (1×/day per sub). */}
          <Button
            variant="secondary"
            onClick={runAutoConnect}
            disabled={autoConnecting}
            title="Connect the top 5 high-confidence (≥80) sources from your latest Brand Analysis"
          >
            {autoConnecting ? 'Connecting…' : '⚡ Auto-connect top 5'}
          </Button>
        </div>
      </div>

      {/* PR #59 — Sprint 7.0.3: Reddit RSS opt-in banner.
          Reddit's JSON API blocks cloud IPs and OAuth is now Devvit-
          only, so the only sustainable path is public RSS. We require
          explicit consent to the rate-limit contract before any
          subreddit gets added — both for Reddit's policy and for the
          founder's understanding of what's happening on their behalf. */}
      {!redditOptin && (
        <GlassCard className="p-5 border border-accent/30 bg-accent/5">
          <div className="flex items-start gap-3">
            <span className="text-2xl shrink-0">📡</span>
            <div className="flex-1 min-w-0">
              <h3 className="font-display text-lg font-light mb-2">
                Enable Reddit RSS discovery
              </h3>
              <p className="text-sm text-text-2 mb-3">
                Helm fetches public posts from subreddits you choose. To
                respect Reddit&apos;s infrastructure we:
              </p>
              <ul className="text-sm text-text-3 space-y-1 mb-4 list-disc list-inside">
                <li>Cache each fetch for 24 hours (no repeat requests)</li>
                <li>Fetch each subreddit at most 1× per day</li>
                <li>Use public RSS feeds only (no scraping)</li>
                <li>Send an identifiable User-Agent with contact info</li>
                <li>Auto-disable after 3 consecutive Reddit errors</li>
              </ul>
              <p className="text-xs text-text-3 mb-3">
                By enabling, you accept these limits. We may disable Reddit
                RSS automatically if their policies change.
              </p>
              <Button size="sm" onClick={enableRedditRss}>
                Enable Reddit RSS
              </Button>
            </div>
          </div>
        </GlassCard>
      )}

      {/* PR #59 — Sprint 7.0.3: manual subreddit add form. Only shown
          once opt-in is accepted. */}
      {redditOptin && (
        <GlassCard className="p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h3 className="font-display text-base font-light">
              Add a subreddit
            </h3>
            <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3">
              {redditConnectedCount} reddit connected
            </span>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="e.g. r/SoloFemaleTravelers"
              value={subredditInput}
              onChange={(e) => setSubredditInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addSubreddit();
                }
              }}
              disabled={addingSubreddit}
              className="flex-1 px-3 py-2 bg-bg border border-border rounded-lg text-sm placeholder:text-text-3 focus:outline-none focus:border-border-bright"
            />
            <Button
              size="sm"
              onClick={addSubreddit}
              disabled={addingSubreddit || !subredditInput.trim()}
            >
              {addingSubreddit ? 'Adding…' : 'Add'}
            </Button>
          </div>
          <p className="text-xs text-text-3 mt-2">
            We fetch once per day via RSS, cached 24h. Posts land in your
            research findings for pain-point extraction.
          </p>
        </GlassCard>
      )}

      {rssFeedback && (
        <div
          className={`text-xs ${
            rssFeedback.kind === 'error'
              ? 'text-danger'
              : rssFeedback.kind === 'success'
                ? 'text-emerald-500'
                : 'text-text-2'
          }`}
        >
          {rssFeedback.msg}
        </div>
      )}

      {status && (
        <div className="text-xs text-text-2 border-l-2 border-accent/40 pl-3">
          {status}
        </div>
      )}
      {/* PR #57 — Sprint 7.0.1: transparent feedback so the founder
          sees which terms were actually searched. If discovery comes
          back empty, this line is the diagnostic. */}
      {searchTerms.length > 0 && (
        <div className="text-[11px] font-mono text-text-3">
          <span className="uppercase tracking-[0.1em]">Searched:</span>{' '}
          {searchTerms.join(' · ')}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="p-3 border border-amber-500/30 bg-amber-500/10 rounded-lg text-xs text-amber-600 space-y-1">
          {warnings.map((w, i) => (
            <div key={i}>⚠ {w}</div>
          ))}
        </div>
      )}
      {error && (
        <div className="p-3 border border-danger/30 bg-danger/10 rounded-lg text-sm text-danger">
          <div>{error}</div>
          {errorHint && (
            <div className="text-xs text-danger/80 mt-1">{errorHint}</div>
          )}
        </div>
      )}

      {/* Connected */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-xl font-light">Connected</h2>
          <span className="text-xs font-mono text-text-3">
            {connectedList.length} active
          </span>
        </div>
        {connectedList.length === 0 ? (
          <GlassCard className="p-6 text-center text-text-3 text-sm">
            None yet. Run Discover to find your first candidates.
          </GlassCard>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {connectedList.map((s) => (
              <GlassCard key={s.id} className="p-4 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3">
                      {s.platform}
                    </span>
                  </div>
                  <div className="font-display text-base font-light truncate">
                    {s.displayName}
                  </div>
                  <div className="text-xs text-text-3">
                    {s.memberCount != null && (
                      <span>{s.memberCount.toLocaleString()} members</span>
                    )}
                    {s.signalScore != null && (
                      <span className="ml-2 font-mono">fit {s.signalScore}</span>
                    )}
                  </div>
                  {/* PR #59 — Sprint 7.0.3: surface scan stats so the
                      founder sees their RSS budget being spent. */}
                  <div className="text-[11px] font-mono text-text-3 mt-1">
                    {s.findingsCount} findings · last scan{' '}
                    {formatRelativeShort(s.lastScannedAt)}
                  </div>
                </div>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-mono text-text-3 hover:text-text-1 transition-colors"
                >
                  Visit ↗
                </a>
              </GlassCard>
            ))}
          </div>
        )}
      </section>

      {/* Suggestions */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-xl font-light">Suggestions</h2>
          <span className="text-xs font-mono text-text-3">
            {suggestions.length} pending
          </span>
        </div>
        {suggestions.length === 0 ? (
          <GlassCard className="p-6 text-center text-text-3 text-sm">
            Hit <span className="text-text-1">Discover sources</span> to surface
            candidates ranked by Brand Fit.
          </GlassCard>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {suggestions.map((s) => (
              <SourceMatchCard
                key={s.id}
                source={s}
                onConnect={handleConnect}
                onSkip={handleSkip}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
