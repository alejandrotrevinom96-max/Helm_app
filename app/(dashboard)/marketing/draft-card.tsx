'use client';

import { useState } from 'react';
import { GlassCard } from '@/components/ui/glass-card';
import type { ScoreBreakdown } from '@/lib/ai/consistency-score';

export interface Draft {
  content: string;
  pillar: string;
  rationale: string;
  consistencyScore: number;
  scoreBreakdown: ScoreBreakdown;
  violations: string[];
  suggestions: string[];
  error?: string;
}

interface Props {
  draft: Draft;
  isSelected: boolean;
  onSelect: () => void;
  onContentChange: (content: string) => void;
}

const SCORE_WEIGHTS: Record<keyof ScoreBreakdown, number> = {
  voice: 35,
  vocabulary: 15,
  nonNegotiables: 20,
  pillarAlignment: 20,
  audienceResonance: 10,
};

const SCORE_LABELS: Record<keyof ScoreBreakdown, string> = {
  voice: 'Voice match',
  vocabulary: 'Vocabulary',
  nonNegotiables: 'Non-negotiables',
  pillarAlignment: 'Pillar alignment',
  audienceResonance: 'Audience resonance',
};

export function DraftCard({
  draft,
  isSelected,
  onSelect,
  onContentChange,
}: Props) {
  const [showBreakdown, setShowBreakdown] = useState(false);

  const scoreColor =
    draft.consistencyScore >= 85
      ? 'text-success'
      : draft.consistencyScore >= 70
        ? 'text-text-1'
        : 'text-amber-500';

  if (draft.error) {
    return (
      <GlassCard className="p-4 border border-danger/40">
        <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
          Draft · {draft.pillar}
        </div>
        <p className="text-xs text-danger">⚠ {draft.error}</p>
      </GlassCard>
    );
  }

  return (
    <GlassCard className={`p-4 ${isSelected ? 'ring-2 ring-accent' : ''}`}>
      <div className="flex items-baseline justify-between mb-2 gap-2">
        <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 capitalize truncate">
          Draft · {draft.pillar}
        </div>
        <button
          onClick={() => setShowBreakdown((v) => !v)}
          className={`text-sm font-semibold ${scoreColor} hover:underline whitespace-nowrap`}
          title="Click for breakdown"
        >
          {draft.consistencyScore}
        </button>
      </div>

      <p className="text-[11px] text-text-3 italic mb-3 line-clamp-2">
        {draft.rationale}
      </p>

      <textarea
        value={draft.content}
        onChange={(e) => onContentChange(e.target.value)}
        rows={6}
        className="w-full bg-bg-elev border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent mb-2"
      />

      <div className="text-[10px] text-text-3 mb-3">
        {draft.content.length} chars
      </div>

      {showBreakdown && (
        <div className="space-y-2 mb-3 p-3 bg-bg-elev rounded-lg">
          <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3 mb-2">
            Score breakdown
          </div>
          {(Object.keys(SCORE_WEIGHTS) as Array<keyof ScoreBreakdown>).map(
            (key) => (
              <ScoreBar
                key={key}
                label={SCORE_LABELS[key]}
                value={draft.scoreBreakdown[key]}
                weight={SCORE_WEIGHTS[key]}
              />
            )
          )}

          {draft.violations.length > 0 && (
            <div className="pt-2 border-t border-border">
              <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-amber-500 mb-1">
                Issues
              </div>
              <ul className="space-y-1">
                {draft.violations.map((v, i) => (
                  <li
                    key={i}
                    className="text-[11px] text-text-2 flex items-start gap-2"
                  >
                    <span className="text-amber-500">⚠</span>
                    <span>{v}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {draft.suggestions.length > 0 && (
            <div className="pt-2 border-t border-border">
              <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-accent mb-1">
                Suggestions
              </div>
              <ul className="space-y-1">
                {draft.suggestions.map((s, i) => (
                  <li
                    key={i}
                    className="text-[11px] text-text-2 flex items-start gap-2"
                  >
                    <span className="text-accent">→</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <button
        onClick={onSelect}
        className={`w-full text-xs py-2 rounded-lg transition-colors ${
          isSelected
            ? 'bg-accent text-white'
            : 'bg-bg-elev hover:bg-surface-1 text-text-1'
        }`}
      >
        {isSelected ? '✓ Selected' : 'Use this draft'}
      </button>
    </GlassCard>
  );
}

function ScoreBar({
  label,
  value,
  weight,
}: {
  label: string;
  value: number;
  weight: number;
}) {
  const pct = Math.max(0, Math.min(100, (value / 10) * 100));
  const fill =
    value >= 8 ? 'bg-success' : value >= 6 ? 'bg-accent' : 'bg-amber-500';
  return (
    <div>
      <div className="flex justify-between text-[10px] mb-0.5">
        <span className="text-text-2">{label}</span>
        <span className="text-text-3 font-mono">
          {value}/10 · {weight}%
        </span>
      </div>
      <div className="h-1 bg-border rounded-full overflow-hidden">
        <div className={`h-full ${fill}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
