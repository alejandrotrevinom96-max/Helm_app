import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getActiveProject } from '@/lib/active-project';
import { MarketingClient } from '../client';

// PR #22 split the Marketing tab into Generate / Calendar / Library
// sub-tabs. PR #23 stripped the right sidebar (Upcoming posts + Recent
// generations) — those live in Library now. This page is just the
// generation surface: brand bible, drafts, schedule.
export default async function MarketingGeneratePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const project = await getActiveProject(user.id);
  if (!project) redirect('/onboarding');

  // Server-side check: only show "Add visual" buttons / show loading
  // states / etc. when fal.ai is wired up. Avoids the user clicking and
  // getting a 503 they can't act on.
  const visualsAvailable = !!process.env.FAL_API_KEY;

  return (
    <MarketingClient
      project={project}
      // PR #32 — Sprint 5.3: Reels uploads go directly from the
      // browser to Supabase Storage. We need the user id to namespace
      // the upload path (RLS enforces "users can only write to their
      // own folder"). Server-rendered prop avoids a client roundtrip.
      userId={user.id}
      visualsAvailable={visualsAvailable}
    />
  );
}
