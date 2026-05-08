import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { LandingPage } from './_landing/landing-page';

// PR #34 — Sprint 6.2: metadata refresh.
// Old copy framed Helm as a v1 dashboard product ("the c-c for indie
// hackers", "stop juggling 7 tabs"). The product is now a marketing
// suite — the new copy matches the Hero tagline and what a visitor
// will actually see/do.
//
// PR #38 — Sprint 6.4: copy pivot. "Posted automatically" promised
// native Meta auto-publishing which is gated by App Review (blocked
// 4–6 weeks). New copy reflects the ship-today path: "Ship it your
// way" + 1-tap share via Web Share API. Auto-post stays as V3.
export const metadata = {
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
  twitter: {
    card: 'summary_large_image' as const,
    title: 'Helm — Brand-aware content that sounds like you',
    description: 'Ship it your way.',
  },
};

// Server-component routing: logged-in visitors skip the landing entirely
// and land on the dashboard's first usable page. The (dashboard) layout
// already handles "no project yet" → /onboarding for us, so we don't have
// to branch on project existence here.
export default async function HomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) redirect('/analytics');

  return <LandingPage />;
}
