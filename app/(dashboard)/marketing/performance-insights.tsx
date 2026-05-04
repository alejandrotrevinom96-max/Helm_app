'use client';

import { useEffect, useState } from 'react';
import { GlassCard } from '@/components/ui/glass-card';
import { Skeleton } from '@/components/ui/skeleton';

interface Pattern {
  type: string;
  observation: string;
  evidence: string;
  actionable: string;
}

interface InsightsData {
  sufficient: boolean;
  hint?: string;
  ratedCount: number;
  workedCount?: number;
  floppedCount?: number;
  workedAvgScore?: number;
  floppedAvgScore?: number;
  patterns?: Pattern[];
  summary?: string;
}

export function PerformanceInsights({ projectId }: { projectId: string }) {
  const [data, setData] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/marketing/insights?projectId=${projectId}`)
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
      <GlassCard className="p-5 mb-6">
        <Skeleton className="h-3 w-32 mb-3" />
        <Skeleton className="h-6 w-64 mb-2" />
        <Skeleton className="h-3 w-full" />
      </GlassCard>
    );
  }

  if (!data) return null;

  if (!data.sufficient) {
    return (
      <GlassCard className="p-5 mb-6">
        <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
          Performance memory
        </div>
        <h3 className="font-display text-lg font-light mb-2">
          Helm is learning what works
        </h3>
        <p className="text-sm text-text-2">
          {data.hint} Rate posts as &ldquo;worked&rdquo; or &ldquo;flopped&rdquo;
          in the scheduled view to start building insights.
        </p>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="p-5 mb-6">
      <div className="flex justify-between items-start mb-3 gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-1">
            Performance memory
          </div>
          <h3 className="font-display text-lg font-light">
            What&apos;s working for you
          </h3>
        </div>
        {data.patterns && data.patterns.length > 0 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-accent hover:underline whitespace-nowrap"
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4 mb-4 text-xs">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-success mb-1">
            Worked
          </div>
          <div className="font-display text-2xl font-light text-text-1">
            {data.workedCount ?? 0}
          </div>
          <div className="text-[10px] text-text-3">
            avg score: {data.workedAvgScore ?? 0}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-amber-500 mb-1">
            Flopped
          </div>
          <div className="font-display text-2xl font-light text-text-1">
            {data.floppedCount ?? 0}
          </div>
          <div className="text-[10px] text-text-3">
            avg score: {data.floppedAvgScore ?? 0}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3 mb-1">
            Rated
          </div>
          <div className="font-display text-2xl font-light text-text-1">
            {data.ratedCount}
          </div>
          <div className="text-[10px] text-text-3">total feedback</div>
        </div>
      </div>

      {data.summary && (
        <p className="text-sm text-text-2 italic mb-3 pl-3 border-l-2 border-accent">
          {data.summary}
        </p>
      )}

      {expanded && data.patterns && data.patterns.length > 0 && (
        <div className="space-y-3 pt-3 border-t border-border">
          <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3 mb-2">
            Patterns identified
          </div>
          {data.patterns.map((p, i) => (
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
                <p className="text-accent text-[11px]">→ {p.actionable}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  );
}
