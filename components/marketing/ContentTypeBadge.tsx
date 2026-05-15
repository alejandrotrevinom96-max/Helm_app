// PR Sprint 7.24 — Prompt 4. Shared content-type chip.
//
// Pre-fix each surface (Library card, post-detail modal, Calendar
// drafts pool, calendar month-view dots) rendered its own version
// of the content-type label with the same muted text-accent color
// for all types. Founders couldn't visually scan their feed and
// instantly tell carousel from photo from UGC.
//
// This component is the single source of truth for:
//   - Which color a content type renders in
//   - How the type label is humanized (e.g. 'single_image' → 'Photo')
//   - Optional icon + label combo for UGC ("🎥 Script" instead of
//     just "ugc")
//
// Three render variants:
//   default       — full chip with text + optional icon
//   icon-only     — round icon-only pill (for tight spaces like
//                   month-view day cells)
//   dot           — a small colored dot used in calendar month
//                   view to indicate platform/content density
//
// Colors per the Prompt 4 spec:
//   carousel       → blue
//   photo          → green   (also single_image)
//   ugc / reel     → amber   (videos / scripts)
//   self_post      → gray    (and other text-only formats)
//   text_post      → gray
//   community_post → gray

import type { CSSProperties } from 'react';

export type ContentTypeKey =
  | 'carousel'
  | 'photo'
  | 'single_image'
  | 'ugc'
  | 'reel'
  | 'self_post'
  | 'text_post'
  | 'community_post'
  | 'link_post'
  | 'single_tweet'
  | 'thread'
  | (string & Record<never, never>); // allow forward-compat strings

interface TypeStyle {
  /** Tailwind class string for chip background + text. */
  chip: string;
  /** CSS color (for the dot variant — no Tailwind alias to keep
   *  the dot purely color-driven without spreading classes). */
  dotColor: string;
  /** Display label shown in the chip (humanized). */
  label: string;
  /** Optional emoji rendered before the label in the default chip. */
  icon?: string;
}

const TYPE_STYLES: Record<string, TypeStyle> = {
  carousel: {
    chip: 'bg-blue-500/15 text-blue-500 border border-blue-500/30',
    dotColor: '#3b82f6',
    label: 'Carousel',
    icon: '🖼️',
  },
  photo: {
    chip: 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30',
    dotColor: '#10b981',
    label: 'Photo',
    icon: '📷',
  },
  single_image: {
    chip: 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30',
    dotColor: '#10b981',
    label: 'Photo',
    icon: '📷',
  },
  ugc: {
    chip: 'bg-amber-500/15 text-amber-500 border border-amber-500/30',
    dotColor: '#f59e0b',
    label: 'Script',
    icon: '🎥',
  },
  reel: {
    chip: 'bg-amber-500/15 text-amber-500 border border-amber-500/30',
    dotColor: '#f59e0b',
    label: 'Reel',
    icon: '🎬',
  },
  self_post: {
    chip: 'bg-text-3/15 text-text-2 border border-text-3/20',
    dotColor: '#9ca3af',
    label: 'Self post',
  },
  text_post: {
    chip: 'bg-text-3/15 text-text-2 border border-text-3/20',
    dotColor: '#9ca3af',
    label: 'Text post',
  },
  community_post: {
    chip: 'bg-text-3/15 text-text-2 border border-text-3/20',
    dotColor: '#9ca3af',
    label: 'Community post',
  },
  link_post: {
    chip: 'bg-text-3/15 text-text-2 border border-text-3/20',
    dotColor: '#9ca3af',
    label: 'Link post',
  },
  single_tweet: {
    chip: 'bg-text-3/15 text-text-2 border border-text-3/20',
    dotColor: '#9ca3af',
    label: 'Tweet',
  },
  thread: {
    chip: 'bg-text-3/15 text-text-2 border border-text-3/20',
    dotColor: '#9ca3af',
    label: 'Thread',
  },
};

function stylesFor(type: string | null | undefined): TypeStyle {
  if (!type) {
    return {
      chip: 'bg-text-3/15 text-text-3 border border-text-3/20',
      dotColor: '#9ca3af',
      label: '—',
    };
  }
  const direct = TYPE_STYLES[type];
  if (direct) return direct;
  // Fallback: humanize the unknown type but keep it gray so it doesn't
  // accidentally match an established color.
  return {
    chip: 'bg-text-3/15 text-text-2 border border-text-3/20',
    dotColor: '#9ca3af',
    label: type.replace(/_/g, ' '),
  };
}

interface BadgeProps {
  contentType: string | null | undefined;
  /** Override the rendered label (rare — defaults to TYPE_STYLES label). */
  labelOverride?: string;
  /** Show the icon emoji in the chip. Default true. */
  showIcon?: boolean;
  className?: string;
}

export function ContentTypeBadge({
  contentType,
  labelOverride,
  showIcon = true,
  className = '',
}: BadgeProps) {
  const s = stylesFor(contentType);
  const label = labelOverride ?? s.label;
  return (
    <span
      className={`text-[10px] font-mono uppercase tracking-[0.1em] font-medium px-2 py-0.5 rounded ${s.chip} ${className}`}
      title={contentType ? `Content type: ${contentType.replace(/_/g, ' ')}` : undefined}
    >
      {showIcon && s.icon && <span aria-hidden className="mr-1">{s.icon}</span>}
      {label}
    </span>
  );
}

interface DotProps {
  contentType: string | null | undefined;
  size?: number;
  className?: string;
  ariaLabel?: string;
}

export function ContentTypeDot({
  contentType,
  size = 6,
  className = '',
  ariaLabel,
}: DotProps) {
  const s = stylesFor(contentType);
  const style: CSSProperties = {
    width: size,
    height: size,
    background: s.dotColor,
  };
  return (
    <span
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
      className={`inline-block rounded-full ${className}`}
      style={style}
    />
  );
}

/** Returns the canonical color for a content type. Useful when
 *  callers want to drive their own styling (e.g., a left-border
 *  accent on a card). */
export function contentTypeColor(
  contentType: string | null | undefined,
): string {
  return stylesFor(contentType).dotColor;
}
