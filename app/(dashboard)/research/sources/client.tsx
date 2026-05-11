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
}

interface Props {
  project: { id: string; name: string };
  connected: ConnectedSource[];
}

interface DiscoverResponse {
  discovered: number;
  seedTermsUsed: string[];
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

export function SourcesClient({ project, connected }: Props) {
  const [connectedList, setConnectedList] = useState(connected);
  const [suggestions, setSuggestions] = useState<SuggestedSource[]>([]);
  const [busy, setBusy] = useState<'discover' | 'rank' | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runDiscovery = async () => {
    setError(null);
    setStatus(null);
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
        setStatus(dData.hint ?? null);
        return;
      }
      if (dData.discovered === 0) {
        setStatus(
          'No new communities to suggest. Run again after adding more brand context, or check your Connected list.',
        );
        setSuggestions([]);
        return;
      }
      setStatus(
        `Discovered ${dData.discovered} new candidates from seeds: ${dData.seedTermsUsed.join(', ')}. Ranking…`,
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
        <Button onClick={runDiscovery} disabled={busy !== null}>
          {busy === 'discover'
            ? 'Discovering…'
            : busy === 'rank'
              ? 'Ranking…'
              : 'Discover sources ↻'}
        </Button>
      </div>

      {status && (
        <div className="text-xs text-text-2 border-l-2 border-accent/40 pl-3">
          {status}
        </div>
      )}
      {error && (
        <div className="p-3 border border-danger/30 bg-danger/10 rounded-lg text-sm text-danger">
          {error}
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
                    {s.memberCount != null
                      ? `${s.memberCount.toLocaleString()} members`
                      : ''}
                    {s.signalScore != null && (
                      <span className="ml-2 font-mono">fit {s.signalScore}</span>
                    )}
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
