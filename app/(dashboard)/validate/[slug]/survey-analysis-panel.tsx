'use client';

import { useState } from 'react';
import { GlassCard } from '@/components/ui/glass-card';
import { Button } from '@/components/ui/button';
import { formatRelativeDate } from '@/lib/utils';

export interface SurveyAnalysis {
  summary: string;
  overallSentiment: 'positive' | 'mixed' | 'negative';
  problemSolutionFit: number;
  perQuestionThemes: {
    question: string;
    themes: string[];
    quotes: { text: string; from?: string }[];
  }[];
  overallThemes: string[];
  standoutQuotes: { text: string; from?: string; reason: string }[];
  nextActions: string[];
  generatedAt: string;
}

export function SurveyAnalysisPanel({
  slug,
  initialAnalysis,
  responseCount,
}: {
  slug: string;
  initialAnalysis: SurveyAnalysis | null;
  responseCount: number;
}) {
  const [analysis, setAnalysis] = useState<SurveyAnalysis | null>(initialAnalysis);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/validate/${slug}/analyze`, {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok) {
        setAnalysis(data.analysis);
      } else {
        setError(data.error ?? 'Analysis failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  if (responseCount < 2) {
    return (
      <GlassCard className="p-5 md:p-6 mb-6">
        <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
          AI Analysis
        </div>
        <p className="text-sm text-text-2">
          Need at least 2 responses to analyze. You have {responseCount}.
        </p>
      </GlassCard>
    );
  }

  if (!analysis) {
    return (
      <GlassCard className="p-5 md:p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4 mb-3">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-1">
              AI Analysis
            </div>
            <h3 className="font-display text-xl font-light">
              Synthesize <em className="editorial-italic">survey</em> with Claude Opus
            </h3>
          </div>
          <Button onClick={analyze} disabled={loading}>
            {loading ? 'Analyzing…' : 'Analyze →'}
          </Button>
        </div>
        <p className="text-sm text-text-2">
          Get themes, sentiment, problem-fit score, standout quotes, and recommended next actions.
          Takes ~30-60s.
        </p>
        {error && <p className="text-xs text-danger mt-3">{error}</p>}
      </GlassCard>
    );
  }

  const sentimentColor =
    analysis.overallSentiment === 'positive'
      ? 'text-success'
      : analysis.overallSentiment === 'negative'
        ? 'text-danger'
        : 'text-text-2';

  const fitColor =
    analysis.problemSolutionFit >= 7
      ? 'text-success'
      : analysis.problemSolutionFit >= 4
        ? 'text-text-1'
        : 'text-danger';

  return (
    <div className="space-y-4 mb-6">
      <GlassCard elevated className="p-5 md:p-6">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 mb-4">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-accent mb-1">
              AI Synthesis
            </div>
            <p className="text-xs text-text-3">
              Generated {formatRelativeDate(analysis.generatedAt)} · Claude Opus
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={analyze} disabled={loading}>
            {loading ? 'Re-analyzing…' : 'Regenerate'}
          </Button>
        </div>

        <p className="text-base text-text-1 leading-relaxed mb-6">{analysis.summary}</p>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-1">
              Sentiment
            </div>
            <div className={`font-display text-2xl font-light capitalize ${sentimentColor}`}>
              {analysis.overallSentiment}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-1">
              Problem-Solution Fit
            </div>
            <div className={`font-display text-2xl font-light ${fitColor}`}>
              {analysis.problemSolutionFit}
              <span className="text-text-3 text-base">/10</span>
            </div>
          </div>
        </div>

        {error && <p className="text-xs text-danger mt-4">{error}</p>}
      </GlassCard>

      {analysis.overallThemes.length > 0 && (
        <GlassCard className="p-5">
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-3">
            Cross-cutting themes
          </div>
          <div className="flex flex-wrap gap-2">
            {analysis.overallThemes.map((t) => (
              <span
                key={t}
                className="text-xs px-3 py-1.5 bg-accent-soft text-accent rounded-full border border-accent/20"
              >
                {t}
              </span>
            ))}
          </div>
        </GlassCard>
      )}

      {analysis.perQuestionThemes.length > 0 && (
        <GlassCard className="p-5">
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-4">
            Per-question themes
          </div>
          <div className="space-y-5">
            {analysis.perQuestionThemes.map((q, i) => (
              <div key={i} className="border-l-2 border-border pl-4">
                <div className="font-medium text-sm text-text-1 mb-2">{q.question}</div>
                {q.themes.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {q.themes.map((t) => (
                      <span
                        key={t}
                        className="text-[10px] font-mono px-2 py-0.5 bg-surface-1 text-text-2 rounded"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                {q.quotes.map((quote, qi) => (
                  <blockquote
                    key={qi}
                    className="text-xs text-text-2 italic border-l-2 border-accent/30 pl-3 my-2"
                  >
                    &ldquo;{quote.text}&rdquo;
                    {quote.from && (
                      <span className="block text-text-3 not-italic mt-1">
                        — {quote.from}
                      </span>
                    )}
                  </blockquote>
                ))}
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      {analysis.standoutQuotes.length > 0 && (
        <GlassCard className="p-5">
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-4">
            Standout quotes
          </div>
          <div className="space-y-4">
            {analysis.standoutQuotes.map((q, i) => (
              <div key={i}>
                <p className="font-display text-lg font-light text-text-1 italic mb-2">
                  &ldquo;{q.text}&rdquo;
                </p>
                <div className="text-xs text-text-3">
                  {q.from && `— ${q.from} · `}
                  <span className="italic">{q.reason}</span>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      {analysis.nextActions.length > 0 && (
        <GlassCard className="p-5">
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-accent mb-3">
            Recommended next actions
          </div>
          <ol className="space-y-2">
            {analysis.nextActions.map((action, i) => (
              <li key={i} className="flex gap-3 text-sm text-text-1">
                <span className="text-accent font-mono">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span>{action}</span>
              </li>
            ))}
          </ol>
        </GlassCard>
      )}
    </div>
  );
}
