'use client';

// PR #50 — Sprint 6.8.1: dual-card insights surface.
//
// Pre-PR-50 this component rendered a single "Performance memory"
// card driven entirely by the legacy fields of /api/marketing/
// insights. Sprint 6.8 split the API into voice + performance +
// overall blocks, but the UI still only consumed the legacy
// shape — the founder couldn't actually see Helm learning their
// voice anywhere.
//
// Now we render TWO side-by-side cards on desktop (stacked on
// mobile):
//
//   ┌─ VOICE MEMORY ─────────┬─ PERFORMANCE MEMORY ──┐
//   │ N likes / N dislikes   │ N worked / N flopped  │
//   │ fingerprint: yes/no    │ avg score deltas      │
//   │ confidence chip        │ confidence chip       │
//   └────────────────────────┴───────────────────────┘
//
// Below the cards: the legacy Opus-derived "Patterns identified"
// expandable section, preserved verbatim for callers that have
// already published 5+ rated posts.
//
// The component still uses only /api/marketing/insights — no new
// endpoints, no client mutations. Pure consumer of the
// dual-shape response Sprint 6.8 already ships.

import { useEffect, useState } from 'react';
import { GlassCard } from '@/components/ui/glass-card';
import { Skeleton } from '@/components/ui/skeleton';

interface Pattern {
  type: string;
  observation: string;
  evidence: string;
  actionable: string;
}

interface VoiceBlock {
  totalLikes: number;
  totalDislikes: number;
  confidence: 'building' | 'not enough data';
  hasFingerprint: boolean;
  fingerprintQuotesCount: number;
  fingerprintUpdatedAt: string | null;
}

interface PerformanceBlock {
  totalWorked: number;
  totalFlopped: number;
  ratedCount: number;
  confidence: 'building' | 'not enough data';
}

interface OverallBlock {
  fullyOperational: boolean;
}

interface InsightsData {
  // Legacy fields kept for back-compat with older API responses.
  sufficient: boolean;
  hint?: string;
  ratedCount?: number;
  workedCount?: number;
  floppedCount?: number;
  workedAvgScore?: number;
  floppedAvgScore?: number;
  patterns?: Pattern[];
  summary?: string;
  // PR #49 dual-learning blocks (Sprint 6.8). Optional defensively
  // — if the API ever falls back to legacy-only shape, the cards
  // still render with sensible zero defaults.
  voice?: VoiceBlock;
  performance?: PerformanceBlock;
  overall?: OverallBlock;
}

const DEFAULT_VOICE: VoiceBlock = {
  totalLikes: 0,
  totalDislikes: 0,
  confidence: 'not enough data',
  hasFingerprint: false,
  fingerprintQuotesCount: 0,
  fingerprintUpdatedAt: null,
};

const DEFAULT_PERFORMANCE: PerformanceBlock = {
  totalWorked: 0,
  totalFlopped: 0,
  ratedCount: 0,
  confidence: 'not enough data',
};

const VOICE_THRESHOLD = 5;
const PERFORMANCE_THRESHOLD = 5;

