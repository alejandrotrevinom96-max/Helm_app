'use client';

// PR #76 — Sprint 7.3: promoted version of the structured-drafts
// panel. The original StructuredDraftsPanel was opt-in / collapsed
// by default and lived BELOW the legacy pillar-variants generate
// flow. With 5 new users entering the funnel, this version becomes
// THE primary generate flow — no collapse, no "beta" tag, no
// fallback to legacy unless the founder explicitly asks.
//
// What's different from StructuredDraftsPanel:
//   - Always open (no toggle state).
//   - Content types render Flux / HeyGen capability badges so the
//     founder sees up front which types will queue extra media.
//   - The "Generate" button shows the estimated time + a note when
//     video types are selected ("video generation queued for later").
//   - Categorized error UI (PR #75) — overloaded / rate_limit / etc.
//     get specific copy + retry hints.
//   - Generated drafts route the founder to /marketing/library via
//     router.refresh + router.push (NOT window.location.href, which
//     forces a full reload and drops the React tree).
//
// What we deliberately KEPT from StructuredDraftsPanel:
//   - The same /api/content-types lookup (cache-friendly).
//   - The same /api/projects/{id}/content-preferences round-trip
//     for per-platform selection persistence.
//   - The same /api/ai/generate-structured POST shape (server
//     does Flux + HeyGen queue work transparently).
//   - StructuredDraftCard for rendering returned drafts.
//   - StructuredDraftErrorBoundary per card.
//
// The old StructuredDraftsPanel file is NOT deleted — it still
// works and could be re-mounted as a "classic generator" toggle if
// founder feedback demands it. Code stays unused but intact.
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GlassCard } from '@/components/ui/glass-card';
import { Button } from '@/components/ui/button';
import { StructuredDraftCard } from './StructuredDraftCard';
import { StructuredDraftErrorBoundary } from './StructuredDraftErrorBoundary';

type Platform =
  | 'instagram'
  | 'facebook'
  | 'linkedin'
  | 'reddit'
  | 'threads'
  | 'x'
  // PR #88 — Sprint 7.12: TikTok joins as a first-class platform
  // with 3 content types seeded (photo, ugc, carousel).
  | 'tiktok';

const PLATFORMS: Platform[] = [
  'instagram',
  'facebook',
  'linkedin',
  'reddit',
  'threads',
  'x',
  'tiktok',
];

// Capability map — keys match the seeded content-type rows
// (Instagram: reel/carousel/photo/ugc; Facebook: reel/photo/
// community_post; LinkedIn: text_post/carousel/single_image;
// Reddit: self_post/link_post; Threads: text_post/photo; X:
// single_tweet/thread; TikTok: photo/ugc/carousel). Anything not
// in here renders without badges, which is correct for plain
// text formats.
//
// Type keys are SHARED across platforms (e.g. 'photo' on
// Instagram, Threads, AND TikTok all flow through Flux; 'ugc' on
// Instagram + TikTok both queue HeyGen). Adding TikTok was a
// pure data change — no UI fork needed.
const FLUX_TYPES = new Set([
  'carousel',
  'photo',
  'single_image',
]);
const HEYGEN_TYPES = new Set(['reel', 'ugc']);

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
  structuredContent: unknown;
  // PR Sprint 7.13 hotfix v2 (BUG 2) — endpoint now returns the
  // brand-fit score per draft so the card can render the badge
  // immediately without a Library refetch.
  consistencyScore?: number | null;
  error?: string;
  errorKind?: string;
  errorHint?: string;
  errorRetry?: boolean;
}

type ErrorKind =
  | 'overloaded'
  | 'rate_limit'
  | 'timeout'
  | 'json'
  | 'auth'
  | 'insufficient_context'
  | 'unknown';

interface CategorizedError {
  message: string;
  kind: ErrorKind;
  retry: boolean;
  hint: string;
}

const ERROR_DISPLAY: Record<
  ErrorKind,
  { icon: string; title: string; defaultHint: string }
