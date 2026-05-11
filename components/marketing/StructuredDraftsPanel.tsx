'use client';

// PR #60 — Sprint 7.0.4: opt-in panel for structured multi-type drafts.
//
// Lives alongside the legacy pillar-variants flow rather than
// replacing it. Founder flips one platform, picks one or more content
// types, prompts, and we POST /api/ai/generate-structured. Each
// returned draft renders through StructuredDraftCard which knows how
// to surface Reels vs Carousels vs Threads etc.
//
// Preferences persist per (projectId, platform) so the next time the
// founder lands here their checkbox state is restored.
import { useEffect, useMemo, useState } from 'react';
import { GlassCard } from '@/components/ui/glass-card';
import { Button } from '@/components/ui/button';
import { StructuredDraftCard } from './StructuredDraftCard';

type Platform =
  | 'instagram'
  | 'facebook'
  | 'linkedin'
  | 'reddit'
  | 'threads'
  | 'x';

const PLATFORMS: Platform[] = [
  'instagram',
  'facebook',
  'linkedin',
  'reddit',
  'threads',
  'x',
];

interface ContentTypeRow {
  id: string;
  platform: string;
  type: string;
  displayName: string;
  description: string | null;
  defaultEnabled: boolean;
  displayOrder: number;
}

interface Preference {
  platform: string;
  enabledTypes: string[];
}

interface Draft {
  id: string;
  contentType: string;
  displayName: string;
  structuredContent: Record<string, unknown> | null;
  error?: string;
}

interface Props {
  projectId: string;
}

