// PR Sprint 7.28 — bridge between the asset-based flow's broader
// taxonomy and the voice engine's 4-bucket ContentType + 7-platform
// Platform union.
//
// The asset flow (Sprint 7.26) introduced types like 'ugc_video' +
// 'reel' + 'long_form_text' and Reel-specific platforms like
// 'instagram_reels' / 'facebook_reels'. The voice engine
// (lib/voice-engine/types.ts) keeps a narrower vocabulary that the
// learning loop was designed around:
//
//   ContentType:  'ugc' | 'carousel' | 'photo' | 'text'
//   Platform:     'instagram' | 'linkedin' | 'x' | 'threads'
//                | 'facebook' | 'reddit' | 'tiktok'
//
// Rather than widen the engine union (which would invalidate every
// stored ClientContext row), we fold here at the boundary. Folding
// preserves the engine's learning invariants: a TikTok Reel and a
// TikTok video share one stream of learning signals; an Instagram
// Reel folds into Instagram's learning stream; etc.

import type {
  ContentType,
  Platform as VoicePlatform,
} from './types';
import type { Platform as AssetPlatform } from '@/lib/marketing/platform-rules';
import type { AssetType } from '@/lib/marketing/platform-rules';

// Asset type → engine ContentType.
//
// Notes on each fold:
//   ugc_video / reel       → 'ugc'        (both are talking-head /
//                                          short vertical video,
//                                          same script+bundle shape)
//   carousel               → 'carousel'   (1:1)
//   photo                  → 'photo'      (1:1)
//   long_form_text         → 'text'       (1:1)
export function assetTypeToContentType(at: AssetType): ContentType {
  if (at === 'ugc_video' || at === 'reel') return 'ugc';
  if (at === 'carousel') return 'carousel';
  if (at === 'photo') return 'photo';
  return 'text';
}

// Asset Platform → engine Platform. Reel sub-variants fold into
// the parent network so their learning streams stay unified — a
// TikTok Reel and a TikTok photo both feed into 'tiktok' winning/
// losing patterns. The asset still records the precise platform
// for publishing routing (different golden times, different
// caption rules); the engine just learns at the parent-network
// level.
export function platformToVoicePlatform(p: AssetPlatform): VoicePlatform {
  if (p === 'instagram_reels') return 'instagram';
  if (p === 'facebook_reels') return 'facebook';
  return p as VoicePlatform;
}

// Word counts useful for the panel's preview + the script
// duration estimate. ~150 words ≈ 60s of natural speech, so a
// 30s UGC target lands around 70-90 words.
export function approximateSpokenDurationSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  // 150 words/min = 2.5 words/sec.
  return Math.round((words / 2.5) * 10) / 10;
}
