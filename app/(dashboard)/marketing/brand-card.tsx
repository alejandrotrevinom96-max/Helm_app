'use client';

import { useState } from 'react';
import { GlassCard } from '@/components/ui/glass-card';
import { Button } from '@/components/ui/button';

export interface BrandContext {
  voice?: string;
  tone?: string[];
  audience?: string;
  keyPhrases?: string[];
  productFocus?: string;
  extractedAt?: string;
}

export function BrandCard({
  projectId,
  initialContext,
  initialUrl,
  onSaved,
}: {
  projectId: string;
  initialContext: BrandContext | null;
  initialUrl: string | null;
  onSaved?: (ctx: BrandContext) => void;
}) {
  const [context, setContext] = useState<BrandContext | null>(initialContext);
  const [editing, setEditing] = useState(!initialContext);
  const [url, setUrl] = useState(initialUrl ?? '');
  const [manualDesc, setManualDesc] = useState('');
  const [mode, setMode] = useState<'url' | 'manual'>(initialUrl ? 'url' : 'url');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const analyze = async () => {
    setLoading(true);
    setError(null);
    setHint(null);
    try {
      const res = await fetch('/api/brand/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          url: mode === 'url' ? url : null,
          manualDescription: mode === 'manual' ? manualDesc : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Analysis failed');
        if (data.hint) setHint(data.hint);
      } else {
        setContext(data.brandContext);
        setEditing(false);
        onSaved?.(data.brandContext);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  // Compact view when brand context already exists
  if (!editing && context) {
    return (
      <GlassCard className="p-5 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
              Brand context
            </div>
            {context.voice && (
              <p className="text-sm text-text-1 mb-2">
                <span className="text-text-3">Voice:</span> {context.voice}
              </p>
            )}
            {context.tone && context.tone.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {context.tone.map((t) => (
                  <span
                    key={t}
                    className="text-[10px] font-mono px-2 py-0.5 bg-accent-soft text-accent rounded-full tracking-[0.1em]"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
            {context.audience && (
              <p className="text-xs text-text-2">
                <span className="text-text-3">For:</span> {context.audience}
              </p>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEditing(true)}
            className="self-start"
          >
            Update
          </Button>
        </div>
      </GlassCard>
    );
  }

  // Initial setup / edit view
  return (
    <GlassCard className="p-4 md:p-6 mb-6">
      <h3 className="font-display text-2xl font-light mb-2">
        Connect your <em className="editorial-italic">brand</em>
      </h3>
      <p className="text-sm text-text-2 mb-5 max-w-xl">
        Helm needs to understand your brand voice to generate posts that sound like you.
      </p>

      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setMode('url')}
          className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
            mode === 'url' ? 'bg-accent-soft text-accent' : 'text-text-2 hover:text-text-1'
          }`}
        >
          From URL
        </button>
        <button
          onClick={() => setMode('manual')}
          className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
            mode === 'manual' ? 'bg-accent-soft text-accent' : 'text-text-2 hover:text-text-1'
          }`}
        >
          Describe manually
        </button>
      </div>

      {mode === 'url' ? (
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://yourproduct.com"
          className="w-full bg-bg-elev border border-border rounded-lg px-4 py-2.5 text-sm outline-none focus:border-accent"
        />
      ) : (
        <textarea
          value={manualDesc}
          onChange={(e) => setManualDesc(e.target.value)}
          placeholder="Briefly describe your product, audience, and tone. e.g.: We're a Slack alternative for indie hackers. Tone is technical but friendly..."
          rows={4}
          className="w-full bg-bg-elev border border-border rounded-lg px-4 py-2.5 text-sm outline-none focus:border-accent resize-none"
        />
      )}

      {error && (
        <div className="mt-3 text-xs">
          <p className="text-danger">{error}</p>
          {hint && <p className="text-text-3 mt-1">{hint}</p>}
        </div>
      )}

      <div className="flex justify-between items-center mt-4 gap-3 flex-wrap">
        {context && (
          <button
            onClick={() => setEditing(false)}
            className="text-xs text-text-3 hover:text-text-1 underline"
          >
            Cancel
          </button>
        )}
        <Button
          onClick={analyze}
          disabled={loading || (mode === 'url' ? !url.trim() : !manualDesc.trim())}
          className="ml-auto"
        >
          {loading ? 'Analyzing…' : 'Analyze →'}
        </Button>
      </div>
    </GlassCard>
  );
}
