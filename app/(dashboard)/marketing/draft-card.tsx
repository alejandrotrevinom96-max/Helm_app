'use client';

import { useState } from 'react';
import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { GlassCard } from '@/components/ui/glass-card';
import type { ScoreBreakdown } from '@/lib/ai/consistency-score';

export interface Draft {
  // PR #42 — Sprint 6.7: every draft now has a persisted DB id
  // when the generate-post endpoint stored it. Optional only
  // because errored drafts (no content) skip persistence.
  id?: string;
  content: string;
  pillar: string;
  rationale: string;
  consistencyScore: number;
  scoreBreakdown: ScoreBreakdown;
  violations: string[];
  suggestions: string[];
  error?: string;
  visual?: { url: string; prompt: string };
  visualLoading?: boolean;
  visualError?: string;
  seededByQuote?: string;
  // PR #42 — local mirror of generated_posts.user_vote so the
  // grid can filter disliked drafts out without a refetch.
  userVote?: 'liked' | 'disliked' | null;
  voting?: boolean;
}

interface Props {
  draft: Draft;
  isSelected: boolean;
  onSelect: () => void;
  onContentChange: (content: string) => void;
  onGenerateVisual?: () => void;
  onRegenerateVisual?: () => void;
  visualsAvailable?: boolean;
  showCarouselButton?: boolean;
  onGenerateCarousel?: () => void;
  // PR #42 — voting handler. Called with the persisted draft id
  // (which is why `draft.id` must be present). Parent is
  // responsible for the optimistic state update + filter on
  // dislike. The handler returns void so it can fire-and-forget;
  // toast feedback lives in the parent.
  onVote?: (id: string, vote: 'liked' | 'disliked') => void;
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
  onGenerateVisual,
  onRegenerateVisual,
  visualsAvailable = false,
  showCarouselButton = false,
  onGenerateCarousel,
  onVote,
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

      <p className="text-[11px] text-text-3 italic mb-2 line-clamp-2">
        {draft.rationale}
      </p>

      {draft.seededByQuote && (
        <div
          className="text-[10px] text-text-3 italic mb-3 pl-2 border-l-2 border-accent line-clamp-2"
          title={draft.seededByQuote}
        >
          Inspired by: &ldquo;{draft.seededByQuote.slice(0, 80)}
          {draft.seededByQuote.length > 80 ? '…' : ''}&rdquo;
        </div>
      )}

      {draft.visual && !draft.visualLoading && (
        <div className="mb-3 relative group rounded-lg overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={draft.visual.url}
            alt="Generated visual"
            className="w-full h-48 object-cover"
          />
          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
            {onRegenerateVisual && (
              <button
                onClick={onRegenerateVisual}
                className="text-xs bg-white/10 backdrop-blur px-3 py-1.5 rounded-full text-white hover:bg-white/20"
              >
                ↻ Regenerate
              </button>
            )}
            <a
              href={draft.visual.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs bg-white/10 backdrop-blur px-3 py-1.5 rounded-full text-white hover:bg-white/20"
            >
              Open ↗
            </a>
          </div>
        </div>
      )}

      {draft.visualLoading && (
        <div className="mb-3 h-48 rounded-lg bg-bg-elev flex items-center justify-center">
          <div className="text-center">
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
              Generating…
            </div>
            <p className="text-[10px] text-text-3">Flux Pro · ~8 seconds</p>
          </div>
        </div>
      )}

      {!draft.visual && !draft.visualLoading && visualsAvailable && onGenerateVisual && (
        <button
          onClick={onGenerateVisual}
          className="mb-3 w-full text-xs py-3 border border-dashed border-border rounded-lg text-text-3 hover:border-accent hover:text-accent transition-colors"
        >
          + Add visual ($0.05)
        </button>
      )}

      {draft.visualError && (
        <p className="text-[11px] text-danger mb-2">⚠ {draft.visualError}</p>
      )}

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

      {showCarouselButton && onGenerateCarousel && (
        <button
          onClick={onGenerateCarousel}
          className="mt-2 w-full text-xs py-2 border border-dashed border-border rounded-lg text-text-3 hover:border-accent hover:text-accent transition-colors"
        >
          Convert to 5-slide carousel
        </button>
      )}

      {/* PR #42 — Sprint 6.7: per-draft voting. Liked drafts get
          flagged for the upcoming "schedule N liked" batch flow.
          Disliked drafts soft-delete (parent removes from grid).
          Hidden when the draft hasn't been persisted yet (id
          missing — should be rare; only happens on error rows). */}
      {onVote && draft.id && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onVote(draft.id!, 'liked')}
            disabled={draft.voting}
            className={`text-xs py-2 rounded-lg border transition-colors flex items-center justify-center gap-1.5 ${
              draft.userVote === 'liked'
                ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-500'
                : 'border-border text-text-2 hover:border-emerald-500/40 hover:text-emerald-500'
            } disabled:opacity-50`}
            aria-pressed={draft.userVote === 'liked'}
            aria-label={
              draft.userVote === 'liked' ? 'Liked' : 'Like this draft'
            }
          >
            <ThumbsUp className="w-3.5 h-3.5" />
            {draft.userVote === 'liked' ? 'Liked' : 'Like'}
          </button>
          <button
            type="button"
            onClick={() => onVote(draft.id!, 'disliked')}
            disabled={draft.voting}
            className={`text-xs py-2 rounded-lg border transition-colors flex items-center justify-center gap-1.5 ${
              draft.userVote === 'disliked'
                ? 'bg-danger/10 border-danger/40 text-danger'
                : 'border-border text-text-2 hover:border-danger/40 hover:text-danger'
            } disabled:opacity-50`}
            aria-pressed={draft.userVote === 'disliked'}
            aria-label="Dislike this draft"
          >
            <ThumbsDown className="w-3.5 h-3.5" />
            Hide
          </button>
        </div>
      )}
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