> = {
  overloaded: {
    icon: '⏳',
    title: 'Anthropic is overloaded',
    defaultHint: 'Wait ~1 minute and retry.',
  },
  rate_limit: {
    icon: '🚦',
    title: 'Too many requests too fast',
    defaultHint: 'Wait ~30 seconds before the next attempt.',
  },
  timeout: {
    icon: '⏱️',
    title: 'Generation took too long',
    defaultHint: 'Retry — the network may have been the issue.',
  },
  json: {
    icon: '🔧',
    title: 'Opus returned malformed output',
    defaultHint: 'Retry — this is transient.',
  },
  auth: {
    icon: '🔐',
    title: 'Technical issue with the AI service',
    defaultHint: 'Contact support.',
  },
  insufficient_context: {
    icon: '📝',
    title: 'Brand context missing',
    defaultHint:
      'Fill out the brand bible (niche + audience) so Opus has material to work with.',
  },
  unknown: {
    icon: '😞',
    title: 'Something failed during generation',
    defaultHint: 'Retry once more.',
  },
};

interface Props {
  projectId: string;
}

export function StructuredGeneratePanel({ projectId }: Props) {
  const router = useRouter();
  const [platform, setPlatform] = useState<Platform>('instagram');
  const [types, setTypes] = useState<ContentTypeRow[]>([]);
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState<CategorizedError | null>(null);
  const [loadingTypes, setLoadingTypes] = useState(false);

  // Hydrate prefs once on mount. Same pattern as
  // StructuredDraftsPanel — the lookup is cheap and per-project.
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

  // Load templates when platform changes.
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
        setTypes(data.types ?? []);
      } catch {
        if (!cancelled) setTypes([]);
      } finally {
        if (!cancelled) setLoadingTypes(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [platform]);

  // Apply preferences when platform + types both ready. Same
  // split-effect pattern as StructuredDraftsPanel (PR #61 fixed
  // the feedback loop by NOT depending on `preferences` here).
  useEffect(() => {
    if (types.length === 0) return;
    const pref = preferences.find((p) => p.platform === platform);
    if (pref) {
      const valid = new Set(types.map((r) => r.type));
      setSelected(pref.enabledTypes.filter((t) => valid.has(t)));
    } else {
      setSelected(types.filter((r) => r.defaultEnabled).map((r) => r.type));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform, types]);

  const persistSelection = async (next: string[]) => {
    try {
      await fetch(`/api/projects/${projectId}/content-preferences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, enabledTypes: next }),
      });
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

  const hasVideoSelection = selected.some((t) => HEYGEN_TYPES.has(t));

  const generate = async () => {
    if (selected.length === 0 || !prompt.trim()) return;
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
        errorKind?: ErrorKind;
        hint?: string;
        retry?: boolean;
      };
      if (!res.ok || !data.success) {
        const kind: ErrorKind = data.errorKind ?? 'unknown';
        setError({
          kind,
          message: data.error ?? 'Could not generate drafts',
          retry: data.retry ?? true,
          hint: data.hint ?? ERROR_DISPLAY[kind].defaultHint,
        });
        return;
      }
      setDrafts(data.drafts ?? []);
      // PR #76 — Sprint 7.3: server-side router.refresh so the
      // /marketing/library tab (when the founder navigates there)
      // picks up the new rows without a full reload.
      router.refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Network error';
      setError({
        kind: 'unknown',
        message,
        retry: true,
        hint: ERROR_DISPLAY.unknown.defaultHint,
      });
    } finally {
      setGenerating(false);
    }
  };

  const buttonLabel = useMemo(() => {
    if (generating) {
      return `Generating ${selected.length} draft${selected.length === 1 ? '' : 's'}…`;
    }
    if (selected.length === 0) return 'Pick a type first';
    return `Generate ${selected.length} structured draft${selected.length === 1 ? '' : 's'}`;
  }, [generating, selected.length]);

  const estimatedSeconds = 15 + selected.length * 10;

  return (
    <section className="space-y-5">
      <div>
        <h2 className="font-display text-2xl font-light tracking-tight">
          Generate
        </h2>
        <p className="text-sm text-text-3 mt-1">
          Per-platform structured drafts. Opus 4.7 writes; Flux generates
          images on-demand from each draft; HeyGen for videos (coming
          soon).
        </p>
      </div>

      {/* Platform picker — single select. */}
      <div>
        <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
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

      {/* Content types with Flux / HeyGen badges. */}
      <GlassCard className="p-4">
        <div className="flex items-baseline justify-between mb-3">
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3">
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
              const isFlux = FLUX_TYPES.has(t.type);
              const isHeygen = HEYGEN_TYPES.has(t.type);
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
                    className="mt-1"
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
                    {(isFlux || isHeygen) && (
                      <div className="flex gap-1.5 mt-2 flex-wrap">
                        {isFlux && (
                          <span className="text-[9px] font-mono uppercase tracking-[0.1em] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-500 border border-blue-500/30">
                            🎨 Flux image (on-demand)
                          </span>
                        )}
                        {isHeygen && (
                          <span className="text-[9px] font-mono uppercase tracking-[0.1em] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-500 border border-purple-500/30">
                            🎬 HeyGen video (queued)
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        )}
        <p className="text-xs text-text-3 mt-3">
          1 structured draft per selected type (Opus 4.7). Flux images are
          generated on-demand per carousel from the Library. HeyGen videos
          land in a queue — the live integration ships soon.
        </p>
      </GlassCard>

      {/* Prompt. */}
      <div>
        <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
          What to post about
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe what this batch should cover. Brand bible + voice fingerprint load automatically."
          rows={5}
          className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm placeholder:text-text-3 focus:outline-none focus:border-border-bright resize-none"
        />
      </div>

      {/* Generate button + meta. */}
      <div>
        <Button
          onClick={generate}
          disabled={generating || selected.length === 0 || !prompt.trim()}
        >
          {buttonLabel}
        </Button>
        {selected.length > 0 && (
          <p className="text-xs text-text-3 mt-2">
            Estimated: ~{estimatedSeconds}s
            {hasVideoSelection && (
              <span>
                {' '}
                · videos queue up — HeyGen ships in a future sprint.
              </span>
            )}
          </p>
        )}
      </div>

      {/* Categorized error UI. */}
      {error && (
        <div className="p-4 rounded-lg border border-danger/30 bg-danger/5">
          <div className="flex items-start gap-3">
            <div className="text-2xl shrink-0" aria-hidden>
              {ERROR_DISPLAY[error.kind].icon}
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="font-medium text-sm text-text-1">
                {ERROR_DISPLAY[error.kind].title}
              </h4>
              {error.message && (
                <p className="text-xs font-mono text-text-3 mt-1">
                  {error.message.slice(0, 200)}
                </p>
              )}
              <p className="text-sm text-text-2 mt-1">{error.hint}</p>
              {error.retry && (
                <button
                  type="button"
                  onClick={generate}
                  className="text-xs text-accent underline hover:no-underline mt-2"
                >
                  Reintentar
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Generated drafts. */}
      {drafts.length > 0 && (
        <div className="space-y-3 pt-2">
          <div className="flex items-baseline justify-between">
            <h3 className="font-display text-lg font-light">
              Generated drafts
            </h3>
            <span className="text-xs font-mono text-text-3">
              {drafts.length} produced ·{' '}
              <a
                href="/marketing/library"
                className="text-accent hover:underline"
              >
                view in library →
              </a>
            </span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {drafts.map((d, i) => {
              const key = d.id || `${d.contentType}-${i}`;
              return (
                <StructuredDraftErrorBoundary
                  key={key}
                  label={`${platform}/${d.contentType}`}
                >
                  <StructuredDraftCard
                    platform={platform}
                    contentType={d.contentType}
                    displayName={d.displayName}
                    structuredContent={d.structuredContent}
                    error={d.error}
                    draftId={d.id || undefined}
                    consistencyScore={d.consistencyScore ?? null}
                    projectId={projectId}
                  />
                </StructuredDraftErrorBoundary>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
