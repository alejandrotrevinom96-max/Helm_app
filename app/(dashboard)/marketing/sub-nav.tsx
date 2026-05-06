'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface SubNavItem {
  name: string;
  href: string;
  description: string;
  comingSoon?: boolean;
}

// PR #24 — Sprint 2.3 shipped Calendar (drag-drop + golden times) and
// Library went live in PR #23, so neither is "Soon" anymore.
const SUB_NAV_ITEMS: SubNavItem[] = [
  {
    name: 'Generate',
    href: '/marketing/generate',
    description: 'Create new posts',
  },
  {
    name: 'Calendar',
    href: '/marketing/calendar',
    description: 'Schedule and review',
  },
  {
    name: 'Library',
    href: '/marketing/library',
    description: 'Past posts & performance',
  },
];

// Sub-tab nav rendered inside the Marketing layout. Active tab is
// determined by the current pathname; /marketing (the bare URL) is
// treated as Generate since it redirects there server-side.
export function MarketingSubNav() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1 border-b border-border">
      {SUB_NAV_ITEMS.map((item) => {
        const isActive =
          pathname === item.href ||
          (item.href === '/marketing/generate' && pathname === '/marketing');

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`relative px-4 py-3 text-sm font-medium transition-colors ${
              isActive
                ? 'text-text-1 border-b-2 border-accent -mb-px'
                : 'text-text-3 hover:text-text-1'
            }`}
          >
            <span className="flex items-center gap-2">
              {item.name}
              {item.comingSoon && (
                <span className="text-[9px] font-mono uppercase tracking-[0.1em] px-1.5 py-0.5 bg-bg-elev rounded text-text-3">
                  Soon
                </span>
              )}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