export function PerformanceInsights({ projectId }: { projectId: string }) {
  const [data, setData] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/marketing/insights?projectId=${projectId}`, {
      cache: 'no-store',
    })
      .then((r) => r.json())
      .then((d: InsightsData) => {
        if (cancelled) return;
        setData(d);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        {[0, 1].map((i) => (
          <GlassCard key={i} className="p-5">
            <Skeleton className="h-3 w-28 mb-2" />
            <Skeleton className="h-5 w-48 mb-3" />
            <Skeleton className="h-3 w-full" />
          </GlassCard>
        ))}
      </div>
    );
  }

  if (!data) return null;

  const voice = data.voice ?? DEFAULT_VOICE;
  const performance = data.performance ?? DEFAULT_PERFORMANCE;
  const voiceTotal = voice.totalLikes + voice.totalDislikes;
  const voiceVotesNeeded = Math.max(0, VOICE_THRESHOLD - voiceTotal);
  const performanceRatedCount =
    performance.totalWorked + performance.totalFlopped;
  const performanceNeeded = Math.max(
    0,
    PERFORMANCE_THRESHOLD - performanceRatedCount
  );

  const hasPatterns = !!data.patterns && data.patterns.length > 0;

  return (
    <div className="mb-6 space-y-3">
      {/* Dual cards: Voice on the left, Performance on the right.
          Stacks vertically on mobile so a small screen sees them
          one above the other instead of half-width and unreadable. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* ====== VOICE MEMORY ====== */}
        <GlassCard className="p-5">
          <div className="flex items-baseline justify-between gap-2 mb-2">
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3">
              Voice memory
            </div>
            <ConfidenceChip confidence={voice.confidence} tone="accent" />
          </div>
          <h3 className="font-display text-base font-light mb-2 leading-tight">
            {voice.confidence === 'building'
              ? 'Helm is learning your voice'
              : 'Voice not yet learned'}
          </h3>
          <p className="text-xs text-text-2 leading-relaxed">
            <span className="text-text-1">{voice.totalLikes}</span>{' '}
            liked{voice.totalLikes === 1 ? '' : 's'},{' '}
            <span className="text-text-1">{voice.totalDislikes}</span>{' '}
            hidden.
            {voice.hasFingerprint && (
              <>
                {' '}Voice fingerprint built from{' '}
                <span className="text-text-1">
                  {voice.fingerprintQuotesCount}
                </span>{' '}
                quote{voice.fingerprintQuotesCount === 1 ? '' : 's'}.
              </>
            )}
            {voice.confidence !== 'building' && voiceVotesNeeded > 0 && (
              <>
                {' '}Like or hide {voiceVotesNeeded} more draft
                {voiceVotesNeeded === 1 ? '' : 's'} to start learning
                preferences.
              </>
            )}
            {!voice.hasFingerprint && (
              <>
                {' '}Add 3+ quotes to your Quote Vault to derive a
                voice fingerprint.
              </>
            )}
          </p>
        </GlassCard>

        {/* ====== PERFORMANCE MEMORY ====== */}
        <GlassCard className="p-5">
          <div className="flex items-baseline justify-between gap-2 mb-2">
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3">
              Performance memory
            </div>
            <ConfidenceChip
              confidence={performance.confidence}
              tone="success"
            />
          </div>
          <h3 className="font-display text-base font-light mb-2 leading-tight">
            {performance.confidence === 'building'
              ? "Helm knows what's resonating"
              : 'Performance not yet learned'}
          </h3>
          <p className="text-xs text-text-2 leading-relaxed">
            <span className="text-text-1">{performance.totalWorked}</span>{' '}
            worked,{' '}
            <span className="text-text-1">{performance.totalFlopped}</span>{' '}
            flopped.
            {data.workedAvgScore != null && data.floppedAvgScore != null && performance.totalWorked > 0 && performance.totalFlopped > 0 && (
              <>
                {' '}Worked avg score{' '}
                <span className="text-text-1">{data.workedAvgScore}</span>{' '}
                vs flopped{' '}
                <span className="text-text-1">{data.floppedAvgScore}</span>.
              </>
            )}
            {performance.confidence !== 'building' && performanceNeeded > 0 && (
              <>
                {' '}Rate {performanceNeeded} more post
                {performanceNeeded === 1 ? '' : 's'} as worked or
                flopped to start learning what works.
              </>
            )}
          </p>
        </GlassCard>
      </div>

      {/* Legacy patterns block — renders unchanged below the dual
          cards when Opus has produced a contrast-based analysis.
          Hidden when there are no patterns yet. */}
      {hasPatterns && (
        <GlassCard className="p-5">
          <div className="flex justify-between items-start mb-3 gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-1">
                Pattern analysis
              </div>
              <h3 className="font-display text-base font-light">
                What&apos;s working for you
              </h3>
            </div>
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-xs text-accent hover:underline whitespace-nowrap"
            >
              {expanded ? 'Collapse' : 'Expand'}
            </button>
          </div>
          {data.summary && (
            <p className="text-sm text-text-2 italic mb-3 pl-3 border-l-2 border-accent">
              {data.summary}
            </p>
          )}
          {expanded && (
            <div className="space-y-3 pt-3 border-t border-border">
              {data.patterns!.map((p, i) => (
                <div key={i} className="text-xs">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-surface-1 text-text-2 uppercase">
                      {p.type}
                    </span>
                  </div>
                  <p className="text-text-1 mb-1">{p.observation}</p>
                  {p.evidence && (
                    <p className="text-text-3 italic text-[11px] mb-1">
                      &ldquo;{p.evidence}&rdquo;
                    </p>
                  )}
                  {p.actionable && (
                    <p className="text-accent text-[11px]">
                      → {p.actionable}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      )}
    </div>
  );
}

// Small confidence pill rendered in the top-right of each card.
// Two tones — accent for voice (ties into Helm's brand color),
// success-green for performance (ties into "what worked"). Both
// fall back to neutral when there isn't enough data yet.
function ConfidenceChip({
  confidence,
  tone,
}: {
  confidence: 'building' | 'not enough data';
  tone: 'accent' | 'success';
}) {
  const isBuilding = confidence === 'building';
  const colorClass = !isBuilding
    ? 'bg-bg-elev/60 text-text-3 border-border'
    : tone === 'accent'
      ? 'bg-accent/10 text-accent border-accent/30'
      : 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30';
  return (
    <span
      className={`shrink-0 text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full border ${colorClass}`}
    >
      {isBuilding ? 'Building' : 'Need data'}
    </span>
  );
}
