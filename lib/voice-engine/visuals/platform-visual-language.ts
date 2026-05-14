// PR Sprint 7.19 — per-platform visual language port.
//
// 1:1 translation of
// Helm SEO/helm-adaptive-voice-engine/platform_visual_language.py.
//
// Lives parallel to PLATFORM_TONE_INSTRUCTIONS (which handles text)
// and is consumed by visual-prompt-builder.ts to populate the
// PlatformBlock of the VisualPromptIR.

import type { AspectRatio } from './visual-schema';

export interface PlatformVisualSpec {
  aspect_ratio: AspectRatio;
  visual_register: string;
  composition_notes: string;
  color_treatment: string;
}

// Structured by (platform, content_type). Not every platform
// supports every content type — Reddit is intentionally absent
// because Reddit is text-led and images, when used, should be
// screenshots or charts (outside this pipeline).
export const PLATFORM_VISUAL_LANGUAGE: Readonly<
  Record<string, Readonly<Record<string, PlatformVisualSpec>>>
> = {
  instagram: {
    photo: {
      aspect_ratio: '4:5',
      visual_register: 'lifestyle, aspirational, mobile-first',
      composition_notes:
        'subject centered or rule-of-thirds, ample negative space, designed to thumbstop in feed',
      color_treatment:
        'vibrant but natural saturation, slight warm bias, consistent with mobile screen rendering',
    },
    carousel: {
      aspect_ratio: '1:1',
      visual_register: 'editorial, clean, slide-as-standalone',
      composition_notes:
        'simple compositions that read at thumbnail size, subject filling 50-70% of frame, clean negative space for any future text overlay',
      color_treatment:
        'consistent palette across all slides, muted-to-mid saturation, high readability',
    },
    ugc: {
      // Reel cover frame
      aspect_ratio: '9:16',
      visual_register: 'bold, high-contrast, attention-stopper',
      composition_notes:
        'subject centered or upper-third, room for text overlay at top and bottom thirds, face-forward when subject is human',
      color_treatment:
        'saturated, contrasty, optimized for tiny thumbnail visibility',
    },
  },

  linkedin: {
    photo: {
      aspect_ratio: '4:5',
      visual_register:
        'clean editorial, business context, professional but human',
      composition_notes:
        'subject centered, neutral or office-adjacent setting, documentary feel over staged',
      color_treatment:
        'muted palette, low-to-mid saturation, blue-gray cool bias is acceptable, avoid neon',
    },
    carousel: {
      aspect_ratio: '1:1',
      visual_register:
        'document-style, headline + supporting visual, white-paper feel',
      composition_notes:
        'high contrast subject vs background, asymmetric composition that leaves room for prominent headline text overlay, flat-lay or clean studio shots work well',
      color_treatment:
        'muted, professional, single accent color, avoid lifestyle warmth or aspirational glow',
    },
    ugc: {
      // Native video cover
      aspect_ratio: '9:16',
      visual_register: 'professional but candid, talking-head friendly',
      composition_notes:
        'subject upper-center, eye level, neutral background, looking slightly off-camera or direct',
      color_treatment: 'natural skin tones, soft window-style lighting',
    },
  },

  x: {
    photo: {
      aspect_ratio: '16:9',
      visual_register: 'documentary, raw, screenshot-friendly',
      composition_notes:
        'wider framing, subject can be off-center, scene matters as much as subject, less polished',
      color_treatment:
        'natural / unprocessed feel, accept some grain or imperfection',
    },
    ugc: {
      aspect_ratio: '9:16',
      visual_register: 'raw, in-the-moment, unpolished',
      composition_notes:
        'subject filling frame, handheld feel acceptable, low production value works',
      color_treatment: 'natural, no filters, slight underexposure OK',
    },
  },

  threads: {
    photo: {
      aspect_ratio: '1:1',
      visual_register: 'casual, in-progress, less polished than Instagram',
      composition_notes:
        'subject centered, simple, looks like a phone snap rather than a photoshoot',
      color_treatment:
        'natural, slightly under-saturated, no heavy editing',
    },
    ugc: {
      aspect_ratio: '9:16',
      visual_register: 'raw, conversational, talking-friend energy',
      composition_notes:
        'subject close to camera, casual framing, eye contact',
      color_treatment: 'natural skin tones, ambient lighting only',
    },
  },

  facebook: {
    photo: {
      aspect_ratio: '1:1',
      visual_register: 'warm, community-oriented, less edgy',
      composition_notes:
        'subject centered, narrative composition, often shows people or relatable scenes',
      color_treatment:
        'warm tones, mid saturation, accessible to older audiences',
    },
    carousel: {
      aspect_ratio: '1:1',
      visual_register: 'story-driven, sequential narrative',
      composition_notes:
        'consistent visual language across slides, subject can vary but treatment stays uniform',
      color_treatment: 'consistent warm palette across slides',
    },
    ugc: {
      aspect_ratio: '9:16',
      visual_register:
        'warm, community-friendly, talking-head with context',
      composition_notes:
        'subject centered, may show a setting that signals community',
      color_treatment: 'warm natural tones',
    },
  },

  tiktok: {
    ugc: {
      // Cover frame for TikTok video
      aspect_ratio: '9:16',
      visual_register: 'bold, high-contrast, attention-stopper for thumbnail',
      composition_notes:
        'subject centered or upper-third, expressive face if human, room for text overlay across top, designed to win the 0.5-second swipe test as a static frame',
      color_treatment:
        'high saturation, high contrast, optimized for thumbnail visibility at 80px',
    },
  },
};

// ============================================================
// Public helpers
// ============================================================

/**
 * Get the visual language spec for a (platform, content_type)
 * combination. Throws when the combination isn't supported.
 */
export function getVisualLanguage(
  platform: string,
  contentType: string,
): PlatformVisualSpec {
  const p = platform.toLowerCase();
  const c = contentType.toLowerCase();

  const platformSpec = PLATFORM_VISUAL_LANGUAGE[p];
  if (!platformSpec) {
    throw new Error(
      `Platform '${p}' has no visual language defined. Supported: ${Object.keys(
        PLATFORM_VISUAL_LANGUAGE,
      )
        .sort()
        .join(', ')}`,
    );
  }
  const contentSpec = platformSpec[c];
  if (!contentSpec) {
    throw new Error(
      `Content type '${c}' not supported for visuals on platform '${p}'. Supported types: ${Object.keys(
        platformSpec,
      )
        .sort()
        .join(', ')}`,
    );
  }
  return contentSpec;
}

/** Get the aspect ratio for a (platform, content_type) combo. */
export function getAspectRatio(
  platform: string,
  contentType: string,
): AspectRatio {
  return getVisualLanguage(platform, contentType).aspect_ratio;
}

/**
 * Format a visual language spec as a single descriptive string
 * for the PlatformBlock.visual_language_notes field.
 */
export function formatVisualLanguageNotes(
  spec: PlatformVisualSpec,
): string {
  return `Visual register: ${spec.visual_register}. Composition: ${spec.composition_notes}. Color treatment: ${spec.color_treatment}.`;
}
