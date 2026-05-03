import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/next';
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,400&family=JetBrains+Mono:wght@400;500;600&family=Geist:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-bg text-text font-sans antialiased">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
