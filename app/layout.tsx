import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { getServerTheme } from '@/lib/theme';
import { ToastContainer } from '@/components/toast/toast';
import { DarkReaderDetector } from '@/components/dark-reader-detector';
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
//
// PR #41 — Sprint 6.6: anti-AI-slop rewrite. The (marketing)/
// page.tsx metadata still wins for "/", but this default applies
// to every other route that doesn't supply its own (auth pages,
// dashboard, etc.) so it gets the same positioning shift.
export const metadata: Metadata = {
  title: 'Helm: Marketing for people who built the product first',
  description:
    'You built the product. Now you have to market it. Helm reads your brand from any URL or Instagram, writes posts that sound like you, and ships them anywhere. Free for the first 20 founders.',
  openGraph: {
    title: 'Helm: Marketing for people who built the product first',
    description:
      "You built the product. Now you have to market it. Helm does the part you avoid. Free for the first 20 founders.",
    url: 'https://trythelm.com',
    siteName: 'Helm',
    type: 'website',
  },
};

// PR Sprint 7.25 Phase 1 — dark-first default. New visitors land
// on dark unless the cookie says light or the OS explicitly prefers
// light (matches the server-side resolver in lib/theme.ts so the
// SSR HTML's data-theme matches what the boot script computes,
// avoiding a flash of the wrong theme).
const themeBootScript = `
(() => {
  try {
    const m = document.cookie.match(/helm-theme=(\\w+)/);
    const t = m && m[1];
    if (t === 'light' || t === 'dark') {
      document.documentElement.setAttribute('data-theme', t);
      return;
    }
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    document.documentElement.setAttribute('data-theme', prefersLight ? 'light' : 'dark');
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
        {/* PR #73 — Sprint 7.2A.5: Dark Reader defense layer 1. The
            extension respects this meta tag and disables its own
            inversion for the page, so users with Dark Reader on
            still see Helm's own theme instead of a double-inverted
            mess. Three signals layered for older extension versions
            that ignore the lock meta:
              - darkreader-lock: official "disable here" hint
              - color-scheme: tells the browser (and Dark Reader's
                heuristics) the page handles both modes itself
              - theme-color per prefers-color-scheme: matches the
                actual --bg token for each theme so mobile chrome
                and Dark Reader heuristics line up with what's
                rendering on-screen.
            Layer 2 is in globals.css; layer 3 is the JS detector
            below the toast container. */}
        <meta name="darkreader-lock" />
        <meta name="color-scheme" content="light dark" />
        <meta
          name="theme-color"
          content="#fafaf7"
          media="(prefers-color-scheme: light)"
        />
        <meta
          name="theme-color"
          content="#1a1a1a"
          media="(prefers-color-scheme: dark)"
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* PR Sprint 7.25 Phase 1 — design-system fonts. Plus Jakarta
            Sans + Instrument Serif join the existing stack so the
            redesigned platform pages can opt into them via the new
            `font-instrument` and `font-jakarta` Tailwind families
            without losing the existing Fraunces / Geist that the
            marketing site + dashboard already use. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,300;1,9..144,400;1,9..144,500&family=JetBrains+Mono:wght@400;500;600;700&family=Geist:wght@300;400;500;600;700&family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=Instrument+Serif:ital@0;1&display=swap"
          rel="stylesheet"
        />
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: themeBootScript }}
        />
      </head>
      <body className="bg-bg text-text-1 font-sans antialiased">
        {children}
        {/* PR #42 — Sprint 6.7: in-app toast container. Mounted
            once at root so any client component can call
            showToast() without prop-drilling. Renders nothing
            when the queue is empty. */}
        <ToastContainer />
        {/* PR #73 — Sprint 7.2A.5: Dark Reader layer 3. Detects the
            extension at runtime and surfaces a dismissible nudge if
            it slipped past the meta lock (older versions or "Force"
            mode). Renders nothing when Dark Reader isn't active or
            when the user previously dismissed it. Mounted in root
            (not just dashboard) so the landing-page preview doesn't
            render double-inverted either. */}
        <DarkReaderDetector />
        <Analytics />
        {/* PR #86 — Sprint 7.11: Vercel Speed Insights. Captures
            Core Web Vitals (LCP / CLS / INP / FCP / TTFB) per real
            visit and ships them to the Vercel dashboard. No setup
            beyond mounting this component — the script source
            (va.vercel-scripts.com) is already in the CSP allowlist
            from PR #40, so it ships under the nonce-based policy
            without changes. Sits next to <Analytics /> so both
            Vercel telemetry surfaces mount in the same place. */}
        <SpeedInsights />
      </body>
    </html>
  );
}
