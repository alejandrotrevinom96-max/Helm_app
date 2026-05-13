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
// PR #82 — Sprint 7.7: metadata updated for v3.0 positioning.
// Title compresses the new category claim ("Marketing OS"). Description
// names the actual swap (replaces Buffer / ChatGPT / Notion) so the
// SERP snippet earns the click on intent rather than vibes.
export const metadata = {
  title: 'Helm — Your Marketing OS, built for builders',
  description:
    'Stop juggling 7 marketing tabs. Helm replaces Buffer, ChatGPT, Notion, and 4 other tools with one workspace built around your brand voice and strategy.',
  openGraph: {
    title: 'Helm — Your Marketing OS, built for builders',
    description:
      'Stop juggling 7 marketing tabs. One workspace for voice-aware drafts, multi-platform publishing, and strategic clarity. Free for the first 20 founders.',
    url: 'https://trythelm.com',
    siteName: 'Helm',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image' as const,
    title: 'Helm — Your Marketing OS, built for builders',
    description:
      'One workspace replaces Buffer + ChatGPT + Notion + 4 other tabs. Built for builders.',
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
