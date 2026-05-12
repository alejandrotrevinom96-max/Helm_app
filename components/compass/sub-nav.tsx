'use client';

// PR #69 — Sprint 7.1D: shared sub-nav for every Compass sub-page.
//
// Originally lived as a local helper inside /compass/priority/
// client.tsx (Sprint 7.1B). Extracted now so:
//   - /compass/timeline (new this sprint) can share it
//   - /compass/competitors picks up the same nav instead of its
//     ad-hoc breadcrumb
//   - any future Compass tab adds itself by appending to TABS
//     instead of touching every page
//
// The active tab is passed explicitly rather than inferred from
// usePathname so we don't ship a third client hook for what's a
// single render-time decision.
import Link from 'next/link';

export type CompassTab =
  | 'home'
  | 'priority'
  | 'competitors'
  | 'timeline'
  | 'blind-spots'
  | 'decisions';

interface TabDef {
  key: CompassTab;
  href: string;
  label: string;
}

const TABS: TabDef[] = [
  // PR #77 — Sprint 7.4: relabeled 'Score' → 'Overview' to match
  // the new /compass landing (no more VC dial; it's a dashboard of
  // the deep-dive features). The `key` stays 'home' so existing
  // pages that pass active='home' don't need to update.
  { key: 'home', href: '/compass', label: 'Overview' },
  { key: 'priority', href: '/compass/priority', label: 'Priority' },
  { key: 'competitors', href: '/compass/competitors', label: 'Competitors' },
  { key: 'timeline', href: '/compass/timeline', label: 'Timeline' },
  // PR #70 — Sprint 7.1C: blind spots detector.
  { key: 'blind-spots', href: '/compass/blind-spots', label: 'Blind Spots' },
  // PR #71 — Sprint 7.1E: decision log (final Compass deep-dive).
  { key: 'decisions', href: '/compass/decisions', label: 'Decisions' },
];

interface Props {
  active: CompassTab;
}

export function CompassSubNav({ active }: Props) {
  return (
    <div className="flex items-center gap-1 text-xs font-mono uppercase tracking-[0.15em] text-text-3">
      <Link href="/compass" className="hover:text-text-1 transition-colors">
        Compass
      </Link>
      <span>/</span>
      {TABS.map((t, i) => (
        <span key={t.key} className="flex items-center gap-1">
          <Link
            href={t.href}
            className={
              t.key === active
                ? 'text-text-1'
                : 'hover:text-text-1 transition-colors'
            }
          >
            {t.label}
          </Link>
          {i < TABS.length - 1 && <span className="opacity-50">·</span>}
        </span>
      ))}
    </div>
  );
}
