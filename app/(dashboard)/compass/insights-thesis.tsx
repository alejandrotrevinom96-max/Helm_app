'use client';

import { GlassCard } from '@/components/ui/glass-card';
import type { CompassReading } from '@/lib/types/compass';

export function InsightsThesis({ reading }: { reading: CompassReading }) {
  const bull = reading.bullCase ?? [];
  const bear = reading.bearCase ?? [];
  const flags = reading.redFlags ?? [];

  return (
    <GlassCard className="p-6">
      <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-4">
        Investment thesis
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-green-500 mb-2">
            Bull case
          </div>
          <ul className="space-y-2">
            {bull.length === 0 ? (
              <li className="text-xs text-text-3 italic">—</li>
            ) : (
              bull.map((b, i) => (
                <li
                  key={i}
                  className="text-sm text-text-1 flex items-start gap-2"
                >
                  <span className="text-green-500 mt-0.5">↑</span>
                  <span>{b}</span>
                </li>
              ))
            )}
          </ul>
        </div>

        <div>
          <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-red-500 mb-2">
            Bear case
          </div>
          <ul className="space-y-2">
            {bear.length === 0 ? (
              <li className="text-xs text-text-3 italic">—</li>
            ) : (
              bear.map((b, i) => (
                <li
                  key={i}
                  className="text-sm text-text-1 flex items-start gap-2"
                >
                  <span className="text-red-500 mt-0.5">↓</span>
                  <span>{b}</span>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>

      {reading.dueDiligenceQuestion && (
        <div className="pt-4 border-t border-border">
          <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3 mb-2">
            Key due diligence question
          </div>
          <p className="text-base font-display italic text-text-1 pl-3 border-l-2 border-accent">
            {reading.dueDiligenceQuestion}
          </p>
        </div>
      )}

      {flags.length > 0 && (
        <div className="pt-4 border-t border-border mt-4">
          <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-amber-500 mb-2">
            Red flags
          </div>
          <ul className="space-y-1">
            {flags.map((f, i) => (
              <li
                key={i}
                className="text-xs text-text-2 flex items-start gap-2"
              >
                <span
                  className={
                    f.severity === 'critical'
                      ? 'text-red-500'
                      : 'text-amber-500'
                  }
                >
                  {f.severity === 'critical' ? '⚠⚠' : '⚠'}
                </span>
                <span>{f.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </GlassCard>
  );
}
