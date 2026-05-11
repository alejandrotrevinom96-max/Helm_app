'use client';

// PR #56 — Sprint 7.0: card for a single discovered source surfaced
// in /research/sources. Founder sees the platform/name/member count,
// the Haiku-generated rationale, and three actions: Connect (start
// monitoring), Skip (dismiss), Visit (open the community in a new tab
// — opinion forming).
//
// We keep this dumb on purpose: card emits onConnect/onSkip; the page
// owns the fetch + optimistic update. Same pattern as the Library
// PostCard from PR #23.
import { useState } from 'react';
import { GlassCard } from '@/components/ui/glass-card';
import { Button } from '@/components/ui/button';

export interface SuggestedSource {
  id: string;
  platform: string;
  identifier: string;
  displayName: string;
  url: string;
  memberCount: number | null;
  description: string | null;
  language: string | null;
  signalScore: number;
  rationale: string;
}

interface Props {
  source: SuggestedSource;
  onConnect: (sourceId: string) => Promise<void> | void;
  onSkip: (sourceId: string) => Promise<void> | void;
}

function scoreTint(score: number): string {
  if (score >= 80) return 'text-emerald-500';
  if (score >= 50) return 'text-amber-500';
  return 'text-danger';
}

function memberLabel(n: number | null): string {
  if (n == null) return '?';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function SourceMatchCard({ source, onConnect, onSkip }: Props) {
  const [busy, setBusy] = useState<'connect' | 'skip' | null>(null);

  const handle = async (action: 'connect' | 'skip') => {
    if (busy) return;
    setBusy(action);
    try {
      if (action === 'connect') {
        await onConnect(source.id);
      } else {
        await onSkip(source.id);
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <GlassCard className="p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-0.5 rounded bg-text-3/15 text-text-2">
              {source.platform}
            </span>
            {source.language && source.language !== 'en' && (
              <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3">
                {source.language}
              </span>
            )}
          </div>
          <h3 className="font-display text-lg font-light truncate">
            {source.displayName}
          </h3>
          <p className="text-xs text-text-3 mt-0.5">
            {memberLabel(source.memberCount)} members
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className={`font-mono text-2xl font-light ${scoreTint(source.signalScore)}`}>
            {source.signalScore}
          </div>
          <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3">
            fit
          </div>
        </div>
      </div>

      {source.description && (
        <p className="text-sm text-text-2 line-clamp-2">{source.description}</p>
      )}

      {source.rationale && (
        <p className="text-xs text-text-3 italic border-l-2 border-accent/40 pl-3">
          {source.rationale}
        </p>
      )}

      <div className="flex items-center gap-2 mt-1">
        <Button
          size="sm"
          onClick={() => handle('connect')}
          disabled={busy !== null}
        >
          {busy === 'connect' ? 'Connecting…' : 'Connect'}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => handle('skip')}
          disabled={busy !== null}
        >
          {busy === 'skip' ? 'Skipping…' : 'Skip'}
        </Button>
        <a
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto text-xs font-mono text-text-3 hover:text-text-1 transition-colors"
        >
          Visit ↗
        </a>
      </div>
    </GlassCard>
  );
}
