'use client';

// PR #71 — Sprint 7.1E: Decision Log client.
//
// Three flows on this page:
//
// 1. NEW DECISION — founder fills title/description/category, clicks
//    "Score alignment" → Opus call (~10-15s) → ScoringDisplay
//    renders the verdict → founder can Commit or Reconsider. The
//    score is NOT persisted until Commit; clicking Reconsider drops
//    everything.
//
// 2. EVALUATE — on any decided/executing decision the founder can
//    open an inline evaluation form, mark worked/didn't, add notes
//    + lessons, save. The server calls Opus for an AI retrospective
//    and persists everything together.
//
// 3. STATUS UPDATES — pure status transitions (mark reversed, mark
//    executing) flow through PATCH and don't call Opus.
//
// Layout mirrors the existing Compass tabs: CompassSubNav at top,
// summary stats grid, list of decision cards. The cards visually
// downplay reversed/dismissed decisions but keep them visible —
// historical audit, not garbage collection.
import { useCallback, useState } from 'react';
import { GlassCard } from '@/components/ui/glass-card';
import { Button } from '@/components/ui/button';
import { CompassSubNav } from '@/components/compass/sub-nav';
import Link from 'next/link';

interface DecisionRow {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  alignmentScore: number | null;
  alignmentReasoning: string | null;
  reversibility: string | null;
  reversalCostNotes: string | null;
  founderConfidence: number | null;
  status: string;
  decidedAt: string | null;
  evaluatedAt: string | null;
  outcomeWorked: boolean | null;
  outcomeNotes: string | null;
  lessonsLearned: string | null;
  aiRetrospective: unknown;
}

interface Summary {
  total: number;
  decided: number;
  executing: number;
  evaluated: number;
  reversed: number;
  avgAlignment: number | null;
  workedRate: number | null;
}

interface Scoring {
  alignmentScore: number;
  alignmentReasoning: string;
  reversibility: string;
  reversalCostNotes: string;
  strongestArguments: string[];
  risks: string[];
  patternMatch: string;
  recommendation: string;
}

interface AIRetro {
  alignmentRecheck?: string;
  observedSignals?: string[];
  patternInsight?: string;
  scoringAccuracy?: string;
}

interface Props {
  project: { id: string; name: string };
  hasBrandAnalysis: boolean;
  initialDecisions: DecisionRow[];
  initialSummary: Summary;
}

const CATEGORIES: { key: string; label: string; icon: string }[] = [
  { key: 'product', label: 'Producto', icon: '🛠️' },
  { key: 'pricing', label: 'Pricing', icon: '💰' },
  { key: 'positioning', label: 'Positioning', icon: '🎯' },
  { key: 'audience', label: 'Audience', icon: '👥' },
  { key: 'platform', label: 'Platform', icon: '📡' },
  { key: 'content', label: 'Content', icon: '✍️' },
  { key: 'other', label: 'Otro', icon: '📌' },
];

const REVERSIBILITY_TINT: Record<string, string> = {
  easy: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
  medium: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  hard: 'bg-orange-500/15 text-orange-500 border-orange-500/30',
  irreversible: 'bg-danger/20 text-danger border-danger/40',
};

const RECOMMENDATION_TINT: Record<string, string> = {
  proceed: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
  proceed_carefully: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  reconsider: 'bg-orange-500/15 text-orange-500 border-orange-500/30',
  reject: 'bg-danger/20 text-danger border-danger/40',
};

const STATUS_TINT: Record<string, string> = {
  decided: 'bg-accent/15 text-accent border-accent/30',
  executing: 'bg-blue-500/15 text-blue-500 border-blue-500/30',
  evaluated: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
  reversed: 'bg-text-3/15 text-text-3 border-text-3/30',
};

const SCORING_ACCURACY_LABEL: Record<string, string> = {
  accurate: '✓ Score was accurate',
  overestimated: '⚠ Score was overestimated',
  underestimated: '↑ Score was underestimated',
};

function categoryMeta(key: string | null) {
  return (
    CATEGORIES.find((c) => c.key === key) ??
    CATEGORIES[CATEGORIES.length - 1]
  );
}

