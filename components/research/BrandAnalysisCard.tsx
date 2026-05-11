'use client';

// PR #62 — Sprint 7.0.5: Smart Auto-configure UI.
//
// Card mounts on /research, GETs the latest cached brand_analysis
// row, and surfaces it to the founder. Two actions:
//   - Regenerate: force-refresh the analysis (Opus + Haiku call).
//   - Apply keywords: PATCH the founder's keywords array on
//     research_config so the existing scan + extract endpoints
//     start using the new signal.
//
// Cache-aware: we never auto-trigger a Regenerate. The GET path is
// free; the founder pays for Opus only when they press the button.
import { useEffect, useState } from 'react';
import { GlassCard } from '@/components/ui/glass-card';
import { Button } from '@/components/ui/button';

interface SuggestedSource {
  platform: string;
  identifier: string;
  predictedRelevance: number;
  reasoning: string;
}

interface AudienceLayers {
  primary?: string;
  secondary?: string;
  tertiary?: string;
}

interface ToneGuidance {
  primary?: string;
  secondary?: string;
  tertiary?: string;
}

interface Analysis {
  id: string;
  niche: string;
  subNiches: string[] | null;
  audienceLayers: AudienceLayers | null;
  competitorGap: string | null;
  specificityRecommended: string | null;
  specificityReasoning: string | null;
  searchKeywords: string[] | null;
  suggestedSources: SuggestedSource[] | null;
  toneGuidance: ToneGuidance | null;
  competitorAngles: string[] | null;
  generatedBy: string | null;
  expiresAt: string | null;
  createdAt: string | null;
}

interface Props {
  projectId: string;
}

function specTint(level: string | null | undefined): string {
  switch (level) {
    case 'hyper':
      return 'text-purple-500';
    case 'niche':
      return 'text-blue-500';
    case 'broad':
      return 'text-emerald-500';
    default:
      return 'text-text-3';
  }
}

