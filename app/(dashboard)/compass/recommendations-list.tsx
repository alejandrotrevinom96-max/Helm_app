'use client';

import Link from 'next/link';
import { GlassCard } from '@/components/ui/glass-card';
import type {
  CompassDimensionId,
  CompassReading,
} from '@/lib/types/compass';

const DIM_LABELS: Record<CompassDimensionId, string> = {
  validation: 'Validation',
  strategy: 'Strategy',
  execution: 'Execution',
  traction: 'Traction',
  market: 'Market',
};

const EFFORT_COLORS: Record<string, string> = {
  low: 'text-green-500',
  medium: 'text-amber-500',
  high: 'text-red-500',
};

export function RecommendationsList({ reading }: { reading: CompassReading }) {
  if (!reading.recommendations || reading.recommendations.length === 0) {
    return null;
  }

  const totalLift = reading.recommendations.reduce(
    (s, r) => s + r.scoreLift,
    0
  );

  return (
    <GlassCard className="p-6">
      <div className="flex justify-between items-start mb-4 gap-3">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-1">
            Recommendations
          </div>
          <h3 className="font-display text-2xl font-light">
            How to raise your score
          </h3>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3">
            Potential lift
          </div>
          <div className="text-2xl font-display font-light text-accent">
            +{totalLift}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {reading.recommendations.map((rec) => (
          <div key={rec.id} className="p-4 bg-bg-elev rounded-lg">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-surface-1 text-text-2 uppercase">
                {DIM_LABELS[rec.dimension] ?? rec.dimension}
              </span>
              <span
                className={`text-[10px] font-mono px-2 py-0.5 rounded-full bg-surface-1 ${EFFORT_COLORS[rec.effort] ?? ''}`}
              >
                {rec.effort} effort
              </span>
              <span className="text-xs text-accent font-mono">
                +{rec.scoreLift} pts
              </span>
            </div>

            <h4 className="font-medium text-sm mb-1">{rec.title}</h4>
            <p className="text-xs text-text-2 mb-3">{rec.description}</p>

            {rec.cta && (
              <Link
                href={rec.cta.href}
                className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
              >
                {rec.cta.label} →
              </Link>
            )}
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
