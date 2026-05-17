'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface SubNavItem {
  name: string;
  href: string;
  description: string;
  comingSoon?: boolean;
}

// PR Sprint D-8 — tab rename. "Generate" → "Photo Studio" frames
// the surface around the kind of asset (images / carousels), and
// "Studio" → "UGC Studio" disambiguates it from the new photo
// flow now that there are two studio paradigms. Calendar +
// Library unchanged.
const SUB_NAV_ITEMS: SubNavItem[] = [
  {
    name: 'Photo Studio',
    href: '/marketing/photo-studio',
    description: 'Carousels, photos, product shots',
  },
  {
    name: 'UGC Studio',
    href: '/marketing/ugc-studio',
    description: 'Chat with the video agent',
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
          // /marketing (bare URL) lands on Photo Studio because the
          // page.tsx server redirect targets the new route name.
          (item.href === '/marketing/photo-studio' &&
            pathname === '/marketing');

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
