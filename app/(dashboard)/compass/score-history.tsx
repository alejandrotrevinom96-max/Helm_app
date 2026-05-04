'use client';

import { GlassCard } from '@/components/ui/glass-card';

interface HistoryPoint {
  id: string;
  totalScore: number;
  band: string;
  createdAt: string | Date;
}

export function ScoreHistory({ history }: { history: HistoryPoint[] }) {
  if (!history || history.length < 2) {
    return (
      <GlassCard className="p-5">
        <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
          Evolution
        </div>
        <p className="text-xs text-text-3">
          Recompute weekly to see your score trajectory.
        </p>
      </GlassCard>
    );
  }

  const minScore = Math.min(...history.map((h) => h.totalScore));
  const maxScore = Math.max(...history.map((h) => h.totalScore));
  // Pad the y-axis a bit so flat lines aren't glued to the edges.
  const range = Math.max(20, maxScore - minScore);
  const padding = 8;

  const points = history.map((h, i) => {
    const x = (i / Math.max(history.length - 1, 1)) * 100;
    const y =
      100 - ((h.totalScore - minScore + padding) / (range + padding * 2)) * 100;
    return { x, y, score: h.totalScore };
  });

  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
    .join(' ');

  const first = history[0];
  const last = history[history.length - 1];
  const delta = last.totalScore - first.totalScore;
  const deltaSign = delta > 0 ? '+' : '';

  return (
    <GlassCard className="p-5">
      <div className="flex justify-between items-start mb-3">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-1">
            Evolution
          </div>
          <div className="text-sm">
            <span
              className={delta >= 0 ? 'text-green-500' : 'text-red-500'}
            >
              {deltaSign}
              {delta} pts
            </span>
            <span className="text-text-3 text-xs ml-2">
              over {history.length} reading{history.length > 1 ? 's' : ''}
            </span>
          </div>
        </div>
      </div>

      <div className="relative" style={{ height: 100 }}>
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="w-full h-full"
        >
          <path
            d={path}
            stroke="currentColor"
            strokeWidth="0.8"
            fill="none"
            className="text-accent"
          />
          {points.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r="1.5"
              fill="currentColor"
              className="text-accent"
            />
          ))}
        </svg>
      </div>

      <div className="flex justify-between text-[10px] text-text-3 font-mono mt-2">
        <span>{new Date(first.createdAt).toLocaleDateString()}</span>
        <span>{new Date(last.createdAt).toLocaleDateString()}</span>
      </div>
    </GlassCard>
  );
}
