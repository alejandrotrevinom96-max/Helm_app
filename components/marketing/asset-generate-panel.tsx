'use client';

// PR Sprint 7.26 — Asset-based content flow.
// PR Sprint 7.27 — UGC A/B script picker + live render polling.
//
// Replaces StructuredGeneratePanel (PR #76) as the primary generate
// surface. The old panel still exists in the repo for revertability
// — but /marketing/generate now renders this one.
//
// Mental model:
//   1) Asset type — 5 large cards.
//   2) Platforms — checkboxes for the asset's allowed networks
//      (incompatible networks grayed-out with a tooltip).
//   3) Prompt — what the asset should cover.
//   4) Generate.
//
// UGC / Reel branch (Sprint 7.27): generation is a two-step flow:
//   a) POST /api/ai/generate-ugc-scripts → returns 2 Haiku script
//      variants (DIRECT vs STORY hook). Founder picks one.
//   b) POST /api/ai/generate-asset with `baseContentOverride` =
//      the chosen script. Endpoint skips its own script generator,
//      adapts captions per platform, queues HeyGen.
//   c) Panel polls /api/heygen/jobs?draftId=<firstId> every 5s
//      so the founder watches the render progress LIVE (queued →
//      processing → completed) and the final video embeds inline
//      when ready. Pre-fix the founder stared at "view in library"
//      with no signal HeyGen was even called.
//
// Other asset types stay on the single-step flow (they were never
// blocking — image / carousel renders are minutes-fast and the
// long-form path has no media at all).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { GlassCard } from '@/components/ui/glass-card';
import { Button } from '@/components/ui/button';
import {
  ASSET_TYPES,
  ASSET_TYPE_LABELS,
  ALL_PLATFORMS,
  PLATFORM_RULES,
  type AssetType,
  type Platform,
} from '@/lib/marketing/platform-rules';

interface Props {
  projectId: string;
}

const PLATFORM_DISPLAY: Record<Platform, string> = {
  instagram: 'Instagram',
  instagram_reels: 'Instagram Reels',
  facebook: 'Facebook',
  facebook_reels: 'Facebook Reels',
  linkedin: 'LinkedIn',
  reddit: 'Reddit',
  threads: 'Threads',
  x: 'X (Twitter)',
  tiktok: 'TikTok',
};

// Reasons we show in the tooltip when a platform is incompatible
// with the chosen asset type. Specific copy beats a generic
// "not supported" — the founder learns WHY each pairing makes /
// doesn't make sense.
function incompatibilityReason(
  type: AssetType,
  platform: Platform,
): string {
  if (type === 'ugc_video' || type === 'reel') {
    return 'Vertical video doesn\'t perform on this platform.';
  }
  if (type === 'carousel') {
    return 'No first-class multi-image post on this platform.';
  }
  if (type === 'photo') {
    return 'This platform is text-first — photos get suppressed.';
  }
  if (type === 'long_form_text') {
    return 'This platform is media-first — long captions get cut off.';
  }
  return 'Not supported for this asset type.';
}

interface GeneratedAsset {
  assetId: string;
  assetType: AssetType;
  baseContent: string;
  posts: Array<{
    id: string;
    platform: string;
    caption: string;
  }>;
}

interface ScriptVariant {
  label: 'A' | 'B';
  // Flat spoken text (what HeyGen reads + what shows in the
  // preview / library script block). For canonical-pipeline
  // variants this is the concatenation of UGCBundle.hook +
  // body[].text + cta.
  text: string;
  // PR Sprint 7.28 — extra metadata from the canonical pipeline.
  // wordCount + durationSeconds are surfaced in the picker chip;
  // bundle is forwarded back to /api/ai/generate-asset via
  // baseUgcBundleOverride so the structured bundle persists on
  // each generated_post.structuredContent for future surfaces.
  wordCount?: number;
  durationSeconds?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bundle?: any;
  parseKind?: 'ok' | 'repaired';
}

interface RenderStatus {
  status: 'queued' | 'processing' | 'completed' | 'failed';
  videoUrl: string | null;
  thumbnailUrl: string | null;
  errorMessage: string | null;
}

