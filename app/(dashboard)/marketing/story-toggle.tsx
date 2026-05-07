'use client';

// PR #30 — Sprint 5.2: Instagram Stories.
//
// Checkbox shown inside Generate's per-platform review panel. Only
// renders when the active draft platform is Instagram (Stories don't
// exist on the other surfaces). The checkbox toggles isStory on the
// parent's per-platform Generation state.
//
// Image dimension validation runs in the browser via the native
// Image() loader — works with any URL the visual generator produces
// (fal.ai, Supabase Storage, etc) without us shipping `sharp` to
// the client.
//
// Three states the user might land in:
//   1. No image yet + isStory checked → red error: "Stories require
//      an image"
//   2. Image present but not 9:16 + isStory checked → amber warning:
//      "Image is 1080×1080 (1.00:1). Stories work best at 9:16…"
//   3. Image present + 9:16 + isStory checked → silent (the toggle
//      itself is the only UI)
import { useEffect, useState } from 'react';
import { Instagram, AlertCircle } from 'lucide-react';
import {
  classifyImage,
  getStoryDimensionWarning,
} from '@/lib/meta/image-validator';

interface Props {
  platform: string;
  imageUrl?: string | null;
  isStory: boolean;
  onChange: (next: boolean) => void;
}

export function StoryToggle({
  platform,
  imageUrl,
  isStory,
  onChange,
}: Props) {
  // Only Instagram supports Stories via the Graph API. The schedule
  // endpoint enforces this server-side too — we hide here for UX.
  if (platform !== 'instagram') return null;

  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    // Only validate dimensions when the toggle is on AND there's
    // actually an image. The "no image" state has its own dedicated
    // error block below.
    if (!isStory || !imageUrl) {
      setWarning(null);
      return;
    }

    let cancelled = false;
    const img = new window.Image();
    img.crossOrigin = 'anonymous'; // most CDNs return CORS-friendly headers
    img.onload = () => {
      if (cancelled) return;
      const dim = classifyImage(img.naturalWidth, img.naturalHeight);
      setWarning(getStoryDimensionWarning(dim));
    };
    img.onerror = () => {
      if (cancelled) return;
      setWarning(
        'Could not load image to verify dimensions. Story upload may fail.'
      );
    };
    img.src = imageUrl;
    return () => {
      cancelled = true;
    };
  }, [isStory, imageUrl]);

  return (
    <div className="space-y-2 mt-3">
      <label className="flex items-start gap-3 cursor-pointer p-3 border border-border rounded-lg hover:border-accent transition-colors">
        <input
          type="checkbox"
          checked={isStory}
          onChange={(e) => onChange(e.target.checked)}
          className="w-4 h-4 mt-0.5 accent-accent"
        />
        <div className="flex items-start gap-2 flex-1 min-w-0">
          <Instagram className="w-4 h-4 text-pink-500 mt-0.5 shrink-0" />
          <div>
            <div className="text-sm font-medium">
              Post as Instagram Story
            </div>
            <div className="text-xs text-text-3">
              24h visible · 9:16 ratio recommended · Goes only to
              Instagram (not Facebook)
            </div>
          </div>
        </div>
      </label>

      {isStory && !imageUrl && (
        <div className="flex items-start gap-2 p-3 bg-danger/10 border border-danger/30 rounded-lg">
          <AlertCircle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
          <div className="text-xs text-danger">
            Stories require an image. Generate or attach one before
            scheduling.
          </div>
        </div>
      )}

      {isStory && imageUrl && warning && (
        <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
          <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-500">{warning}</div>
        </div>
      )}
    </div>
  );
}
