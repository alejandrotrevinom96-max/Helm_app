// PR #42 — Sprint 6.7: platform pill.
//
// Solid-color rounded chip showing the platform label. Used in
// drafts grid, calendar drafts pool, calendar post chips, and
// the post detail modal. Inline styles (not Tailwind) because
// brand colors are runtime values and Tailwind's JIT can't
// generate arbitrary hex from a runtime string.

import { getPlatformStyle } from '@/lib/platforms/colors';

interface Props {
  platform: string | null | undefined;
  size?: 'sm' | 'md';
  className?: string;
}

export function PlatformPill({ platform, size = 'sm', className = '' }: Props) {
  const style = getPlatformStyle(platform);
  const sizing =
    size === 'sm'
      ? 'text-[10px] px-1.5 py-0.5'
      : 'text-xs px-2 py-1';

  return (
    <span
      className={`${sizing} font-mono uppercase tracking-wider rounded font-medium whitespace-nowrap ${className}`}
      style={{
        backgroundColor: style.brand,
        color: 'white',
      }}
    >
      {style.label}
    </span>
  );
}