// State machine. Non-UGC types skip 'loading-scripts' and
// 'picking-script' — they jump straight from 'idle' to 'generating'
// on the Generate click.
type Phase =
  | 'idle'
  | 'loading-scripts'
  | 'picking-script'
  | 'generating'
  | 'rendering'
  | 'complete';

export function AssetGeneratePanel({ projectId }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const incomingPrompt = searchParams.get('prompt') ?? '';

  const [assetType, setAssetType] = useState<AssetType | null>(null);
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>([]);
  const [prompt, setPrompt] = useState<string>(() => incomingPrompt);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  // UGC A/B picker state — populated by POST
  // /api/ai/generate-ugc-scripts in 'loading-scripts' phase.
  const [scriptVariants, setScriptVariants] = useState<ScriptVariant[]>([]);

  // Final generation result (asset + per-platform captions). For
  // UGC this is set AFTER the founder picks a script. For others
  // it lands on the single-step generate path.
  const [result, setResult] = useState<GeneratedAsset | null>(null);

  // Live render polling state. Only meaningful when
  // phase === 'rendering' or 'complete' for ugc_video / reel.
  const [renderStatus, setRenderStatus] = useState<RenderStatus | null>(null);

  const isVideoAsset =
    assetType === 'ugc_video' || assetType === 'reel';

  // When the asset type changes, prune any selected platforms that
  // are no longer compatible — and pre-select all compatible ones
  // (founder usually wants every supported network checked by
  // default; they can de-select if they want fewer).
  const pickAssetType = (next: AssetType) => {
    setAssetType(next);
    setSelectedPlatforms([...PLATFORM_RULES[next]]);
    setError(null);
    setResult(null);
    setScriptVariants([]);
    setRenderStatus(null);
    setPhase('idle');
  };

  const togglePlatform = (p: Platform) => {
    if (!assetType) return;
    if (!PLATFORM_RULES[assetType].includes(p)) return;
    setSelectedPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    );
  };

  const canGenerate =
    assetType !== null &&
    selectedPlatforms.length > 0 &&
    prompt.trim().length > 0 &&
    (phase === 'idle' || phase === 'complete');

  // ─── Step 1a (UGC only): fetch A/B script variants ─────────────
  const loadScripts = async () => {
    if (!assetType || !isVideoAsset) return;
    setPhase('loading-scripts');
    setError(null);
    setScriptVariants([]);
    setResult(null);
    setRenderStatus(null);
    try {
      const res = await fetch('/api/ai/generate-ugc-scripts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          prompt: prompt.trim(),
          assetType,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        variants?: ScriptVariant[];
        error?: string;
      };
      if (!res.ok || !data.success || !data.variants?.length) {
        setError(data.error ?? `Script generation failed (${res.status})`);
        setPhase('idle');
        return;
      }
      setScriptVariants(data.variants);
      setPhase('picking-script');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
      setPhase('idle');
    }
  };

  // ─── Step 1b (UGC only): commit the chosen script + run the
  //     full asset generation ───────────────────────────────────
  //
  // Forward both the spoken text (becomes asset.baseContent +
  // HeyGen scriptText) AND the structured UGCBundle (persisted
  // on each generated_post.structuredContent so future surfaces
  // can render overlays / hashtags / caption from it).
  const commitScript = async (chosen: ScriptVariant) => {
    await runAssetGeneration(chosen.text, chosen.bundle);
  };

  // ─── Step 1 (non-UGC) OR Step 2 (UGC): create the asset row +
  //     captions, then start polling render for video assets.
  //     `baseContentOverride` is set ONLY for UGC committed
  //     scripts; non-UGC types pass undefined and let
  //     generate-asset run its own type-specific generator.
  const runAssetGeneration = async (
    baseContentOverride?: string,
    // PR Sprint 7.28 — when the override came from the A/B
    // picker, ALSO forward the structured UGCBundle so the
    // server persists it on each generated_post.structuredContent.
    // The bundle carries overlays + caption + hashtags that
    // would otherwise be discarded when we flatten to spoken
    // text for HeyGen.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    baseUgcBundleOverride?: any,
  ) => {
    if (!assetType || selectedPlatforms.length === 0 || !prompt.trim()) {
      return;
    }
    setPhase('generating');
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/ai/generate-asset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          assetType,
          platforms: selectedPlatforms,
          prompt: prompt.trim(),
          ...(baseContentOverride
            ? { baseContentOverride }
            : {}),
          ...(baseUgcBundleOverride
            ? { baseUgcBundleOverride }
            : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        asset?: { id: string; assetType: AssetType; baseContent?: string };
        posts?: Array<{ id: string; platform: string; caption: string }>;
        error?: string;
      };
      if (!res.ok || !data.success || !data.asset) {
        setError(data.error ?? `Generation failed (${res.status})`);
        setPhase('idle');
        return;
      }
      const newResult: GeneratedAsset = {
        assetId: data.asset.id,
        assetType: data.asset.assetType,
        baseContent: data.asset.baseContent ?? baseContentOverride ?? '',
        posts: data.posts ?? [],
      };
      setResult(newResult);
      router.refresh();

      if (isVideoAsset && newResult.posts.length > 0) {
        // Move to rendering phase — the polling effect below picks
        // it up and starts the heygen status poll.
        setRenderStatus({
          status: 'queued',
          videoUrl: null,
          thumbnailUrl: null,
          errorMessage: null,
        });
        setPhase('rendering');
      } else {
        setPhase('complete');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
      setPhase('idle');
    }
  };

  // Single entry-point for the Generate button. UGC kicks the A/B
  // flow; everything else goes straight to asset generation.
  const onGenerateClick = () => {
    if (!canGenerate) return;
    if (isVideoAsset) {
      void loadScripts();
    } else {
      void runAssetGeneration();
    }
  };

  // ─── Polling: heygen job status ────────────────────────────────
  //
  // Active during phase === 'rendering'. Polls every 5s against
  // /api/heygen/jobs?draftId=<firstPostId>. Stops on 'completed'
  // or 'failed'. Cleans up on unmount / phase change to avoid
  // leaking intervals.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (phase !== 'rendering' || !result || result.posts.length === 0) {
      stopPolling();
      return;
    }
    const firstId = result.posts[0].id;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(
          `/api/heygen/jobs?draftId=${encodeURIComponent(firstId)}`,
          { cache: 'no-store' },
        );
        if (!res.ok) return;
        const data = (await res.json().catch(() => ({}))) as {
          job?: {
            status?: string;
            videoUrl?: string | null;
            thumbnailUrl?: string | null;
            errorMessage?: string | null;
          } | null;
        };
        if (cancelled) return;
        const job = data.job;
        if (!job) return;
        const status =
          job.status === 'completed' ||
          job.status === 'failed' ||
          job.status === 'processing' ||
          job.status === 'queued'
            ? job.status
            : 'queued';
        setRenderStatus({
          status,
          videoUrl: job.videoUrl ?? null,
          thumbnailUrl: job.thumbnailUrl ?? null,
          errorMessage: job.errorMessage ?? null,
        });
        if (status === 'completed' || status === 'failed') {
          stopPolling();
          setPhase('complete');
        }
      } catch {
        /* transient — keep polling */
      }
    };
    // Fire immediately AND every 5s after.
    void tick();
    pollRef.current = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [phase, result, stopPolling]);

  // Cleanup on unmount.
  useEffect(() => () => stopPolling(), [stopPolling]);

  const buttonLabel = useMemo(() => {
    if (phase === 'loading-scripts') return 'Drafting 2 script variants…';
    if (phase === 'picking-script') return 'Pick a script below';
    if (phase === 'generating') return 'Generating asset…';
    if (phase === 'rendering') return 'Rendering video…';
    if (!assetType) return 'Pick an asset type first';
    if (selectedPlatforms.length === 0) return 'Pick at least one platform';
    if (prompt.trim().length === 0)
      return 'Tell Helm what it\'s about';
    const n = selectedPlatforms.length;
    if (isVideoAsset) {
      return `Draft 2 scripts → choose → render video`;
    }
    return `Generate · ${n} caption${n === 1 ? '' : 's'} adapted`;
  }, [
    phase,
    assetType,
    selectedPlatforms.length,
    prompt,
    isVideoAsset,
  ]);

  return (
    <section className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-light tracking-tight">
          Generate
        </h2>
        <p className="text-sm text-text-3 mt-1">
          One asset, multiple platforms. Helm renders the media once and
          adapts a caption per network.
        </p>
      </div>

      {/* STEP 1 — Asset type */}
      <div>
        <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-3">
          1. What kind of content?
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {ASSET_TYPES.map((t) => {
            const meta = ASSET_TYPE_LABELS[t];
            const active = assetType === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => pickAssetType(t)}
                className={`text-left p-4 rounded-xl border-2 transition-all ${
                  active
                    ? 'border-accent bg-accent/5 shadow-lg shadow-accent/10'
                    : 'border-border hover:border-border-bright bg-bg'
                }`}
                aria-pressed={active}
              >
                <div className="text-3xl mb-2" aria-hidden>
                  {meta.emoji}
                </div>
                <div className="font-medium text-base text-text-1">
                  {meta.title}
                </div>
                <div className="text-xs text-text-3 mt-1">
                  {meta.tagline}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* STEP 2 — Platforms (filtered) */}
      {assetType && (
        <GlassCard className="p-4">
          <div className="flex items-baseline justify-between mb-3">
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3">
              2. Where does it go?
            </div>
            <span className="text-[10px] font-mono text-text-3">
              {selectedPlatforms.length} selected
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {ALL_PLATFORMS.map((p) => {
              const compatible = PLATFORM_RULES[assetType].includes(p);
              const checked = selectedPlatforms.includes(p);
              const tooltip = compatible
                ? `Publish to ${PLATFORM_DISPLAY[p]}`
                : incompatibilityReason(assetType, p);
              return (
                <label
                  key={p}
                  title={tooltip}
                  className={`flex items-center gap-2 p-2.5 border rounded transition-colors ${
                    !compatible
                      ? 'opacity-40 cursor-not-allowed border-border'
                      : checked
                        ? 'border-accent bg-accent/5 cursor-pointer'
                        : 'border-border hover:border-border-bright cursor-pointer'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!compatible}
                    onChange={() => togglePlatform(p)}
                    aria-label={PLATFORM_DISPLAY[p]}
                  />
                  <span className="text-sm text-text-1">
                    {PLATFORM_DISPLAY[p]}
                  </span>
                </label>
              );
            })}
          </div>
          <p className="text-[11px] text-text-3 mt-3">
            Grayed-out platforms aren&apos;t a good fit for{' '}
            {ASSET_TYPE_LABELS[assetType].title.toLowerCase()} —{' '}
            hover for why.
          </p>
        </GlassCard>
      )}

      {/* STEP 3 — Prompt */}
      {assetType && selectedPlatforms.length > 0 && (
        <div>
          <label
            htmlFor="asset-prompt"
            className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2 block"
          >
            3. What should it be about?
          </label>
          <textarea
            id="asset-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe what this asset should cover. Brand bible + voice fingerprint load automatically."
            rows={4}
            className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm placeholder:text-text-3 focus:outline-none focus:border-border-bright resize-none"
          />
          {incomingPrompt && (
            <p className="text-[11px] text-text-3 mt-1.5">
              ✦ Pre-filled from Research pain point
            </p>
          )}
        </div>
      )}

      {/* STEP 4 — Generate */}
      {assetType && (
        <div>
          <Button onClick={onGenerateClick} disabled={!canGenerate}>
            {buttonLabel}
          </Button>
          {assetType &&
            selectedPlatforms.length > 0 &&
            phase === 'idle' && (
              <p className="text-xs text-text-3 mt-2">
                {isVideoAsset
                  ? '2 script variants drafted first — you pick before we render the video.'
                  : `1 asset generated · ${selectedPlatforms.length} caption${selectedPlatforms.length === 1 ? '' : 's'} adapted per platform.`}
              </p>
            )}
        </div>
      )}

      {/* Inline progress while scripts are loading */}
      {phase === 'loading-scripts' && (
        <div className="p-4 rounded-lg border border-border bg-bg-elev">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
            <div>
              <div className="text-sm text-text-1">
                Drafting 2 script variants…
              </div>
              <div className="text-xs text-text-3 mt-0.5">
                Haiku × 2 in parallel · usually 5-8s
              </div>
            </div>
          </div>
        </div>
      )}

      {/* A/B SCRIPT PICKER — only renders when phase is 'picking-script' */}
      {phase === 'picking-script' && scriptVariants.length > 0 && (
        <div className="space-y-3 pt-2 border-t border-border">
          <div>
            <h3 className="font-display text-lg font-light">
              Pick a script · A or B
            </h3>
            <p className="text-xs text-text-3 mt-1">
              Both pass our UGC prompt engineering (hook in 3s, one
              insight, 70-90 words). They differ in HOOK STYLE —
              direct vs story. Choose the take that fits your voice;
              the other gets dropped.
            </p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {scriptVariants.map((v) => (
              <button
                key={v.label}
                type="button"
                onClick={() => void commitScript(v)}
                className="text-left p-4 rounded-xl border-2 border-border hover:border-accent hover:bg-accent/5 transition-all bg-bg"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-mono uppercase tracking-[0.15em] font-bold px-2 py-0.5 rounded bg-accent/15 text-accent border border-accent/30">
                    Option {v.label} ·{' '}
                    {v.label === 'A' ? 'Direct hook' : 'Story hook'}
                  </span>
                  {/* PR Sprint 7.28 — when the canonical pipeline
                      ran, wordCount + durationSeconds come from
                      the server (computed off the parsed bundle).
                      Fall back to a client-side split for safety. */}
                  <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3">
                    {(v.wordCount ?? v.text.split(/\s+/).length)} words
                    {v.durationSeconds !== undefined && (
                      <span> · ~{v.durationSeconds}s</span>
                    )}
                  </span>
                </div>
                <p className="text-sm text-text-1 whitespace-pre-wrap leading-relaxed">
                  {v.text}
                </p>
                <div className="mt-3 text-[11px] font-mono uppercase tracking-[0.1em] text-accent">
                  → Use this script
                </div>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void loadScripts()}
            className="text-xs text-text-3 hover:text-text-1 underline"
          >
            ↻ Re-draft both
          </button>
        </div>
      )}

      {/* GENERATING — captions being adapted (after script committed
          for UGC, or directly after Generate click for other types). */}
      {phase === 'generating' && (
        <div className="p-4 rounded-lg border border-border bg-bg-elev">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
            <div>
              <div className="text-sm text-text-1">
                Adapting captions per platform…
              </div>
              <div className="text-xs text-text-3 mt-0.5">
                {selectedPlatforms.length} parallel Haiku call
                {selectedPlatforms.length === 1 ? '' : 's'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error surface */}
      {error && (
        <div className="p-4 rounded-lg border border-danger/30 bg-danger/5">
          <h4 className="font-medium text-sm text-text-1">
            Generation failed
          </h4>
          <p className="text-xs font-mono text-text-3 mt-1">
            {error.slice(0, 200)}
          </p>
          <button
            type="button"
            onClick={onGenerateClick}
            className="text-xs text-accent underline hover:no-underline mt-2"
          >
            Retry
          </button>
        </div>
      )}

      {/* SUCCESS PREVIEW + LIVE VIDEO RENDER */}
      {result && (phase === 'rendering' || phase === 'complete') && (
        <div className="space-y-4 pt-2 border-t border-border">
          <div className="flex items-baseline justify-between">
            <h3 className="font-display text-lg font-light">
              Asset generated · {result.posts.length} caption
              {result.posts.length === 1 ? '' : 's'}
            </h3>
            <a
              href="/marketing/library"
              className="text-xs text-accent hover:underline"
            >
              view in library →
            </a>
          </div>

          {/* SCRIPT — surfaces for UGC/reel so the founder sees what
              gets spoken on screen, separate from the platform
              captions below. */}
          {isVideoAsset && result.baseContent && (
            <div className="p-4 rounded-lg border border-amber-500/30 bg-amber-500/5">
              <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-amber-500 mb-2">
                🎥 Script · {result.baseContent.split(/\s+/).length} words
              </div>
              <p className="text-sm text-text-1 whitespace-pre-wrap leading-relaxed">
                {result.baseContent}
              </p>
            </div>
          )}

          {/* LIVE RENDER STATUS — UGC / reel only. The polling effect
              above keeps renderStatus fresh until HeyGen completes
              or fails. */}
          {isVideoAsset && renderStatus && (
            <div
              className={`p-4 rounded-lg border ${
                renderStatus.status === 'completed'
                  ? 'border-emerald-500/30 bg-emerald-500/5'
                  : renderStatus.status === 'failed'
                    ? 'border-danger/30 bg-danger/5'
                    : 'border-purple-500/30 bg-purple-500/5'
              }`}
            >
              {renderStatus.status === 'queued' && (
                <div className="flex items-center gap-3">
                  <div className="w-4 h-4 rounded-full border-2 border-purple-500 border-t-transparent animate-spin" />
                  <div>
                    <div className="text-sm text-purple-500">
                      Video queued
                    </div>
                    <div className="text-xs text-text-3 mt-0.5">
                      Pickup usually within 60s — the worker runs
                      every minute.
                    </div>
                  </div>
                </div>
              )}
              {renderStatus.status === 'processing' && (
                <div className="flex items-center gap-3">
                  <div className="w-4 h-4 rounded-full border-2 border-purple-500 border-t-transparent animate-spin" />
                  <div>
                    <div className="text-sm text-purple-500">
                      Rendering your video
                    </div>
                    <div className="text-xs text-text-3 mt-0.5">
                      Typically 2-5 minutes · the same render is
                      shared across all {result.posts.length} platforms.
                    </div>
                  </div>
                </div>
              )}
              {renderStatus.status === 'completed' && renderStatus.videoUrl && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-emerald-500">
                    <span>✓</span>
                    <span>Video ready</span>
                  </div>
                  <video
                    src={renderStatus.videoUrl}
                    controls
                    playsInline
                    preload="metadata"
                    poster={renderStatus.thumbnailUrl ?? undefined}
                    className="rounded-lg w-full max-w-md aspect-[9/16] object-cover bg-bg"
                  />
                  <div className="flex gap-2">
                    <a
                      href={renderStatus.videoUrl}
                      download
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:opacity-90"
                    >
                      ⬇ Download
                    </a>
                    <a
                      href="/marketing/library"
                      className="inline-flex items-center gap-2 px-3 py-1.5 bg-bg border border-border rounded-lg text-xs font-medium hover:bg-bg-elev"
                    >
                      Open in Library →
                    </a>
                  </div>
                </div>
              )}
              {renderStatus.status === 'failed' && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-danger">
                    <span>⚠</span>
                    <span>Render failed</span>
                  </div>
                  {renderStatus.errorMessage && (
                    <div className="text-xs text-text-3 font-mono break-words">
                      {renderStatus.errorMessage}
                    </div>
                  )}
                  <a
                    href="/marketing/library"
                    className="inline-block text-xs text-accent underline"
                  >
                    Retry from Library →
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Media-generation status for non-video asset types. */}
          {!isVideoAsset && phase === 'complete' && (() => {
            if (result.assetType === 'long_form_text') {
              return (
                <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 text-xs text-emerald-500">
                  ✓ Text asset complete. No media to render — the
                  body itself IS the asset.
                </div>
              );
            }
            if (result.assetType === 'photo') {
              return (
                <div className="p-3 rounded-lg border border-blue-500/30 bg-blue-500/5 text-xs text-blue-500">
                  🎨 Image generating in the background — usually
                  10-20s. Refresh{' '}
                  <a
                    href="/marketing/library"
                    className="underline hover:no-underline"
                  >
                    Library
                  </a>{' '}
                  to see the cover when it lands.
                </div>
              );
            }
            if (result.assetType === 'carousel') {
              return (
                <div className="p-3 rounded-lg border border-blue-500/30 bg-blue-500/5 text-xs text-blue-500">
                  🖼️ Carousel slides rendering — 5-8 images × ~5s
                  each, so 30-60s total. They&apos;ll show up in{' '}
                  <a
                    href="/marketing/library"
                    className="underline hover:no-underline"
                  >
                    Library
                  </a>{' '}
                  once the image generator finishes the batch.
                </div>
              );
            }
            return null;
          })()}

          {/* PER-PLATFORM CAPTIONS */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {result.posts.map((p) => (
              <div
                key={p.id}
                className="p-3 border border-border rounded-lg bg-bg-elev"
              >
                <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-accent mb-1.5">
                  {PLATFORM_DISPLAY[p.platform as Platform] ?? p.platform}
                </div>
                <p className="text-sm text-text-1 whitespace-pre-wrap line-clamp-6">
                  {p.caption}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
