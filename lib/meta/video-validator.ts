// PR #32 — Sprint 5.3: Instagram Reels.
//
// Browser-side video validation. Mirrors lib/meta/image-validator.ts
// but for video — extracts metadata via the native <video> element
// (no FFmpeg, no library) and runs Meta's Reels constraints.
//
// Constraints (Sprint 5.3):
//   - Aspect ratio 9:16 (≈ 0.5625), tolerance 0.50–0.62
//   - Duration 3–90 s (Meta API allows up to 15min; we cap to 90s
//     in this sprint to match the typical Reel watch threshold)
//   - File size ≤ 100 MB (matches REELS_MAX_BYTES in upload helper)
//
// All validation is best-effort — the publisher itself re-checks
// dimensions via Meta's container processing step, but failing
// fast in the browser is much better UX.

export interface VideoMetadata {
  width: number;
  height: number;
  duration: number; // seconds
  aspectRatio: number;
  sizeBytes: number;
}

export interface VideoValidation {
  valid: boolean;
  warnings: string[];
  errors: string[];
  metadata?: VideoMetadata;
}

const ASPECT_MIN = 0.5;
const ASPECT_MAX = 0.62;
const DURATION_MIN_S = 3;
const DURATION_MAX_S = 90;
const SIZE_MAX_MB = 100;
const SIZE_WARN_MB = 50;
const DURATION_WARN_S = 60;

// Reads width/height/duration from a File without uploading. Uses a
// blob URL + the native <video> element so it's portable and free.
// Resolves to null if the browser can't decode the video.
export async function getVideoMetadata(
  file: File
): Promise<VideoMetadata | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    const objUrl = URL.createObjectURL(file);

    const cleanup = () => {
      URL.revokeObjectURL(objUrl);
      video.src = '';
    };

    video.onloadedmetadata = () => {
      const out: VideoMetadata = {
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration,
        aspectRatio:
          video.videoHeight > 0 ? video.videoWidth / video.videoHeight : 0,
        sizeBytes: file.size,
      };
      cleanup();
      resolve(out);
    };
    video.onerror = () => {
      cleanup();
      resolve(null);
    };
    video.src = objUrl;
  });
}

export function validateReelVideo(meta: VideoMetadata): VideoValidation {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (meta.aspectRatio < ASPECT_MIN || meta.aspectRatio > ASPECT_MAX) {
    errors.push(
      `Aspect ratio ${meta.aspectRatio.toFixed(2)}:1 not supported. Reels require 9:16 (1080×1920). Your video is ${meta.width}×${meta.height}.`
    );
  }

  if (meta.duration < DURATION_MIN_S) {
    errors.push(
      `Video too short (${meta.duration.toFixed(1)}s). Reels must be at least ${DURATION_MIN_S}s.`
    );
  }
  if (meta.duration > DURATION_MAX_S) {
    errors.push(
      `Video too long (${meta.duration.toFixed(1)}s). Sprint 5.3 caps Reels at ${DURATION_MAX_S}s.`
    );
  }

  const sizeMB = meta.sizeBytes / (1024 * 1024);
  if (sizeMB > SIZE_MAX_MB) {
    errors.push(
      `File too large (${sizeMB.toFixed(1)} MB). Max ${SIZE_MAX_MB} MB allowed.`
    );
  }

  if (sizeMB > SIZE_WARN_MB && sizeMB <= SIZE_MAX_MB) {
    warnings.push(
      `Large file (${sizeMB.toFixed(1)} MB). Upload may take longer on slow connections.`
    );
  }
  if (meta.duration > DURATION_WARN_S && meta.duration <= DURATION_MAX_S) {
    warnings.push(
      `Long video (${meta.duration.toFixed(0)}s). Engagement typically drops past 60s.`
    );
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
    metadata: meta,
  };
}
