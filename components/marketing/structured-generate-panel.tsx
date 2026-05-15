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
import { useRouter, useSearchParams } from 'next/navigation';
import { GlassCard } from '@/components/ui/glass-card';
import { Button } from '@/components/ui/button';
import { StructuredDraftCard } from './StructuredDraftCard';
import { StructuredDraftErrorBoundary } from './StructuredDraftErrorBoundary';
import { GenerationProgress } from './generation-progress';

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
  // PR Sprint 7.24 — Prompt 3. Variant chip + group binding for
  // the A/B pair shown side-by-side in the Library.
  variantLabel?: 'A' | 'B' | null;
  variantGroupId?: string | null;
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
    title: 'AI is busy right now',
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
    title: 'AI returned malformed output',
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
      'Fill out the brand bible (niche + audience) so Helm has material to work with.',
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
  // PR Sprint 7.21 — pre-fill the prompt textarea when the founder
  // arrives from a Research pain-point card. PainPointCard builds:
  //   /marketing/generate?projectId=...&prompt=<urlencoded>
  // We read the param into the initial state via a lazy useState
  // initializer so the textarea opens with the seed already in
  // place. After mount the state is fully user-controlled — typing
  // overwrites the seed and the Generate call uses the latest text.
  const searchParams = useSearchParams();
  const incomingPrompt = searchParams.get('prompt') ?? '';

  const [platform, setPlatform] = useState<Platform>('instagram');
  const [types, setTypes] = useState<ContentTypeRow[]>([]);
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [prompt, setPrompt] = useState<string>(() => incomingPrompt);
  const [generating, setGenerating] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState<CategorizedError | null>(null);
  const [loadingTypes, setLoadingTypes] = useState(false);

  // When we arrive with a pre-filled prompt, scroll the textarea
  // into view so the founder immediately sees what was loaded —
  // /marketing/generate has the brand bible + content-type grid
  // above the textarea, and on a fresh viewport the seed would
  // otherwise be below the fold. Smooth + center keeps the
  // platform picker still visible for context.
  useEffect(() => {
    if (incomingPrompt) {
      document.getElementById('prompt-textarea')?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
    // We intentionally run this once on mount only — the
    // dependency on `incomingPrompt` is stable for the lifetime
    // of this navigation; we don't want repeated re-scrolls if
    // the user later edits the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // PR Sprint 7.24 — Prompt 3. For every (platform, contentType)
  // the founder picks, fire TWO parallel generate-structured calls
  // — one tagged variantLabel='A' (direct/factual hook style) and
  // one tagged variantLabel='B' (story/question hook style). Both
  // share a variantGroupId so the Library can render them as a
  // side-by-side pair ("pick your favorite, delete the other").
  //
  // Helm absorbs the cost of doubling Opus calls on every generate
  // run — margins justify it and the optionality is worth more
  // than the extra ~$0.05 per generate.
  //
  // Parallel via Promise.all so total wall-clock matches a single
  // run; the anthropic cached system prompt hits the cache on the
  // second request anyway.
  //
  // After both responses land, auto-trigger image generation for
  // every visual content type (carousel / photo / single_image)
  // via /api/visuals/generate. Fire-and-forget — the founder no
  // longer has to click "+ Add visual" on each card. The card
  // shows a placeholder spinner until imageUrl populates via
  // router.refresh after Library reload.
  const generate = async () => {
    if (selected.length === 0 || !prompt.trim()) return;
    setError(null);
    setGenerating(true);
    setDrafts([]);
    try {
      const variantGroupId = crypto.randomUUID();
      const baseBody = {
        projectId,
        platform,
        types: selected,
        prompt: prompt.trim(),
        variantGroupId,
      };

      // Fire both variants in parallel. Each call returns its own
      // response shape; we merge both `drafts` arrays into a single
      // list of 2×N drafts.
      const [resA, resB] = await Promise.all([
        fetch('/api/ai/generate-structured', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...baseBody, variantLabel: 'A' }),
        }),
        fetch('/api/ai/generate-structured', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...baseBody, variantLabel: 'B' }),
        }),
      ]);

      type Resp = {
        success?: boolean;
        drafts?: Draft[];
        error?: string;
        errorKind?: ErrorKind;
        hint?: string;
        retry?: boolean;
      };
      const [dataA, dataB] = (await Promise.all([
        resA.json().catch(() => ({})) as Promise<Resp>,
        resB.json().catch(() => ({})) as Promise<Resp>,
      ])) as [Resp, Resp];

      const allOk =
        resA.ok && dataA.success && resB.ok && dataB.success;
      if (!allOk) {
        // Pick the first failure to surface — both halves usually
        // fail for the same reason (overload, rate limit) when
        // they fail at all.
        const failing = !resA.ok || !dataA.success ? dataA : dataB;
        const kind: ErrorKind = failing.errorKind ?? 'unknown';
        setError({
          kind,
          message: failing.error ?? 'Could not generate drafts',
          retry: failing.retry ?? true,
          hint: failing.hint ?? ERROR_DISPLAY[kind].defaultHint,
        });
        // Show whichever variant did succeed if any (degrade
        // gracefully — the founder can still keep the working half).
        const partial = [
          ...((resA.ok && dataA.success ? dataA.drafts : []) ?? []),
          ...((resB.ok && dataB.success ? dataB.drafts : []) ?? []),
        ];
        if (partial.length > 0) setDrafts(partial);
        return;
      }

      const merged: Draft[] = [
        ...(dataA.drafts ?? []),
        ...(dataB.drafts ?? []),
      ];
      setDrafts(merged);

      // PR Sprint 7.24 — Prompt 3. Auto-generate images for visual
      // content types (carousel / photo / single_image). The
      // founder previously had to click "+ Add visual" on each
      // card; that confirmation step is gone — Helm absorbs the
      // ~$0.05 per image. Fire-and-forget: the request returns
      // immediately, the imageUrl populates on the row in
      // background, and the card surfaces it on the next refresh.
      //
      // We skip UGC + reel (HeyGen handles the video; the cover
      // image is a future polish). Carousel slides are generated
      // via the separate slide-generation endpoint as part of
      // Calendar/Library flows, so we don't kick those off here.
      const VISUAL_TYPES = new Set(['photo', 'single_image']);
      for (const d of merged) {
        if (!d.id) continue; // skip error drafts
        if (!VISUAL_TYPES.has(d.contentType)) continue;
        void fetch('/api/visuals/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId,
            platform,
            postContent: prompt.trim(),
            draftId: d.id,
            painPoint: prompt.trim(),
            contentType: 'photo',
          }),
        }).catch(() => {
          /* fire-and-forget — surfaced when Library re-renders */
        });
      }

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

  // PR Sprint 7.24 — Prompt 3. We now produce 2 drafts per content
  // type (variants A + B) so the count surfaces as 2N.
  const variantCount = selected.length * 2;
  const buttonLabel = useMemo(() => {
    if (generating) {
      return `Generating ${variantCount} draft${variantCount === 1 ? '' : 's'}…`;
    }
    if (selected.length === 0) return 'Pick a type first';
    return `Generate ${variantCount} structured draft${variantCount === 1 ? '' : 's'}`;
  }, [generating, selected.length, variantCount]);

  const estimatedSeconds = 15 + selected.length * 10;

  return (
    <section className="space-y-5">
      <div>
        <h2 className="font-display text-2xl font-light tracking-tight">
          Generate
        </h2>
        <p className="text-sm text-text-3 mt-1">
          Per-platform structured drafts. Images and videos generated
          on-demand from each draft.
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
                            🎨 AI image
                          </span>
                        )}
                        {isHeygen && (
                          <span className="text-[9px] font-mono uppercase tracking-[0.1em] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-500 border border-purple-500/30">
                            🎬 AI video
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
          2 variants per selected type — pick your favorite, delete the other.
        </p>
      </GlassCard>

      {/* Prompt. */}
      <div>
        <label
          htmlFor="prompt-textarea"
          className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2 block"
        >
          What to post about
        </label>
        <textarea
          id="prompt-textarea"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe what this batch should cover. Brand bible + voice fingerprint load automatically."
          rows={5}
          className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm placeholder:text-text-3 focus:outline-none focus:border-border-bright resize-none"
        />
        {/* PR Sprint 7.21 — provenance hint when the founder
            arrived from a Research pain-point card. Reads the
            URL param directly so the badge surfaces independent
            of whether the user has since edited the seed text. */}
        {incomingPrompt && (
          <p className="text-[11px] text-text-3 mt-1.5">
            ✦ Pre-filled from Research pain point
          </p>
        )}
      </div>

      {/* Generate button + meta. */}
      <div>
        <Button
          onClick={generate}
          disabled={generating || selected.length === 0 || !prompt.trim()}
        >
          {buttonLabel}
        </Button>
        {selected.length > 0 && !generating && (
          <p className="text-xs text-text-3 mt-2">
            Estimated: ~{estimatedSeconds}s
            {hasVideoSelection && <span> · videos coming soon.</span>}
          </p>
        )}
        {/* PR Sprint 7.19 — visible progress while generating.
            Replaces the silent ~35s gap between click and result.
            Auto-unmounts when `generating` flips back to false. */}
        {generating && (
          <GenerationProgress
            estimatedSeconds={estimatedSeconds}
            includeImages={selected.some((t) => FLUX_TYPES.has(t))}
          />
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
                    variantLabel={d.variantLabel ?? null}
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
