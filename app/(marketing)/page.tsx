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
//
// PR #41 — Sprint 6.6: anti-AI-slop rewrite. Out: em-dashes in the
// title strings, "AI marketing suite for indie founders" framing
// that targets the wrong noun (we serve the BUILDER, not the
// "indie founder" cohort), and the "Ship it your way" cliché.
// In: positioning that names the actual customer ("people who
// built the product first") and a description in the founder's
// own voice.
export const metadata = {
  title:
    'Helm: Marketing for people who built the product first',
  description:
    'You built the product. Now you have to market it. Helm reads your brand from any URL or Instagram, writes posts that sound like you, and ships them anywhere. Free for the first 20 founders.',
  openGraph: {
    title:
      'Helm: Marketing for people who built the product first',
    description:
      "You built the product. Now you have to market it. Helm does the part you avoid. Free for the first 20 founders.",
    url: 'https://trythelm.com',
    siteName: 'Helm',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image' as const,
    title: 'Helm: Marketing for people who built the product first',
    description: 'You built the product. Now you have to market it.',
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
