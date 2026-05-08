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
  // Selected platform chips. Pre-PR-20 this wasn't passed in, so the
  // server's prompt always saw "no channels" and the client cache key
  // didn't differentiate between {reddit} and {instagram, linkedin}.
  // Sorting here is purely for stability — the server also sorts.
  platforms: string[];
  onSelect: (promptStarter: string, category: string) => void;
  // Hardcoded templates from PR #2 used as fallback if Haiku fails or
  // returns nothing. UI never goes blank.
  fallbackContent?: React.ReactNode;
}

export function SmartTemplatesSection({
  projectId,
  platforms,
  onSelect,
  fallbackContent,
}: Props) {
  const [templates, setTemplates] = useState<SmartTemplate[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stable representation of platforms for use as both cache key suffix
  // and useEffect dependency. join(',') is enough because we sort.
  const platformsKey = [...platforms].sort().join(',');

  const fetchTemplates = useCallback(
    async (force: boolean) => {
      // Cache key now includes channels so {reddit} and {linkedin} don't
      // share the same cached templates. Empty channels keep the legacy
      // key for back-compat with cached entries from before PR #20.
      const cacheKey = platformsKey
        ? `${CACHE_KEY_PREFIX}${projectId}:${platformsKey}`
        : `${CACHE_KEY_PREFIX}${projectId}`;

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
        const url = platformsKey
          ? `/api/marketing/smart-templates?projectId=${projectId}&platforms=${encodeURIComponent(platformsKey)}`
          : `/api/marketing/smart-templates?projectId=${projectId}`;
        const res = await fetch(url);
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
    [projectId, platformsKey]
  );

  // Refetch automatically when platforms change. The cache key already
  // changes too, so this hits a fresh entry per channel-set.
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

  // PR #44 — Sprint 6.7.2: flatten the smart-templates grid.
  // Pre-PR-44 we grouped by category here, which meant a project
  // with one template per category produced 5 separate one-card
  // grids stacked vertically — lots of dead space, ugly on
  // desktop. Sprint 6.7.1 tried to fix this in client.tsx's
  // `fallbackContent` prop, but that branch only renders when
  // the AI returns ZERO templates (i.e. almost never in
  // production). Now we render flat here, with the category as
  // a uppercase mini-tag at the top of each card so the
  // information isn't lost.
  const flatTemplates = templates ?? [];

  return (
    <div className="space-y-3">
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {flatTemplates.map((t, i) => (
          <button
            key={`${t.category}-${i}`}
            onClick={() => onSelect(t.promptStarter, t.category)}
            className="text-left p-3 rounded-lg border border-border hover:border-accent transition-colors bg-bg-elev/50"
          >
            <div className="text-[9px] font-mono uppercase tracking-[0.1em] text-text-3 mb-1">
              {t.category}
            </div>
            <div className="text-sm font-medium text-text-1 mb-1">
              {t.title}
            </div>
            <div className="text-xs text-text-3 leading-snug">
              {t.description}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
