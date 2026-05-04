'use client';

import { useEffect, useState, useCallback } from 'react';

interface SmartTemplate {
  category: string;
  title: string;
  description: string;
  promptStarter: string;
}

interface CacheEntry {
  templates: SmartTemplate[];
  ts: number;
}

const CACHE_KEY_PREFIX = 'helm:smart-templates:';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface Props {
  projectId: string;
  onSelect: (promptStarter: string, category: string) => void;
  // Hardcoded templates from PR #2 used as fallback if Haiku fails or
  // returns nothing. UI never goes blank.
  fallbackContent?: React.ReactNode;
}

export function SmartTemplatesSection({
  projectId,
  onSelect,
  fallbackContent,
}: Props) {
  const [templates, setTemplates] = useState<SmartTemplate[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTemplates = useCallback(
    async (force: boolean) => {
      const cacheKey = `${CACHE_KEY_PREFIX}${projectId}`;

      if (!force) {
        try {
          const cached = localStorage.getItem(cacheKey);
          if (cached) {
            const { templates: cachedTpls, ts } = JSON.parse(cached) as CacheEntry;
            if (Date.now() - ts < CACHE_TTL_MS && cachedTpls.length > 0) {
              setTemplates(cachedTpls);
              setLoading(false);
              return;
            }
          }
        } catch {
          // corrupted cache → ignore and fetch fresh
        }
      }

      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/marketing/smart-templates?projectId=${projectId}`
        );
        const data = await res.json();
        if (!res.ok || !data.templates) {
          setError(data.hint ?? data.error ?? 'Could not generate templates');
          setTemplates([]);
          return;
        }
        setTemplates(data.templates);
        try {
          localStorage.setItem(
            cacheKey,
            JSON.stringify({ templates: data.templates, ts: Date.now() })
          );
        } catch {
          // localStorage full / disabled — UI still works
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setTemplates([]);
      } finally {
        setLoading(false);
      }
    },
    [projectId]
  );

  useEffect(() => {
    fetchTemplates(false);
  }, [fetchTemplates]);

  // If Haiku is failing or returns empty, fall back to hardcoded templates.
  // Caller passes those in via fallbackContent so we don't duplicate the
  // marketing client's existing template UI here.
  if (!loading && (templates === null || templates.length === 0)) {
    if (fallbackContent) {
      return <>{fallbackContent}</>;
    }
    if (error) {
      return (
        <p className="text-xs text-text-3 italic">
          Could not generate templates: {error}
        </p>
      );
    }
    return null;
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3">
          Choose a template (optional)
        </div>
        <div className="text-xs text-text-3 italic">
          Generating personalized templates…
        </div>
      </div>
    );
  }

  const byCategory = (templates ?? []).reduce<Record<string, SmartTemplate[]>>(
    (acc, t) => {
      if (!acc[t.category]) acc[t.category] = [];
      acc[t.category].push(t);
      return acc;
    },
    {}
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center gap-2">
        <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3">
          Choose a template (optional)
        </div>
        <button
          onClick={() => fetchTemplates(true)}
          disabled={loading}
          className="text-xs text-text-3 hover:text-accent disabled:opacity-50"
        >
          ↻ Refresh
        </button>
      </div>

      {Object.entries(byCategory).map(([category, items]) => (
        <div key={category}>
          <div className="text-xs text-text-3 mb-2">{category}</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {items.map((t, i) => (
              <button
                key={`${category}-${i}`}
                onClick={() => onSelect(t.promptStarter, t.category)}
                className="text-left p-3 rounded-lg border border-border hover:border-accent transition-colors"
              >
                <div className="text-sm font-medium mb-1">{t.title}</div>
                <div className="text-xs text-text-3">{t.description}</div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