function alignmentTone(score: number | null): string {
  if (score === null) return 'text-text-3';
  if (score >= 80) return 'text-emerald-500';
  if (score >= 60) return 'text-amber-500';
  if (score >= 40) return 'text-orange-500';
  return 'text-danger';
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function DecisionsClient({
  project,
  hasBrandAnalysis,
  initialDecisions,
  initialSummary,
}: Props) {
  const [decisions, setDecisions] = useState<DecisionRow[]>(initialDecisions);
  const [summary, setSummary] = useState<Summary>(initialSummary);
  const [showNew, setShowNew] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: 'success' | 'error' | 'info';
    msg: string;
  } | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/compass/decisions?projectId=${project.id}`,
        { cache: 'no-store' },
      );
      const data = (await res.json()) as {
        decisions?: DecisionRow[];
        summary?: Summary;
      };
      if (data.decisions) setDecisions(data.decisions);
      if (data.summary) setSummary(data.summary);
    } catch (e) {
      setFeedback({
        kind: 'error',
        msg: e instanceof Error ? e.message : 'Network error',
      });
    }
  }, [project.id]);

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-6xl mx-auto">
      <header className="space-y-2">
        <CompassSubNav active="decisions" />
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-display text-display-md font-light tracking-tight">
              Decision Log
            </h1>
            <p className="text-text-2 text-sm max-w-2xl">
              Pre-decision alignment scoring + outcome tracking. La fricción
              de scorear ANTES de commit es lo que evita pivots por impulso —
              y el histórico revela patrones que solo se ven con tiempo.
            </p>
          </div>
          {hasBrandAnalysis && (
            <Button
              size="sm"
              onClick={() => {
                setShowNew(true);
                setFeedback(null);
              }}
              disabled={showNew}
            >
              + New decision
            </Button>
          )}
        </div>
      </header>

      {!hasBrandAnalysis && (
        <GlassCard className="p-5 border border-amber-500/30 bg-amber-500/5">
          <h3 className="font-display text-lg font-light mb-1">
            Brand analysis required
          </h3>
          <p className="text-sm text-text-3 mb-3">
            Sin un North Star no hay baseline para scorear alignment. Corré
            Smart Auto-configure en /research primero.
          </p>
          <Link href="/research">
            <Button size="sm">Open Research →</Button>
          </Link>
        </GlassCard>
      )}

      {hasBrandAnalysis && decisions.length > 0 && (
        <SummaryStats summary={summary} />
      )}

      {showNew && hasBrandAnalysis && (
        <NewDecisionForm
          projectId={project.id}
          onSaved={() => {
            setShowNew(false);
            setFeedback({ kind: 'success', msg: 'Decision committed.' });
            void reload();
          }}
          onCancel={() => setShowNew(false)}
          onError={(msg) => setFeedback({ kind: 'error', msg })}
        />
      )}

      {feedback && (
        <div
          className={`text-xs ${
            feedback.kind === 'error'
              ? 'text-danger'
              : feedback.kind === 'success'
                ? 'text-emerald-500'
                : 'text-text-2'
          }`}
        >
          {feedback.msg}
        </div>
      )}

      {hasBrandAnalysis && decisions.length === 0 && !showNew && (
        <EmptyState onCreate={() => setShowNew(true)} />
      )}

      {decisions.length > 0 && (
        <div className="space-y-3">
          {decisions.map((d) => (
            <DecisionCard
              key={d.id}
              decision={d}
              onUpdate={reload}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryStats({ summary }: { summary: Summary }) {
  const stats: { label: string; value: string }[] = [
    { label: 'Total', value: String(summary.total) },
    {
      label: 'Avg alignment',
      value:
        summary.avgAlignment !== null ? `${summary.avgAlignment}/100` : '—',
    },
    {
      label: 'Worked rate',
      value:
        summary.workedRate !== null ? `${summary.workedRate}%` : '— (none evaluated)',
    },
    {
      label: 'Evaluated',
      value: `${summary.evaluated} / ${summary.total}`,
    },
  ];
  return (
    <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {stats.map((s) => (
        <GlassCard key={s.label} className="p-4">
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3">
            {s.label}
          </div>
          <div className="font-display text-2xl font-light mt-1 text-text-1">
            {s.value}
          </div>
        </GlassCard>
      ))}
    </section>
  );
}

function NewDecisionForm({
  projectId,
  onSaved,
  onCancel,
  onError,
}: {
  projectId: string;
  onSaved: () => void;
  onCancel: () => void;
  onError: (msg: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<string>('other');
  const [founderConfidence, setFounderConfidence] = useState<number>(70);
  const [scoring, setScoring] = useState<Scoring | null>(null);
  const [scoringLoading, setScoringLoading] = useState(false);
  const [committing, setCommitting] = useState(false);

  const handleScore = async () => {
    if (!title.trim() || scoringLoading) return;
    setScoringLoading(true);
    try {
      const res = await fetch('/api/compass/decisions/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          title: title.trim(),
          description,
          category,
        }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        scoring?: Scoring;
        error?: string;
        hint?: string;
      };
      if (!res.ok || !data.success || !data.scoring) {
        onError(data.error ?? data.hint ?? 'Scoring failed');
        return;
      }
      setScoring(data.scoring);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setScoringLoading(false);
    }
  };

  const handleCommit = async () => {
    if (!scoring || committing) return;
    setCommitting(true);
    try {
      const res = await fetch('/api/compass/decisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          title: title.trim(),
          description,
          category,
          founderConfidence,
          alignmentScore: scoring.alignmentScore,
          alignmentReasoning: scoring.alignmentReasoning,
          reversibility: scoring.reversibility,
          reversalCostNotes: scoring.reversalCostNotes,
        }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        error?: string;
      };
      if (!res.ok || !data.success) {
        onError(data.error ?? 'Commit failed');
        return;
      }
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setCommitting(false);
    }
  };

  return (
    <GlassCard className="p-5 border border-accent/40 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-light">
          New strategic decision
        </h3>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs font-mono text-text-3 hover:text-text-1"
        >
          × close
        </button>
      </div>

      <input
        type="text"
        placeholder="Decisión (ej: focusear solo en women solo travelers)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={Boolean(scoring) || scoringLoading}
        className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm placeholder:text-text-3 focus:outline-none focus:border-border-bright"
      />

      <textarea
        placeholder="¿Por qué? Context, opciones consideradas, signals..."
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
        disabled={Boolean(scoring) || scoringLoading}
        className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm placeholder:text-text-3 focus:outline-none focus:border-border-bright"
      />

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          disabled={Boolean(scoring) || scoringLoading}
          className="px-3 py-2 bg-bg border border-border rounded-lg text-sm"
        >
          {CATEGORIES.map((c) => (
            <option key={c.key} value={c.key}>
              {c.icon} {c.label}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-2 text-xs text-text-3">
          Tu confianza:
          <input
            type="range"
            min={0}
            max={100}
            value={founderConfidence}
            onChange={(e) => setFounderConfidence(Number(e.target.value))}
            disabled={committing}
            className="w-32"
          />
          <span className="font-mono text-text-1 w-10">
            {founderConfidence}%
          </span>
        </label>
      </div>

      {!scoring ? (
        <div className="flex items-center gap-2 pt-2 border-t border-border">
          <Button
            onClick={handleScore}
            disabled={!title.trim() || scoringLoading}
            size="sm"
          >
            {scoringLoading
              ? 'Scoring… (~15s with Opus)'
              : '⚡ Score alignment'}
          </Button>
          <button
            type="button"
            onClick={onCancel}
            disabled={scoringLoading}
            className="text-xs font-mono text-text-3 hover:text-text-1 px-2"
          >
            cancel
          </button>
        </div>
      ) : (
        <ScoringDisplay
          scoring={scoring}
          committing={committing}
          onCommit={handleCommit}
          onReconsider={() => setScoring(null)}
        />
      )}
    </GlassCard>
  );
}

function ScoringDisplay({
  scoring,
  committing,
  onCommit,
  onReconsider,
}: {
  scoring: Scoring;
  committing: boolean;
  onCommit: () => void;
  onReconsider: () => void;
}) {
  const recoTint =
    RECOMMENDATION_TINT[scoring.recommendation] ??
    RECOMMENDATION_TINT.proceed_carefully;
  const revTint =
    REVERSIBILITY_TINT[scoring.reversibility] ?? REVERSIBILITY_TINT.medium;

  return (
    <div className="space-y-3 pt-3 border-t border-border">
      <div className="flex items-baseline gap-3 flex-wrap">
        <span
          className={`font-display text-5xl font-light ${alignmentTone(scoring.alignmentScore)}`}
        >
          {scoring.alignmentScore}
        </span>
        <span className="text-text-3 text-sm">
          / 100 alignment with North Star
        </span>
        <span
          className={`text-[10px] font-mono uppercase tracking-[0.15em] px-2 py-1 rounded border ${recoTint} ml-auto`}
        >
          {scoring.recommendation.replace('_', ' ')}
        </span>
      </div>

      <p className="text-sm text-text-2 italic">
        “{scoring.alignmentReasoning}”
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="p-3 bg-bg-elev/40 rounded border border-border">
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-1">
            Reversibility
          </div>
          <span
            className={`text-[10px] font-mono uppercase tracking-[0.15em] px-1.5 py-0.5 rounded border ${revTint}`}
          >
            {scoring.reversibility}
          </span>
          {scoring.reversalCostNotes && (
            <p className="text-xs text-text-2 mt-1.5">
              {scoring.reversalCostNotes}
            </p>
          )}
        </div>
        <div className="p-3 bg-bg-elev/40 rounded border border-border">
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-1">
            Pattern match
          </div>
          <p className="text-xs text-text-2">{scoring.patternMatch}</p>
        </div>
      </div>

      {scoring.strongestArguments.length > 0 && (
        <div>
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-1">
            Strongest arguments for
          </div>
          <ul className="space-y-1">
            {scoring.strongestArguments.map((a, i) => (
              <li key={i} className="text-xs text-text-2 flex gap-2">
                <span className="text-emerald-500 shrink-0">✓</span>
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {scoring.risks.length > 0 && (
        <div>
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-1">
            Risks
          </div>
          <ul className="space-y-1">
            {scoring.risks.map((r, i) => (
              <li key={i} className="text-xs text-text-2 flex gap-2">
                <span className="text-amber-500 shrink-0">⚠</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-2 pt-3 border-t border-border">
        <Button onClick={onCommit} disabled={committing} size="sm">
          {committing ? 'Committing…' : 'Commit decision'}
        </Button>
        <button
          type="button"
          onClick={onReconsider}
          disabled={committing}
          className="text-xs font-mono text-text-3 hover:text-text-1 px-2"
        >
          reconsider
        </button>
      </div>
    </div>
  );
}

function DecisionCard({
  decision,
  onUpdate,
}: {
  decision: DecisionRow;
  onUpdate: () => void;
}) {
  const [showEval, setShowEval] = useState(false);
  const meta = categoryMeta(decision.category);
  const revTint = decision.reversibility
    ? REVERSIBILITY_TINT[decision.reversibility] ??
      REVERSIBILITY_TINT.medium
    : 'bg-bg-elev text-text-3 border-border';
  const statusTint = STATUS_TINT[decision.status] ?? STATUS_TINT.decided;
  const dimmed = decision.status === 'reversed';

  const retro = decision.aiRetrospective as AIRetro | null;

  const setStatus = async (status: string) => {
    try {
      await fetch(`/api/compass/decisions/${decision.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      onUpdate();
    } catch {
      // soft fail — parent reload pulls truth
    }
  };

  const remove = async () => {
    if (!window.confirm('Delete this decision permanently?')) return;
    try {
      await fetch(`/api/compass/decisions/${decision.id}`, {
        method: 'DELETE',
      });
      onUpdate();
    } catch {
      /* soft */
    }
  };

  return (
    <GlassCard className={`p-5 space-y-3 ${dimmed ? 'opacity-60' : ''}`}>
      <header className="flex items-start gap-3 flex-wrap">
        <span aria-hidden className="text-xl shrink-0">
          {meta.icon}
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="font-display text-lg font-light text-text-1 leading-tight">
            {decision.title}
          </h3>
          <div className="flex items-center gap-2 mt-1 flex-wrap text-[10px] font-mono text-text-3">
            <span>{formatDate(decision.decidedAt)}</span>
            <span>·</span>
            <span>{meta.label}</span>
            {decision.reversibility && (
              <>
                <span>·</span>
                <span
                  className={`px-1.5 py-0.5 rounded border uppercase tracking-[0.1em] ${revTint}`}
                >
                  {decision.reversibility}
                </span>
              </>
            )}
            <span
              className={`px-1.5 py-0.5 rounded border uppercase tracking-[0.1em] ${statusTint}`}
            >
              {decision.status}
            </span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div
            className={`font-display text-3xl font-light ${alignmentTone(decision.alignmentScore)}`}
          >
            {decision.alignmentScore ?? '—'}
          </div>
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3">
            alignment
          </div>
        </div>
      </header>

      {decision.description && (
        <p className="text-sm text-text-2 whitespace-pre-line">
          {decision.description}
        </p>
      )}

      {decision.alignmentReasoning && (
        <div className="p-3 bg-bg-elev/40 rounded border border-border">
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-1">
            Pre-decision reasoning
          </div>
          <p className="text-sm text-text-2 italic">
            “{decision.alignmentReasoning}”
          </p>
          {decision.reversalCostNotes && (
            <p className="text-xs text-text-3 mt-2">
              Reversal cost: {decision.reversalCostNotes}
            </p>
          )}
        </div>
      )}

      {decision.outcomeWorked !== null && (
        <div
          className={`p-3 rounded border ${
            decision.outcomeWorked
              ? 'border-emerald-500/30 bg-emerald-500/5'
              : 'border-danger/30 bg-danger/5'
          }`}
        >
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-1">
            Outcome ({formatDate(decision.evaluatedAt)})
          </div>
          <div className="text-sm text-text-1 font-medium">
            {decision.outcomeWorked ? '✓ Worked' : '✗ Didn’t work'}
            {decision.outcomeNotes && (
              <span className="font-normal text-text-2">
                {' '}
                — {decision.outcomeNotes}
              </span>
            )}
          </div>
          {decision.lessonsLearned && (
            <p className="text-xs text-text-2 mt-2">
              <span className="text-text-3">Lessons:</span>{' '}
              {decision.lessonsLearned}
            </p>
          )}
          {retro && (
            <div className="mt-3 pt-3 border-t border-border space-y-2">
              {retro.scoringAccuracy && (
                <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3">
                  {SCORING_ACCURACY_LABEL[retro.scoringAccuracy] ??
                    retro.scoringAccuracy}
                </div>
              )}
              {retro.alignmentRecheck && (
                <p className="text-xs text-text-2 italic">
                  AI: {retro.alignmentRecheck}
                </p>
              )}
              {retro.patternInsight && (
                <p className="text-xs text-text-2">
                  <span className="text-text-3">Pattern:</span>{' '}
                  {retro.patternInsight}
                </p>
              )}
              {Array.isArray(retro.observedSignals) &&
                retro.observedSignals.length > 0 && (
                  <ul className="text-xs text-text-2 space-y-1">
                    {retro.observedSignals.map((s, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-accent shrink-0">→</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                )}
            </div>
          )}
        </div>
      )}

      {decision.status !== 'evaluated' && (
        <div className="flex items-center gap-1 flex-wrap pt-2 border-t border-border">
          {!showEval && decision.status !== 'reversed' && (
            <button
              type="button"
              onClick={() => setShowEval(true)}
              className="text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-1 rounded border border-border text-text-2 hover:border-accent hover:text-accent"
            >
              evaluate outcome
            </button>
          )}
          {decision.status === 'decided' && (
            <button
              type="button"
              onClick={() => setStatus('executing')}
              className="text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-1 rounded border border-border text-text-3 hover:border-blue-500 hover:text-blue-500"
            >
              mark executing
            </button>
          )}
          {decision.status !== 'reversed' && (
            <button
              type="button"
              onClick={() => setStatus('reversed')}
              className="text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-1 rounded border border-border text-text-3 hover:border-text-2 hover:text-text-2"
            >
              mark reversed
            </button>
          )}
          {decision.status === 'reversed' && (
            <button
              type="button"
              onClick={() => setStatus('decided')}
              className="text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-1 rounded border border-border text-text-3 hover:border-text-1 hover:text-text-1"
            >
              reopen
            </button>
          )}
          <button
            type="button"
            onClick={remove}
            className="text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-1 ml-auto text-text-3 hover:text-danger"
            aria-label="Delete decision"
          >
            delete
          </button>
        </div>
      )}

      {showEval && (
        <EvalForm
          decisionId={decision.id}
          onSaved={() => {
            setShowEval(false);
            onUpdate();
          }}
          onCancel={() => setShowEval(false)}
        />
      )}
    </GlassCard>
  );
}

function EvalForm({
  decisionId,
  onSaved,
  onCancel,
}: {
  decisionId: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [worked, setWorked] = useState<boolean | null>(null);
  const [notes, setNotes] = useState('');
  const [lessons, setLessons] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (worked === null || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/compass/decisions/${decisionId}/evaluate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            outcomeWorked: worked,
            outcomeNotes: notes,
            lessonsLearned: lessons,
          }),
        },
      );
      const data = (await res.json()) as {
        success?: boolean;
        retroSkipped?: boolean;
        error?: string;
      };
      if (!res.ok || !data.success) {
        setError(data.error ?? 'Save failed');
        return;
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 border border-accent/40 rounded space-y-3 mt-2">
      <div className="flex items-center justify-between">
        <h4 className="font-display text-sm uppercase tracking-[0.15em] text-text-1">
          Retrospective
        </h4>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs font-mono text-text-3 hover:text-text-1"
        >
          × close
        </button>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setWorked(true)}
          className={`text-[10px] font-mono uppercase tracking-[0.1em] px-3 py-1.5 rounded border ${
            worked === true
              ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/40'
              : 'border-border text-text-2 hover:border-emerald-500/40'
          }`}
        >
          ✓ Worked
        </button>
        <button
          type="button"
          onClick={() => setWorked(false)}
          className={`text-[10px] font-mono uppercase tracking-[0.1em] px-3 py-1.5 rounded border ${
            worked === false
              ? 'bg-danger/20 text-danger border-danger/40'
              : 'border-border text-text-2 hover:border-danger/40'
          }`}
        >
          ✗ Didn’t work
        </button>
      </div>

      <textarea
        placeholder="¿Qué pasó? Outcomes específicos observados…"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        className="w-full px-3 py-2 bg-bg border border-border rounded text-sm placeholder:text-text-3 focus:outline-none focus:border-border-bright"
      />

      <textarea
        placeholder="Lessons learned para la próxima…"
        value={lessons}
        onChange={(e) => setLessons(e.target.value)}
        rows={2}
        className="w-full px-3 py-2 bg-bg border border-border rounded text-sm placeholder:text-text-3 focus:outline-none focus:border-border-bright"
      />

      {error && <div className="text-xs text-danger">{error}</div>}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={worked === null || saving}
        >
          {saving ? 'Saving + generating retro…' : 'Save evaluation'}
        </Button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs font-mono text-text-3 hover:text-text-1 px-2"
        >
          cancel
        </button>
      </div>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <GlassCard className="p-12 text-center space-y-4">
      <div className="text-4xl">🎯</div>
      <div>
        <h3 className="font-display text-xl font-light mb-1">
          Log your first strategic decision
        </h3>
        <p className="text-sm text-text-3 max-w-md mx-auto">
          Compass scorea alignment con tu North Star ANTES de commit. Después
          podés trackear si funcionó — y con el tiempo se ven los patrones de
          decisión que repiten errores o aciertos.
        </p>
      </div>
      <Button onClick={onCreate}>+ New decision</Button>
    </GlassCard>
  );
}