export function BrandAnalysisCard({ projectId }: Props) {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [applyingKeywords, setApplyingKeywords] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: 'success' | 'error' | 'info';
    msg: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // GET path is the cache read — free. If no analysis exists,
        // the founder sees the "Generate analysis" CTA below.
        const res = await fetch(
          `/api/research/analyze-brand?projectId=${projectId}`,
          { cache: 'no-store' },
        );
        const data = (await res.json()) as {
          hasAnalysis?: boolean;
          analysis?: Analysis;
        };
        if (cancelled) return;
        if (data.hasAnalysis && data.analysis) {
          setAnalysis(data.analysis);
        }
      } catch {
        /* non-fatal */
      } finally {
        if (!cancelled) setLoadingInitial(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const generate = async (force: boolean) => {
    setFeedback(null);
    if (force) setRegenerating(true);
    else setLoadingInitial(true);
    try {
      const res = await fetch('/api/research/analyze-brand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, force }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        analysis?: Analysis;
        cached?: boolean;
        error?: string;
        hint?: string;
      };
      if (!res.ok || !data.success || !data.analysis) {
        setFeedback({
          kind: 'error',
          msg: data.error ?? data.hint ?? 'Analysis failed',
        });
        return;
      }
      setAnalysis(data.analysis);
      setFeedback(
        data.cached
          ? { kind: 'info', msg: 'Loaded cached analysis (still fresh).' }
          : { kind: 'success', msg: 'Analysis ready.' },
      );
    } catch (e) {
      setFeedback({
        kind: 'error',
        msg: e instanceof Error ? e.message : 'Network error',
      });
    } finally {
      setRegenerating(false);
      setLoadingInitial(false);
    }
  };

  const applyKeywords = async () => {
    if (!analysis?.searchKeywords?.length || applyingKeywords) return;
    setApplyingKeywords(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/research/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          keywords: analysis.searchKeywords,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setFeedback({
          kind: 'error',
          msg: (data as { error?: string }).error ?? 'Failed to apply keywords',
        });
        return;
      }
      setFeedback({
        kind: 'success',
        msg: `Applied ${analysis.searchKeywords.length} keywords to research config.`,
      });
    } catch (e) {
      setFeedback({
        kind: 'error',
        msg: e instanceof Error ? e.message : 'Network error',
      });
    } finally {
      setApplyingKeywords(false);
    }
  };

  // Initial empty state — no analysis yet. Show a CTA.
  if (!loadingInitial && !analysis) {
    return (
      <GlassCard className="p-5 border border-accent/30 bg-accent/5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h3 className="font-display text-lg font-light mb-1">
              Smart brand analysis
            </h3>
            <p className="text-sm text-text-3 max-w-prose">
              Opus 4.7 reads your brand bible and returns niche + audience
              layers + competitor gap + recommended search keywords. Cached
              30 days — re-run when your positioning shifts.
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => generate(true)}
            disabled={regenerating}
          >
            {regenerating ? 'Analyzing…' : 'Generate analysis'}
          </Button>
        </div>
        {feedback && (
          <div
            className={`mt-3 text-xs ${
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
      </GlassCard>
    );
  }

  if (loadingInitial) {
    return (
      <GlassCard className="p-5">
        <div className="text-sm text-text-3">Loading brand analysis…</div>
      </GlassCard>
    );
  }

  // analysis is non-null past this point.
  const a = analysis!;
  const expiresAt = a.expiresAt ? new Date(a.expiresAt) : null;
  const expired = expiresAt ? expiresAt.getTime() < Date.now() : false;

  return (
    <GlassCard className="p-5">
      <header className="flex items-baseline justify-between gap-3 mb-4">
        <div>
          <h3 className="font-display text-lg font-light">
            Brand analysis
          </h3>
          <p className="text-[11px] font-mono text-text-3 mt-0.5">
            {a.generatedBy ?? 'opus'} ·{' '}
            {expired
              ? 'expired — consider regenerating'
              : expiresAt
                ? `fresh until ${expiresAt.toLocaleDateString()}`
                : 'no expiry'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => generate(true)}
          disabled={regenerating}
          className="text-xs font-mono text-accent hover:opacity-80 disabled:opacity-50"
        >
          {regenerating ? 'Regenerating…' : '↻ Regenerate'}
        </button>
      </header>

      {/* NICHE */}
      <div className="mb-4">
        <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3 mb-1">
          Niche detected
        </div>
        <p className="text-base font-medium text-text-1">{a.niche}</p>
        {a.subNiches && a.subNiches.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {a.subNiches.map((sub, i) => (
              <span
                key={i}
                className="text-[10px] font-mono px-2 py-0.5 bg-bg-elev rounded text-text-2"
              >
                {sub}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* AUDIENCE LAYERS */}
      {a.audienceLayers && (
        <div className="mb-4">
          <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3 mb-2">
            Audience layers
          </div>
          <div className="space-y-1 text-sm">
            {a.audienceLayers.primary && (
              <div>
                <span className="text-text-3 mr-2">Primary:</span>
                <span className="text-text-1">{a.audienceLayers.primary}</span>
              </div>
            )}
            {a.audienceLayers.secondary && (
              <div>
                <span className="text-text-3 mr-2">Secondary:</span>
                <span className="text-text-1">{a.audienceLayers.secondary}</span>
              </div>
            )}
            {a.audienceLayers.tertiary && (
              <div>
                <span className="text-text-3 mr-2">Tertiary:</span>
                <span className="text-text-1">{a.audienceLayers.tertiary}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* COMPETITOR GAP */}
      {a.competitorGap && (
        <div className="mb-4 p-3 bg-bg-elev rounded border-l-2 border-accent/40">
          <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3 mb-1">
            Competitor gap to own
          </div>
          <p className="text-sm italic text-text-1">{a.competitorGap}</p>
        </div>
      )}

      {/* SPECIFICITY */}
      {a.specificityRecommended && (
        <div className="mb-4">
          <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3 mb-1">
            Recommended specificity
          </div>
          <div className="flex items-baseline gap-3">
            <span
              className={`font-display text-2xl font-light uppercase ${specTint(
                a.specificityRecommended,
              )}`}
            >
              {a.specificityRecommended}
            </span>
            <span className="text-[11px] font-mono text-text-3">
              broad → niche → hyper
            </span>
          </div>
          {a.specificityReasoning && (
            <p className="text-xs text-text-3 mt-1">{a.specificityReasoning}</p>
          )}
        </div>
      )}

      {/* KEYWORDS */}
      {a.searchKeywords && a.searchKeywords.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3">
              Search keywords ({a.searchKeywords.length})
            </div>
            <button
              type="button"
              onClick={applyKeywords}
              disabled={applyingKeywords}
              className="text-xs font-mono text-accent hover:opacity-80 disabled:opacity-50"
            >
              {applyingKeywords ? 'Applying…' : 'Apply to research →'}
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {a.searchKeywords.map((kw, i) => (
              <span
                key={i}
                className="text-xs px-2 py-1 bg-bg-elev rounded text-text-2"
              >
                {kw}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* SUGGESTED SOURCES */}
      {a.suggestedSources && a.suggestedSources.length > 0 && (
        <div className="mb-4">
          <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3 mb-2">
            Suggested sources
          </div>
          <div className="space-y-1.5">
            {a.suggestedSources.map((src, i) => (
              <div
                key={`${src.platform}-${src.identifier}-${i}`}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3 mr-2">
                    {src.platform}
                  </span>
                  <span className="text-text-1">{src.identifier}</span>
                  {src.reasoning && (
                    <span className="text-xs text-text-3 ml-2">
                      — {src.reasoning}
                    </span>
                  )}
                </div>
                <span className="text-sm font-mono text-text-2 shrink-0">
                  {src.predictedRelevance}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* COMPETITOR ANGLES */}
      {a.competitorAngles && a.competitorAngles.length > 0 && (
        <div className="mb-4">
          <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3 mb-2">
            Competitor angles
          </div>
          <ul className="space-y-1">
            {a.competitorAngles.map((angle, i) => (
              <li key={i} className="text-sm text-text-1">
                · {angle}
              </li>
            ))}
          </ul>
        </div>
      )}

      {feedback && (
        <div
          className={`mt-3 text-xs ${
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
    </GlassCard>
  );
}
