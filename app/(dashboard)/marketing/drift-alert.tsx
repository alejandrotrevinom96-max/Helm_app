'use client';

import { useEffect, useState } from 'react';
import { GlassCard } from '@/components/ui/glass-card';

interface DriftData {
  sufficient: boolean;
  driftDetected: boolean;
  averageScore?: number;
  postsAnalyzed?: number;
  recommendations?: string[];
}

export function DriftAlert({ projectId }: { projectId: string }) {
  const [data, setData] = useState<DriftData | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/marketing/drift-check?projectId=${projectId}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setData(d);
      })
      .catch(() => {
        if (cancelled) return;
        setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (!data?.driftDetected || dismissed) return null;

  return (
    <GlassCard className="p-4 mb-6 border border-amber-500/40">
      <div className="flex items-start gap-3">
        <span className="text-amber-500 text-lg leading-none">⚠</span>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-amber-500 mb-1">
            Brand drift detected
          </div>
          <h3 className="font-display text-lg font-light mb-2">
            Your recent posts are drifting from your brand bible
          </h3>
          <p className="text-sm text-text-2 mb-2">
            Average consistency score:{' '}
            <strong className="text-amber-500">
              {data.averageScore}/100
            </strong>{' '}
            across last {data.postsAnalyzed} posts.
          </p>
          {data.recommendations && data.recommendations.length > 0 && (
            <ul className="space-y-1 mb-1">
              {data.recommendations.map((r, i) => (
                <li key={i} className="text-xs text-text-2">
                  → {r}
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="text-text-3 hover:text-text-1 text-base leading-none px-1"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </GlassCard>
  );
}
