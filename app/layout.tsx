import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Analytics } from '@vercel/analytics/next';
import { getServerTheme } from '@/lib/theme';
import './globals.css';

// PR #36 — Sprint 6.2.1: copy aligned with the landing rebuild
// (PR #34). Pre-PR-36 the root layout still framed Helm with v1
// dashboard messaging while the landing already pitched it as a
// marketing suite — inconsistent across surfaces (the SEO / share
// preview disagreed with what the visitor actually saw). The
// (marketing)/page.tsx metadata override still wins for /, but this
// default applies to every other route that doesn't supply its own
// (auth pages, dashboard, etc).
//
// PR #38 — Sprint 6.4: copy pivot. Auto-post to Meta is gated by
// App Review (blocked), so the SEO/share previews now match the
// real shipping path: "Tap to share anywhere".
export const metadata: Metadata = {
  title:
    'Helm — Brand-aware content that sounds like you. Ship it your way.',
  description:
    'AI marketing suite for indie founders. Generate brand-aligned posts that sound like you. 1 tap to share to Instagram, Facebook, X, anywhere. Free for the first 20 founders.',
  openGraph: {
    title:
      'Helm — Brand-aware content that sounds like you. Ship it your way.',
    description:
      'AI marketing suite for indie founders. Tap to share anywhere. Free for the first 20 founders.',
    url: 'https://trythelm.com',
    siteName: 'Helm',
    type: 'website',
  },
};

const themeBootScript = `
(() => {
  try {
    const m = document.cookie.match(/helm-theme=(\\w+)/);
    const t = m && m[1];
    if (t === 'light' || t === 'dark') {
      document.documentElement.setAttribute('data-theme', t);
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  } catch (e) {}
})();
`;

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const theme = await getServerTheme();
  // PR #40 — Sprint 6.5.1: nonce-based CSP. Middleware mints a
  // fresh nonce per request and pipes it via x-nonce header; the
  // inline themeBootScript below carries that nonce so it runs
  // under the strict CSP. Falls through to undefined when the
  // request didn't go through middleware (extremely rare —
  // typically only happens for the matcher-excluded static asset
  // paths, which don't render this layout anyway).
  const h = await headers();
  const nonce = h.get('x-nonce') ?? undefined;
  return (
    <html lang="en" data-theme={theme} suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,300;1,9..144,400;1,9..144,500&family=JetBrains+Mono:wght@400;500;600&family=Geist:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: themeBootScript }}
        />
      </head>
      <body className="bg-bg text-text-1 font-sans antialiased">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
