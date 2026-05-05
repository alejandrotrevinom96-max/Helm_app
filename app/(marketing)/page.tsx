import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { LandingPage } from './_landing/landing-page';

export const metadata = {
  title: 'Helm — The command center for indie hackers',
  description:
    'Stop juggling 7 tabs. Helm pulls every signal from your micro-SaaS into one dashboard — analytics, marketing, research, validation, and VC-grade strategy scoring. Now live, free for first 20 founders.',
  openGraph: {
    title: 'Helm — The command center for indie hackers',
    description:
      'Stop juggling 7 tabs. Now live, free for first 20 founders.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image' as const,
    title: 'Helm — The command center for indie hackers',
    description:
      'Stop juggling 7 tabs. Now live, free for first 20 founders.',
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
