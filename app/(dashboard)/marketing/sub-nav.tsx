'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface SubNavItem {
  name: string;
  href: string;
  description: string;
  comingSoon?: boolean;
}

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
//
// PR Sprint 7.25 Phase 6 — repainted on top of the platform redesign
// (orange-underlined active tab matching the new editorial header).
export function MarketingSubNav() {
  const pathname = usePathname();

  return (
    <nav className="platform-tab-row">
      {SUB_NAV_ITEMS.map((item) => {
        const isActive =
          pathname === item.href ||
          (item.href === '/marketing/generate' && pathname === '/marketing');

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`platform-tab${isActive ? ' platform-tab-on' : ''}`}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              {item.name}
              {item.comingSoon && (
                <span className="platform-pill-soon">Soon</span>
              )}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
