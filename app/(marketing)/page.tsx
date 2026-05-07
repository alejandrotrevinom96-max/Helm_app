import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { LandingPage } from './_landing/landing-page';

// PR #34 — Sprint 6.2: metadata refresh.
// Old copy ("command center", "7 tabs") leaned into the v1 dashboard
// pitch. The product is now a marketing suite — the new copy matches
// the Hero tagline and what a visitor will actually see/do.
export const metadata = {
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
  twitter: {
    card: 'summary_large_image' as const,
    title: 'Helm — Brand-aware content that sounds like you',
    description: 'Posted automatically.',
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
