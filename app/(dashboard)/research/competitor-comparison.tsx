'use client';

import { useEffect, useState } from 'react';
import { GlassCard } from '@/components/ui/glass-card';
import { Skeleton } from '@/components/ui/skeleton';

interface Finding {
  id: string;
  title: string;
  snippet: string | null;
  matchScore: number | null;
  source: string;
  competitor: string | null;
  url: string;
  foundAt: string | Date;
}

interface ApiResponse {
  competitors: string[];
  findings: Record<string, Finding[]>;
}

export function CompetitorComparison({ projectId }: { projectId: string }) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/research/competitors?projectId=${projectId}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) setError(d.error);
        else setData(d);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <GlassCard key={i} className="p-5">
            <Skeleton className="h-4 w-32 mb-4" />
            <Skeleton className="h-3 w-full mb-2" />
            <Skeleton className="h-3 w-full mb-2" />
            <Skeleton className="h-3 w-3/4" />
          </GlassCard>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <GlassCard className="p-8 text-center">
        <p className="text-danger text-sm">{error}</p>
      </GlassCard>
    );
  }

  if (!data || data.competitors.length === 0) {
    return (
      <GlassCard className="p-8 text-center">
        <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
          No competitors configured
        </div>
        <p className="text-text-2 mb-2">
          Add competitors in your Research config to enable side-by-side comparison.
        </p>
        <p className="text-xs text-text-3">
          Examples: posthog, baremetrics, mixpanel
        </p>
      </GlassCard>
    );
  }

  const totalMentions = Object.values(data.findings).reduce(
    (sum, arr) => sum + arr.length,
    0
  );

  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-4">
        Tracking {data.competitors.length} competitor
        {data.competitors.length === 1 ? '' : 's'} · {totalMentions} total mentions
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {data.competitors.map((comp) => {
          const key = comp.toLowerCase();
          const findings = data.findings[key] || [];
          return (
            <GlassCard key={comp} className="p-5">
              <div className="flex items-baseline justify-between mb-4">
                <h3 className="font-display text-lg font-light">{comp}</h3>
                <span className="text-[10px] font-mono text-text-3">
                  {findings.length} mention{findings.length === 1 ? '' : 's'}
                </span>
              </div>

              {findings.length === 0 ? (
                <p className="text-xs text-text-3 italic">
                  No mentions detected. Make sure to add the competitor's name to
                  your keywords and run a fresh scan.
                </p>
              ) : (
                <div className="space-y-3">
                  {findings.slice(0, 5).map((f) => (
                    <a
                      key={f.id}
                      href={f.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block hover:bg-surface-1 -mx-2 px-2 py-2 rounded transition-colors"
                    >
                      <div className="flex items-baseline gap-2 mb-1">
                        <span className="text-[9px] font-mono uppercase text-accent">
                          {f.source}
                        </span>
                        <span className="text-[9px] font-mono text-text-3">
                          · {f.matchScore} match
                        </span>
                      </div>
                      <p className="text-xs text-text-1 line-clamp-2 leading-snug">
                        {f.title}
                      </p>
                      {f.snippet && (
                        <p className="text-[11px] text-text-2 line-clamp-2 mt-1 italic">
                          &ldquo;{f.snippet}&rdquo;
                        </p>
                      )}
                    </a>
                  ))}
                </div>
              )}

              {findings.length > 5 && (
                <p className="text-[10px] text-text-3 mt-3">
                  +{findings.length - 5} more
                </p>
              )}
            </GlassCard>
          );
        })}
      </div>
    </div>
  );
}