export function StructuredDraftsPanel({ projectId }: Props) {
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState<Platform>('instagram');
  const [types, setTypes] = useState<ContentTypeRow[]>([]);
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingTypes, setLoadingTypes] = useState(false);

  // Hydrate prefs once. Cheap query that only returns rows for this
  // project, so we fetch all platforms in one shot then index by
  // platform at render time.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/content-preferences`,
          { cache: 'no-store' },
        );
        if (!res.ok) return;
        const data = (await res.json()) as { preferences?: Preference[] };
        if (!cancelled) setPreferences(data.preferences ?? []);
      } catch {
        /* non-fatal */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Load templates whenever platform changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingTypes(true);
      try {
        const res = await fetch(`/api/content-types?platform=${platform}`, {
          cache: 'force-cache',
        });
        const data = (await res.json()) as { types?: ContentTypeRow[] };
        if (cancelled) return;
        const rows = data.types ?? [];
        setTypes(rows);
        // Pick the selection: stored pref first, else defaultEnabled.
        const pref = preferences.find((p) => p.platform === platform);
        if (pref) {
          // Filter to types that still exist (in case schema changed).
          const valid = new Set(rows.map((r) => r.type));
          setSelected(pref.enabledTypes.filter((t) => valid.has(t)));
        } else {
          setSelected(rows.filter((r) => r.defaultEnabled).map((r) => r.type));
        }
      } catch {
        if (!cancelled) setTypes([]);
      } finally {
        if (!cancelled) setLoadingTypes(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [platform, preferences]);

  const persistSelection = async (next: string[]) => {
    try {
      await fetch(`/api/projects/${projectId}/content-preferences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, enabledTypes: next }),
      });
      // Update local pref cache so a re-open shows the new state.
      setPreferences((prev) => {
        const without = prev.filter((p) => p.platform !== platform);
        return [...without, { platform, enabledTypes: next }];
      });
    } catch {
      /* non-fatal */
    }
  };

  const toggleType = (type: string) => {
    const next = selected.includes(type)
      ? selected.filter((t) => t !== type)
      : [...selected, type];
    setSelected(next);
    void persistSelection(next);
  };

  const generate = async () => {
    if (selected.length === 0) {
      setError('Select at least one content type');
      return;
    }
    setError(null);
    setGenerating(true);
    setDrafts([]);
    try {
      const res = await fetch('/api/ai/generate-structured', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          platform,
          types: selected,
          prompt: prompt.trim(),
        }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        drafts?: Draft[];
        error?: string;
        hint?: string;
      };
      if (!res.ok || !data.success) {
        setError(data.error ?? data.hint ?? 'Generation failed');
        return;
      }
      setDrafts(data.drafts ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setGenerating(false);
    }
  };

  const totalCount = selected.length;
  const buttonLabel = useMemo(() => {
    if (generating) {
      return `Generating ${totalCount} draft${totalCount === 1 ? '' : 's'}…`;
    }
    return totalCount === 0
      ? 'Pick a type first'
      : `Generate ${totalCount} structured draft${totalCount === 1 ? '' : 's'}`;
  }, [generating, totalCount]);

  return (
    <section className="mt-10 border-t border-border pt-6">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-baseline justify-between mb-4 text-left"
      >
        <div>
          <h2 className="font-display text-xl font-light">
            Structured drafts <span className="text-text-3 text-sm">beta</span>
          </h2>
          <p className="text-sm text-text-3 mt-1">
            Per-platform formats — Reels with hook+beats+caption, Carousels
            with slides, LinkedIn essays, X threads, Reddit self-posts.
          </p>
        </div>
        <span className="text-text-3 text-lg shrink-0 ml-4">
          {open ? '−' : '+'}
        </span>
      </button>

      {open && (
        <div className="space-y-5">
          {/* Platform picker — single select. */}
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3 mb-2">
              Platform
            </div>
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map((p) => {
                const active = p === platform;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPlatform(p)}
                    className={`px-3 py-1.5 rounded text-xs font-mono uppercase tracking-[0.1em] border transition-colors ${
                      active
                        ? 'bg-accent text-white border-accent'
                        : 'bg-bg border-border text-text-2 hover:border-border-bright'
                    }`}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Type checkboxes. */}
          <GlassCard className="p-4">
            <div className="flex items-baseline justify-between mb-3">
              <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3">
                Content types
              </div>
              <span className="text-[10px] font-mono text-text-3">
                {selected.length} of {types.length} enabled
              </span>
            </div>
            {loadingTypes ? (
              <div className="text-sm text-text-3">Loading types…</div>
            ) : types.length === 0 ? (
              <div className="text-sm text-text-3">
                No content types configured for {platform}.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {types.map((t) => {
                  const checked = selected.includes(t.type);
                  return (
                    <label
                      key={t.id}
                      className={`flex items-start gap-3 p-3 border rounded cursor-pointer transition-colors ${
                        checked
                          ? 'border-accent bg-accent/5'
                          : 'border-border hover:border-border-bright'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleType(t.type)}
                        className="mt-1 accent-current"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm text-text-1">
                          {t.displayName}
                        </div>
                        {t.description && (
                          <div className="text-xs text-text-3 mt-0.5">
                            {t.description}
                          </div>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
            <p className="text-xs text-text-3 mt-3">
              We&apos;ll generate 1 structured draft for each selected type
              (Opus 4.7). Selections are saved per platform.
            </p>
          </GlassCard>

          {/* Prompt. */}
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3 mb-2">
              What to post about
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe what this batch should cover. The brand bible + voice fingerprint is loaded automatically."
              className="w-full min-h-[100px] px-3 py-2 bg-bg border border-border rounded-lg text-sm placeholder:text-text-3 focus:outline-none focus:border-border-bright"
            />
          </div>

          {/* Generate button + feedback. */}
          <div className="flex items-center gap-3">
            <Button onClick={generate} disabled={generating || selected.length === 0}>
              {buttonLabel}
            </Button>
            {error && <span className="text-sm text-danger">{error}</span>}
          </div>

          {/* Drafts. */}
          {drafts.length > 0 && (
            <div className="space-y-3 pt-4">
              <div className="flex items-baseline justify-between">
                <h3 className="font-display text-lg font-light">
                  Generated drafts
                </h3>
                <span className="text-xs font-mono text-text-3">
                  {drafts.length} produced
                </span>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {drafts.map((d, i) => (
                  <StructuredDraftCard
                    key={d.id || `${d.contentType}-${i}`}
                    platform={platform}
                    contentType={d.contentType}
                    displayName={d.displayName}
                    structuredContent={d.structuredContent}
                    error={d.error}
                    draftId={d.id || undefined}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
