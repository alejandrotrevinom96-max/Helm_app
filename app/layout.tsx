import type { Metadata } from 'next';
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
export const metadata: Metadata = {
  title:
    'Helm — Brand-aware content that sounds like you. Posted automatically.',
  description:
    'AI marketing suite for indie founders. Auto-generate a brand bible from your website, write posts that fit your voice, and auto-publish to Meta. Free for the first 20 founders.',
  openGraph: {
    title:
      'Helm — Brand-aware content that sounds like you. Posted automatically.',
    description:
      'AI marketing suite for indie founders. Free for the first 20 founders.',
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
  return (
    <html lang="en" data-theme={theme} suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,300;1,9..144,400;1,9..144,500&family=JetBrains+Mono:wght@400;500;600&family=Geist:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="bg-bg text-text-1 font-sans antialiased">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
