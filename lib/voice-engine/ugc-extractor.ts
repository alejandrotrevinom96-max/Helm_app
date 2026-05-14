// PR Sprint 7.18 — UGC bundle extractor port.
//
// 1:1 translation of
// Helm SEO/helm-adaptive-voice-engine/ugc_extractor.py.
//
// Downstream consumers:
//   - HeyGen / TTS engines      → extractScriptForHeygen
//   - Video editor / post       → extractOverlayTrack
//   - Social scheduler          → extractCaptionForPost
//   - Storyboard / QA           → extractBeatBreakdown
//   - Debug / archive payload   → extractFullExport
//
// Drop-in replacement for lib/visuals/generate.ts's
// extractScriptText (which the SHIP.md flags as deprecated).
// Keep that legacy function for one more sprint then remove
// when no consumers reference it.

import {
  scriptText,
  totalDurationSeconds,
  type UGCBundle,
} from './ugc-schema';

// ============================================================
// Script (TTS / HeyGen)
// ============================================================

/**
 * Concatenate hook + body beats (in order) + CTA into one
 * string ready to feed HeyGen / a TTS engine. Spaces between
 * sections; no SSML tags in MVP (Phase 1.5 can add delivery
 * hints if HeyGen surfaces them on the voice).
 */
export function extractScriptForHeygen(bundle: UGCBundle): string {
  return scriptText(bundle);
}

// ============================================================
// Overlays (video editor / post-production)
// ============================================================

export interface OverlayTrackEntry {
  text: string;
  start_seconds: number;
  end_seconds: number;
  duration_seconds: number;
}

/**
 * Return overlay timing data formatted for video editor import.
 * Editors (CapCut, Premiere, custom pipelines) can use this to
 * auto-place text overlays at the correct moments.
 */
export function extractOverlayTrack(bundle: UGCBundle): OverlayTrackEntry[] {
  return bundle.overlays.map((o) => ({
    text: o.text,
    start_seconds: o.trigger_at_seconds,
    end_seconds: o.trigger_at_seconds + o.duration_seconds,
    duration_seconds: o.duration_seconds,
  }));
}

// ============================================================
// Caption (social scheduler)
// ============================================================

/**
 * Format the caption for social media post upload. Hashtags are
 * stored without the # prefix in the bundle; this extractor
 * adds the # back when `includeHashtags` is true.
 *
 * Pass `includeHashtags=false` for platforms that take hashtags
 * via a separate API field (or Instagram's first-comment
 * strategy).
 */
export function extractCaptionForPost(
  bundle: UGCBundle,
  includeHashtags = true,
): string {
  if (!includeHashtags || bundle.hashtags.length === 0) {
    return bundle.caption;
  }
  const hashtagBlock = bundle.hashtags.map((t) => `#${t}`).join(' ');
  return `${bundle.caption}\n\n${hashtagBlock}`;
}

/** Return hashtags as a list, optionally with the # prefix. */
export function extractHashtagList(
  bundle: UGCBundle,
  withPrefix = true,
): string[] {
  return withPrefix
    ? bundle.hashtags.map((t) => `#${t}`)
    : [...bundle.hashtags];
}

// ============================================================
// Beat breakdown (storyboard / QA)
// ============================================================

export interface BeatBreakdownEntry {
  section: string;
  start_seconds: number;
  end_seconds: number;
  duration_seconds: number;
  text: string;
  delivery: string;
}

/**
 * Beat-by-beat breakdown with running timing. Useful for
 * storyboarding, manual QA, and post-production planning.
 */
export function extractBeatBreakdown(
  bundle: UGCBundle,
): BeatBreakdownEntry[] {
  const out: BeatBreakdownEntry[] = [];
  let cursor = 0;

  out.push({
    section: 'hook',
    start_seconds: cursor,
    end_seconds: cursor + bundle.hook.duration_seconds,
    duration_seconds: bundle.hook.duration_seconds,
    text: bundle.hook.text,
    delivery: bundle.hook.delivery,
  });
  cursor += bundle.hook.duration_seconds;

  for (const beat of bundle.body) {
    out.push({
      section: `body_beat_${beat.beat}`,
      start_seconds: cursor,
      end_seconds: cursor + beat.duration_seconds,
      duration_seconds: beat.duration_seconds,
      text: beat.text,
      delivery: beat.delivery,
    });
    cursor += beat.duration_seconds;
  }

  out.push({
    section: 'cta',
    start_seconds: cursor,
    end_seconds: cursor + bundle.cta.duration_seconds,
    duration_seconds: bundle.cta.duration_seconds,
    text: bundle.cta.text,
    delivery: bundle.cta.delivery,
  });

  return out;
}

// ============================================================
// Full export (debug / archive)
// ============================================================

export interface FullExport {
  script: string;
  overlays: OverlayTrackEntry[];
  caption_with_hashtags: string;
  caption_without_hashtags: string;
  hashtags: string[];
  beat_breakdown: BeatBreakdownEntry[];
  total_duration_seconds: number;
  platform: string;
  language: string;
}

export function extractFullExport(bundle: UGCBundle): FullExport {
  return {
    script: extractScriptForHeygen(bundle),
    overlays: extractOverlayTrack(bundle),
    caption_with_hashtags: extractCaptionForPost(bundle, true),
    caption_without_hashtags: extractCaptionForPost(bundle, false),
    hashtags: extractHashtagList(bundle, true),
    beat_breakdown: extractBeatBreakdown(bundle),
    total_duration_seconds: totalDurationSeconds(bundle),
    platform: bundle.metadata.platform,
    language: bundle.metadata.language,
  };
}
