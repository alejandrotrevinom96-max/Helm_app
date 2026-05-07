// PR #30 — Sprint 5.2: Instagram Stories.
//
// Pure-functions for classifying an image's aspect ratio against
// Meta's per-surface recommendations. Lives server-side AND
// client-side: the React StoryToggle uses the same rules to warn
// the user before scheduling, and the schedule endpoint will
// re-evaluate them as a failsafe.
//
// We don't fetch the image bytes here. The client uses Image()
// onload to read width/height; if the server ever needs to verify
// it can plug in `image-size` or `sharp` — out of scope for this PR.

export interface ImageDimensions {
  width: number;
  height: number;
  aspectRatio: number;
  recommendedFor: Array<'feed' | 'story' | 'reel'>;
}

// Story = portrait 9:16 ≈ 0.5625. Tolerate a small band so 0.50–0.62
// counts as "story-friendly" (covers 1080×1920 ≈ 0.5625 plus a few
// camera native ratios that crop cleanly).
const STORY_RATIO_MIN = 0.5;
const STORY_RATIO_MAX = 0.62;

// Feed accepts a wide range — landscape 1.91:1 down to portrait 4:5
// (≈ 0.8). We're lenient here on purpose; IG silently center-crops
// anything weird and the user can preview before posting.
const FEED_RATIO_MIN = 0.78;
const FEED_RATIO_MAX = 1.92;

export function classifyImage(width: number, height: number): ImageDimensions {
  const aspectRatio = width / height;
  const recommendedFor: Array<'feed' | 'story' | 'reel'> = [];
  if (aspectRatio >= STORY_RATIO_MIN && aspectRatio <= STORY_RATIO_MAX) {
    recommendedFor.push('story', 'reel');
  }
  if (aspectRatio >= FEED_RATIO_MIN && aspectRatio <= FEED_RATIO_MAX) {
    recommendedFor.push('feed');
  }
  return { width, height, aspectRatio, recommendedFor };
}

export function isStoryFriendly(dim: ImageDimensions): boolean {
  return dim.recommendedFor.includes('story');
}

export function getStoryDimensionWarning(
  dim: ImageDimensions
): string | null {
  if (isStoryFriendly(dim)) return null;
  const ratio = dim.aspectRatio.toFixed(2);
  return `Image is ${dim.width}×${dim.height} (${ratio}:1). Stories work best at 9:16 (1080×1920). Image will be cropped or shown with bars.`;
}
