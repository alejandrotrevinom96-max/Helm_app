'use client';

// PR #27 — Sprint 4: Image validation loop.
//
// Section rendered in the Brand Bible modal AFTER an auto-generated
// bible has been applied. The user clicks "Generate 12 images", we
// fire off the batch endpoint, and they vote 👍/👎 on each context
// to confirm Helm understood their brand.
//
// Vote data feeds into the future re-generation pass (Sprint 4.5):
// thumbs-down patterns will adjust prompts.
//
// We DON'T poll while generation runs — fal.ai is sequential server-
// side and the route's max duration is high enough to wait. Showing a
// "Generating…" pseudo-progress button is honest because we don't
// have intermediate frames.
import { useEffect, useState } from 'react';
import { Sparkles, ThumbsUp, ThumbsDown, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { BrandImageValidation } from '@/lib/db/schema';

interface Props {
  projectId: string;
  // Bible existence is enforced server-side (the POST returns 400 if
  // there's not enough signal); we still expose this prop so the
  // parent can hide the section entirely until a bible is in place.
  enabled: boolean;
}

const COST_PER_IMAGE = 0.05;
const BATCH_SIZE = 12;

type ImageRow = BrandImageValidation;

export function ImageValidationSection({ projectId, enabled }: Props) {
  const [images, setImages] = useState<ImageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batchSummary, setBatchSummary] = useState<string | null>(null);

  const refetch = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/brand-bible/validation-batch?projectId=${projectId}`
      );
      const data = (await res.json()) as { images?: ImageRow[] };
      setImages(data.images ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (projectId && enabled) refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, enabled]);

  const handleGenerate = async () => {
    if (
      !confirm(
        `Generate ${BATCH_SIZE} validation images? Estimated cost ~$${(
          BATCH_SIZE * COST_PER_IMAGE
        ).toFixed(2)} on your fal.ai account. Takes ~30 seconds.`
      )
    ) {
      return;
    }
    setGenerating(true);
    setError(null);
    setBatchSummary(null);
    try {
      const res = await fetch('/api/brand-bible/validation-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        images?: ImageRow[];
        totalCost?: number;
        // PR #27 legacy + PR #28 canonical names.
        succeeded?: number;
        requested?: number;
        generatedCount?: number;
        expectedCount?: number;
        partial?: boolean;
        error?: string;
      };
      if (!res.ok || !data.success) {
        setError(data.error ?? 'Generation failed');
        return;
      }
      // Merge new batch on top of older history.
      setImages((prev) => [...(data.images ?? []), ...prev]);

      const cost = (data.totalCost ?? 0).toFixed(2);
      const got = data.generatedCount ?? data.succeeded ?? 0;
      const want = data.expectedCount ?? data.requested ?? BATCH_SIZE;
      // PR #28 — distinguish full vs. partial. Partial gets a yellow
      // tint via the error slot so the warning lands; success uses
      // the green tint already wired up.
      if (data.partial && got > 0) {
        setBatchSummary(
          `Generated ${got} of ${want} images · $${cost} total. Some contexts failed — re-generate to fill the gaps.`
        );
      } else {
        setBatchSummary(
          `Generated ${got}/${want} images · $${cost} total`
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setGenerating(false);
    }
  };

  const handleVote = async (
    imageId: string,
    nextVote: 'positive' | 'negative'
  ) => {
    // Optimistic update. The server is the source of truth — if it
    // 4xxs we revert below.
    const previous = images.find((i) => i.id === imageId);
    if (!previous) return;
    // Toggle off when clicking the same vote again.
    const targetVote =
      previous.vote === nextVote ? null : nextVote;

    setImages((prev) =>
      prev.map((i) =>
        i.id === imageId
          ? {
              ...i,
              vote: targetVote,
              votedAt: targetVote ? new Date().toISOString() : null,
            } as ImageRow
          : i
      )
    );

    try {
      const res = await fetch(
        `/api/brand-bible/validation-images/${imageId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vote: targetVote }),
        }
      );
      if (!res.ok) {
        // Revert.
        setImages((prev) =>
          prev.map((i) => (i.id === imageId ? previous : i))
        );
      }
    } catch {
      setImages((prev) =>
        prev.map((i) => (i.id === imageId ? previous : i))
      );
    }
  };

  // Show the latest batch only — older batches stay in the DB but
  // showing them all would clutter the modal. Future PR could add a
  // "history" toggle.
  const latestBatchId = images.length > 0 ? images[0].batchId : null;
  const latestBatch = latestBatchId
    ? images.filter((i) => i.batchId === latestBatchId)
    : [];

  const votedCount = latestBatch.filter((i) => i.vote).length;
  const positiveCount = latestBatch.filter((i) => i.vote === 'positive').length;
  const negativeCount = latestBatch.filter((i) => i.vote === 'negative').length;

  if (!enabled) {
    // Defensive: parent should hide the whole section, but this guard
    // prevents accidental render-without-bible from confusing users.
    return null;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="flex items-start gap-3">
          <Sparkles className="w-5 h-5 text-accent mt-0.5 shrink-0" />
          <div>
            <h3 className="font-display text-lg font-light mb-1">
              Validate visually
            </h3>
            <p className="text-sm text-text-2 leading-relaxed">
              Generate 12 images across realistic marketing surfaces and
              vote 👍/👎 to confirm Helm read your brand right. Votes feed
              into future regenerations.
            </p>
          </div>
        </div>
        <Button
          size="sm"
          onClick={handleGenerate}
          disabled={generating}
          className="self-start whitespace-nowrap"
        >
          {generating ? (
            <span className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              {/* PR #28 — chunked engine cuts wall time to ~20-30s.
                  Honest message: "in parallel" hints at why. */}
              Generating in parallel (~30s)…
            </span>
          ) : latestBatch.length > 0 ? (
            <span className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4" />
              Re-generate batch
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              Generate 12 images (~${(BATCH_SIZE * COST_PER_IMAGE).toFixed(
                2
              )})
            </span>
          )}
        </Button>
      </div>

      {error && (
        <div className="p-3 border border-danger/30 bg-danger/10 rounded-lg text-xs text-danger">
          {error}
        </div>
      )}
      {batchSummary && !error && (
        // PR #28 — yellow tint when the summary mentions partial
        // generation, green when it's a full batch. We sniff the
        // string for the partial sentence rather than tracking a
        // separate state since this lives in one render path.
        <div
          className={`p-3 border rounded-lg text-xs ${
            batchSummary.includes('Some contexts failed')
              ? 'border-amber-500/30 bg-amber-500/10 text-amber-500'
              : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
          }`}
        >
          {batchSummary}
        </div>
      )}

      {latestBatch.length > 0 && (
        <div className="flex items-center gap-4 px-3 py-2 bg-bg-elev/50 border border-border rounded-lg text-xs">
          <span className="text-text-3">
            Voted {votedCount}/{latestBatch.length}
          </span>
          <span className="flex items-center gap-1 text-emerald-500">
            <ThumbsUp className="w-3 h-3" /> {positiveCount}
          </span>
          <span className="flex items-center gap-1 text-danger">
            <ThumbsDown className="w-3 h-3" /> {negativeCount}
          </span>
        </div>
      )}

      {loading ? (
        <div className="text-center py-8 text-text-3 text-sm">
          Loading validation images…
        </div>
      ) : latestBatch.length === 0 ? (
        <div className="p-8 border border-dashed border-border rounded-lg text-center">
          <p className="text-sm text-text-2 mb-1">No validation batch yet.</p>
          <p className="text-xs text-text-3">
            Click <em>Generate 12 images</em> to see how Helm interprets your
            brand visually across 12 marketing contexts.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {latestBatch.map((image) => (
            <ValidationImageCard
              key={image.id}
              image={image}
              onVote={(v) => handleVote(image.id, v)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ValidationImageCard({
  image,
  onVote,
}: {
  image: ImageRow;
  onVote: (v: 'positive' | 'negative') => void;
}) {
  const isPositive = image.vote === 'positive';
  const isNegative = image.vote === 'negative';

  return (
    <div className="bg-bg-elev/60 border border-border rounded-lg overflow-hidden flex flex-col">
      <div className="aspect-square bg-bg relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.imageUrl}
          alt={image.contextLabel}
          className="w-full h-full object-cover"
          loading="lazy"
        />
        {image.vote && (
          <div className="absolute top-2 right-2">
            <span
              className={`p-1.5 rounded-full ring-2 ring-bg-elev ${
                isPositive
                  ? 'bg-emerald-500 text-white'
                  : 'bg-danger text-white'
              }`}
            >
              {isPositive ? (
                <ThumbsUp className="w-3 h-3" />
              ) : (
                <ThumbsDown className="w-3 h-3" />
              )}
            </span>
          </div>
        )}
        <div className="absolute top-2 left-2 text-[9px] font-mono uppercase tracking-[0.1em] bg-bg/80 backdrop-blur-sm px-1.5 py-0.5 rounded">
          {image.contextDimensions}
        </div>
      </div>

      <div className="p-3">
        <div className="font-medium text-sm mb-2 truncate">
          {image.contextLabel}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onVote('positive')}
            className={`flex-1 py-1.5 rounded border text-xs flex items-center justify-center gap-1 transition-colors ${
              isPositive
                ? 'bg-emerald-500/20 border-emerald-500 text-emerald-500'
                : 'border-border hover:border-emerald-500 hover:text-emerald-500'
            }`}
            aria-label="Vote positive"
          >
            <ThumbsUp className="w-3 h-3" />
            Yes
          </button>
          <button
            type="button"
            onClick={() => onVote('negative')}
            className={`flex-1 py-1.5 rounded border text-xs flex items-center justify-center gap-1 transition-colors ${
              isNegative
                ? 'bg-danger/20 border-danger text-danger'
                : 'border-border hover:border-danger hover:text-danger'
            }`}
            aria-label="Vote negative"
          >
            <ThumbsDown className="w-3 h-3" />
            No
          </button>
        </div>
      </div>
    </div>
  );
}
