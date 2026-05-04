'use client';

import { useState } from 'react';
import { GlassCard } from '@/components/ui/glass-card';
import type {
  CompassDimension,
  CompassReading,
} from '@/lib/types/compass';

export function DimensionBreakdown({ reading }: { reading: CompassReading }) {
  const [expandedDim, setExpandedDim] = useState<string | null>(null);

  return (
    <GlassCard className="p-6">
      <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
        Dimension breakdown
      </div>
      <h3 className="font-display text-2xl font-light mb-4">
        How your score is calculated
      </h3>

      <div className="space-y-3">
        {reading.dimensions.map((dim: CompassDimension) => {
          const pct = dim.maxPts > 0 ? (dim.pts / dim.maxPts) * 100 : 0;
          const isExpanded = expandedDim === dim.id;
          const color =
            pct >= 75
              ? 'bg-green-500'
              : pct >= 50
                ? 'bg-amber-500'
                : 'bg-red-500';

          return (
            <div
              key={dim.id}
              className="border-b border-border last:border-0 pb-3 last:pb-0"
            >
              <button
                onClick={() => setExpandedDim(isExpanded ? null : dim.id)}
                className="w-full text-left"
                aria-expanded={isExpanded}
              >
                <div className="flex justify-between items-baseline mb-1 gap-2">
                  <h4 className="font-medium text-sm">{dim.name}</h4>
                  <div className="text-xs font-mono whitespace-nowrap">
                    <span className="text-text-1 font-semibold">
                      {dim.pts}
                    </span>
                    <span className="text-text-3"> / {dim.maxPts}</span>
                  </div>
                </div>
                <div className="h-1.5 bg-border rounded-full overflow-hidden">
                  <div
                    className={`h-full ${color} transition-all`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </button>

              {isExpanded && (
                <div className="mt-3 pl-3 space-y-3">
                  {dim.subcriteria.map((sc) => {
                    const subPct =
                      sc.maxPts > 0 ? (sc.pts / sc.maxPts) * 100 : 0;
                    return (
                      <div key={sc.id} className="text-xs">
                        <div className="flex justify-between items-center mb-0.5 gap-2 flex-wrap">
                          <span className="text-text-2">{sc.name}</span>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              className={`text-[9px] px-1.5 py-0.5 rounded-full font-mono uppercase ${
                                sc.confidence === 'high'
                                  ? 'bg-green-500/10 text-green-500'
                                  : sc.confidence === 'medium'
                                    ? 'bg-amber-500/10 text-amber-500'
                                    : 'bg-red-500/10 text-red-500'
                              }`}
                            >
                              {sc.confidence}
                            </span>
                            <span
                              className={`text-[9px] px-1.5 py-0.5 rounded-full font-mono uppercase ${
                                sc.source === 'auto'
                                  ? 'bg-text-1/10 text-text-2'
                                  : 'bg-accent/10 text-accent'
                              }`}
                            >
                              {sc.source}
                            </span>
                            <span className="text-text-3 font-mono whitespace-nowrap">
                              {sc.pts}/{sc.maxPts}
                            </span>
                          </div>
                        </div>
                        <p className="text-[10px] text-text-3 italic mb-1">
                          {sc.evidence}
                        </p>
                        <div className="h-0.5 bg-border rounded-full overflow-hidden">
                          <div
                            className="h-full bg-accent"
                            style={{ width: `${subPct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}
