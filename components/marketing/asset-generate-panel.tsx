'use client';

// PR Sprint 7.26 — Asset-based content flow.
//
// Replaces StructuredGeneratePanel (PR #76) as the primary generate
// surface. The old panel still exists in the repo for revertability
// — but /marketing/generate now renders this one.
//
// Mental model shift:
//   OLD: pick a platform, pick content types, generate N drafts
//        (one row per content type, one image / video per row,
//        N×cost).
//   NEW: pick what KIND of asset you want (UGC Video / Reel /
//        Carousel / Photo / Long-form Text). Pick the platforms
//        to publish to (filtered by what's compatible with the
//        asset type). Helm generates the asset ONCE and adapts a
//        caption per platform.
//
// Three sequential steps shown stacked:
//   1) Asset type — 5 large cards.
//   2) Platforms — checkboxes for the asset's allowed networks
//      (incompatible networks shown grayed-out with a tooltip).
//   3) Prompt — what the asset should cover.
//   4) Generate — fires POST /api/ai/generate-asset.
//
// On success: rows land in /marketing/library grouped by asset.

import { useMemo, useState } from 'react';
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
  posts: Array<{
    id: string;
    platform: string;
    caption: string;
  }>;
}

export function AssetGeneratePanel({ projectId }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const incomingPrompt = searchParams.get('prompt') ?? '';

  const [assetType, setAssetType] = useState<AssetType | null>(null);
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>([]);
  const [prompt, setPrompt] = useState<string>(() => incomingPrompt);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GeneratedAsset | null>(null);

  // When the asset type changes, prune any selected platforms that
  // are no longer compatible — and pre-select all compatible ones
  // (founder usually wants every supported network checked by
  // default; they can de-select if they want fewer).
  const pickAssetType = (next: AssetType) => {
    setAssetType(next);
    setSelectedPlatforms([...PLATFORM_RULES[next]]);
    setError(null);
    setResult(null);
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
    !generating;

  const buttonLabel = useMemo(() => {
    if (generating) return 'Generating asset…';
    if (!assetType) return 'Pick an asset type first';
    if (selectedPlatforms.length === 0) return 'Pick at least one platform';
    if (prompt.trim().length === 0) return 'Tell Helm what it\'s about';
    const n = selectedPlatforms.length;
    return `Generate · ${n} caption${n === 1 ? '' : 's'} adapted`;
  }, [generating, assetType, selectedPlatforms.length, prompt]);

  const generate = async () => {
    if (!canGenerate || !assetType) return;
    setGenerating(true);
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
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        asset?: { id: string; assetType: AssetType };
        posts?: Array<{ id: string; platform: string; caption: string }>;
        error?: string;
      };
      if (!res.ok || !data.success || !data.asset) {
        setError(data.error ?? `Generation failed (HTTP ${res.status})`);
        return;
      }
      setResult({
        assetId: data.asset.id,
        assetType: data.asset.assetType,
        posts: data.posts ?? [],
      });
      // Push the Library view to refresh in the background so by
      // the time the founder navigates over, the new asset is
      // already there.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setGenerating(false);
    }
  };

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
          <Button onClick={generate} disabled={!canGenerate}>
            {buttonLabel}
          </Button>
          {assetType && selectedPlatforms.length > 0 && !generating && (
            <p className="text-xs text-text-3 mt-2">
              1 asset generated · {selectedPlatforms.length} caption
              {selectedPlatforms.length === 1 ? '' : 's'} adapted per
              platform.
            </p>
          )}
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
            onClick={generate}
            className="text-xs text-accent underline hover:no-underline mt-2"
          >
            Retry
          </button>
        </div>
      )}

      {/* Success preview */}
      {result && (
        <div className="space-y-3 pt-2 border-t border-border">
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
