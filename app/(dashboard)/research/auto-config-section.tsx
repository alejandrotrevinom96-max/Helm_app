'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';

interface RecommendedSource {
  id: string;
  reason: string;
}

interface AutoConfig {
  keywords: string[];
  competitors: string[];
  recommendedSources: RecommendedSource[];
  rationale: string;
}

interface Props {
  projectId: string;
  // Called after Apply succeeds so the parent can re-fetch its current
  // config and rerender the chip lists.
  onApplied: () => void;
}

// Helm AI auto-config: Opus reads the brand bible and proposes keywords +
// competitors + sources. The user previews in a modal and applies with
// one click. Skips the manual "build a research config from scratch"
// experience that most founders don't bother completing.
export function AutoConfigSection({ projectId, onApplied }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [config, setConfig] = useState<AutoConfig | null>(null);
  const [applying, setApplying] = useState(false);

  const runAutoConfig = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/research/auto-configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.hint ?? data.error ?? 'Auto-configure failed');
        return;
      }
      setConfig(data.config);
      setPreviewOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const applyConfig = async () => {
    if (!config) return;
    setApplying(true);
    try {
      // The research_config.sources column is an object keyed by source
      // ID, not an array. Convert recommended sources into that shape.
      const sources = {
        reddit: config.recommendedSources.some((s) => s.id === 'reddit'),
        hackernews: config.recommendedSources.some(
          (s) => s.id === 'hackernews'
        ),
        indiehackers: config.recommendedSources.some(
          (s) => s.id === 'indiehackers'
        ),
        googleTrends: config.recommendedSources.some(
          (s) => s.id === 'googletrends'
        ),
      };
      const res = await fetch('/api/research/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          keywords: config.keywords,
          competitors: config.competitors,
          sources,
        }),
      });
      if (res.ok) {
        setPreviewOpen(false);
        onApplied();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Could not apply configuration');
      }
    } finally {
      setApplying(false);
    }
  };

  return (
    <>
      <div className="mb-5 p-4 bg-accent/5 border border-accent/30 rounded-lg">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-accent mb-1">
              Helm AI
            </div>
            <h4 className="font-medium text-sm mb-1">
              Auto-configure research
            </h4>
            <p className="text-xs text-text-2">
              Let Helm analyze your brand bible and propose keywords,
              competitors, and the best sources for your project.
            </p>
          </div>
          <Button
            onClick={runAutoConfig}
            disabled={loading}
            size="sm"
          >
            {loading ? 'Analyzing…' : 'Auto-configure'}
          </Button>
        </div>
        {error && (
          <p className="text-xs text-danger mt-2">⚠ {error}</p>
        )}
      </div>

      {previewOpen && config && (
        <div
          className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
          onClick={() => !applying && setPreviewOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <GlassCard
            elevated
            className="max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
              Suggested research config
            </div>
            <h2 className="font-display text-2xl font-light mb-2">
              Helm AI proposal
            </h2>
            {config.rationale && (
              <p className="text-sm text-text-2 mb-6 italic">
                {config.rationale}
              </p>
            )}

            <div className="space-y-5">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3 mb-2">
                  Keywords ({config.keywords.length})
                </div>
                <div className="flex flex-wrap gap-2">
                  {config.keywords.map((k, i) => (
                    <span
                      key={i}
                      className="text-xs px-3 py-1 rounded-full bg-bg-elev border border-border"
                    >
                      {k}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3 mb-2">
                  Competitors ({config.competitors.length})
                </div>
                <div className="flex flex-wrap gap-2">
                  {config.competitors.map((c, i) => (
                    <span
                      key={i}
                      className="text-xs px-3 py-1 rounded-full bg-accent/10 text-accent border border-accent/30"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3 mb-2">
                  Recommended sources ({config.recommendedSources.length})
                </div>
                <div className="space-y-2">
                  {config.recommendedSources.map((s, i) => (
                    <div key={i} className="text-xs">
                      <div className="font-medium capitalize">{s.id}</div>
                      <div className="text-text-3">{s.reason}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-border">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPreviewOpen(false)}
                disabled={applying}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={applyConfig} disabled={applying}>
                {applying ? 'Applying…' : 'Apply configuration'}
              </Button>
            </div>
          </GlassCard>
        </div>
      )}
    </>
  );
}
