// PR #42 — Sprint 6.7: platform brand colors.
//
// One source of truth for the social-platform palette so the
// calendar, drafts pool, library cards, and pills all agree.
// We layer FOUR shades per platform:
//   - brand:   the saturated brand color (pill bg, border-l-4)
//   - tint:    6% opacity wash for tinted card backgrounds, used
//              behind dark / light themes alike
//   - text:    color for tags / labels / chevrons
//   - emoji:   ASCII fallback so we don't have to ship icon
//              libraries for every platform
//
// Rationale for the 6% tint specifically: any higher and dark
// mode loses contrast against bg-elev; any lower and the user
// can't tell platforms apart at a glance in a dense calendar
// week view. 6% tested clean across both themes.

export type Platform =
  | 'instagram'
  | 'facebook'
  | 'linkedin'
  | 'threads'
  | 'reddit'
  | 'x'
  | 'twitter';

export interface PlatformStyle {
  /** Saturated brand color — pill backgrounds, left borders. */
  brand: string;
  /** 6% opacity wash for tinted card backgrounds. */
  tint: string;
  /** Text color for tags / labels (= brand). */
  text: string;
  /** Display name. */
  label: string;
  /** ASCII / emoji glyph used when no icon component is
   *  available. We deliberately don't ship the lucide brand
   *  icons (they're separately licensed in some cases). */
  emoji: string;
}

export const PLATFORM_STYLES: Record<Platform, PlatformStyle> = {
  instagram: {
    brand: '#E4405F',
    tint: 'rgba(228, 64, 95, 0.06)',
    text: '#E4405F',
    label: 'Instagram',
    emoji: '📷',
  },
  facebook: {
    brand: '#1877F2',
    tint: 'rgba(24, 119, 242, 0.06)',
    text: '#1877F2',
    label: 'Facebook',
    emoji: '📘',
  },
  linkedin: {
    brand: '#0A66C2',
    tint: 'rgba(10, 102, 194, 0.06)',
    text: '#0A66C2',
    label: 'LinkedIn',
    emoji: '💼',
  },
  threads: {
    // Threads brand is monochrome — using a neutral gray instead
    // of pure black so it doesn't clash with dark-mode bg-elev.
    brand: '#6b7280',
    tint: 'rgba(107, 114, 128, 0.08)',
    text: '#9ca3af',
    label: 'Threads',
    emoji: '@',
  },
  reddit: {
    brand: '#FF4500',
    tint: 'rgba(255, 69, 0, 0.06)',
    text: '#FF4500',
    label: 'Reddit',
    emoji: '🟠',
  },
  // X / Twitter use the same style; the second key is just an
  // alias since some legacy data still says 'twitter'.
  x: {
    brand: '#1d9bf0',
    tint: 'rgba(29, 155, 240, 0.06)',
    text: '#1d9bf0',
    label: 'X',
    emoji: '𝕏',
  },
  twitter: {
    brand: '#1d9bf0',
    tint: 'rgba(29, 155, 240, 0.06)',
    text: '#1d9bf0',
    label: 'X',
    emoji: '𝕏',
  },
};

const FALLBACK_STYLE: PlatformStyle = {
  brand: '#6b7280',
  tint: 'rgba(107, 114, 128, 0.06)',
  text: '#9ca3af',
  label: 'Other',
  emoji: '•',
};

/**
 * Lookup with a permissive fallback so a typo'd or unknown
 * platform value still renders something legible (no UI crash,
 * just a neutral gray pill).
 */
export function getPlatformStyle(platform: string | null | undefined): PlatformStyle {
  if (!platform) return FALLBACK_STYLE;
  const key = platform.toLowerCase() as Platform;
  return PLATFORM_STYLES[key] ?? FALLBACK_STYLE;
}
