import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/next';
import { getServerTheme } from '@/lib/theme';
import './globals.css';

export const metadata: Metadata = {
  title: 'Helm — The command center for indie hackers',
  description:
    'Stop juggling Vercel, Supabase, Meta Ads, and 7 other tabs. Helm pulls every signal from your micro-SaaS into one dashboard.',
  openGraph: {
    title: 'Helm — The command center for indie hackers',
    description: 'One dashboard for analytics, marketing, research, and validation.',
    url: 'https://helm.so',
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
