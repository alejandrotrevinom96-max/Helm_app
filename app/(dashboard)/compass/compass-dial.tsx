'use client';

import { GlassCard } from '@/components/ui/glass-card';
import type { CompassReading } from '@/lib/types/compass';

const BAND_COLORS: Record<
  string,
  { bg: string; text: string }
> = {
  strong: { bg: 'bg-green-500/10', text: 'text-green-500' },
  clear: { bg: 'bg-emerald-500/10', text: 'text-emerald-500' },
  steady: { bg: 'bg-text-1/10', text: 'text-text-1' },
  uncertain: { bg: 'bg-amber-500/10', text: 'text-amber-500' },
  'off-course': { bg: 'bg-red-500/10', text: 'text-red-500' },
};

interface Props {
  reading: CompassReading & { redFlags: Array<{ message: string }> };
}

// Half-disc dial: -90° on the left, +90° on the right. Score 0..100 maps
// to that angular range and rotates the needle accordingly.
export function CompassDial({ reading }: Props) {
  const score = reading.totalScore;
  const colors = BAND_COLORS[reading.band] ?? BAND_COLORS.steady;
  const angle = -90 + (score / 100) * 180;

  const bandRanges = [
    { from: 0, to: 45, color: 'rgb(239 68 68 / 0.5)' },
    { from: 45, to: 60, color: 'rgb(245 158 11 / 0.5)' },
    { from: 60, to: 75, color: 'rgb(115 115 115 / 0.5)' },
    { from: 75, to: 90, color: 'rgb(16 185 129 / 0.5)' },
    { from: 90, to: 100, color: 'rgb(34 197 94 / 0.5)' },
  ];

  const cx = 120;
  const cy = 120;
  const r = 100;

  return (
    <GlassCard className="p-6 md:p-8">
      <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-3">
        Compass score
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-6">
        <div className="relative" style={{ width: 240, height: 140 }}>
          <svg viewBox="0 0 240 140" className="w-full h-full">
            {bandRanges.map((b, i) => {
              const startAngle = -90 + (b.from / 100) * 180;
              const endAngle = -90 + (b.to / 100) * 180;
              const startRad = (startAngle * Math.PI) / 180;
              const endRad = (endAngle * Math.PI) / 180;
              const x1 = cx + r * Math.cos(startRad);
              const y1 = cy + r * Math.sin(startRad);
              const x2 = cx + r * Math.cos(endRad);
              const y2 = cy + r * Math.sin(endRad);
              const largeArc = b.to - b.from > 50 ? 1 : 0;
              return (
                <path
                  key={i}
                  d={`M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`}
                  stroke={b.color}
                  strokeWidth="14"
                  fill="none"
                />
              );
            })}

            <line
              x1={cx}
              y1={cy}
              x2={cx + 90 * Math.cos((angle * Math.PI) / 180)}
              y2={cy + 90 * Math.sin((angle * Math.PI) / 180)}
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              className={colors.text}
            />
            <circle
              cx={cx}
              cy={cy}
              r="6"
              fill="currentColor"
              className={colors.text}
            />

            {[0, 25, 50, 75, 100].map((v) => {
              const a = -90 + (v / 100) * 180;
              const ar = (a * Math.PI) / 180;
              const x1 = cx + 105 * Math.cos(ar);
              const y1 = cy + 105 * Math.sin(ar);
              const x2 = cx + 113 * Math.cos(ar);
              const y2 = cy + 113 * Math.sin(ar);
              const tx = cx + 122 * Math.cos(ar);
              const ty = cy + 122 * Math.sin(ar) + 4;
              return (
                <g key={v}>
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke="currentColor"
                    strokeWidth="1"
                    className="text-text-3"
                  />
                  <text
                    x={tx}
                    y={ty}
                    textAnchor="middle"
                    className="text-[10px] fill-current text-text-3 font-mono"
                  >
                    {v}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <div className="flex-1 text-center sm:text-left">
          <div
            className={`font-display text-6xl md:text-7xl font-light leading-none ${colors.text}`}
          >
            {score}
          </div>
          <div className="text-text-3 text-sm mt-1">/ 100</div>

          <div
            className={`mt-4 inline-block text-xs font-mono uppercase tracking-[0.15em] px-3 py-1.5 rounded-full ${colors.bg} ${colors.text}`}
          >
            {reading.bandLabel ?? reading.band}
          </div>

          {reading.redFlags && reading.redFlags.length > 0 && (
            <div className="mt-3 text-xs text-amber-500">
              ⚠ {reading.redFlags.length} flag
              {reading.redFlags.length > 1 ? 's' : ''} detected
            </div>
          )}
        </div>
      </div>
    </GlassCard>
  );
}
