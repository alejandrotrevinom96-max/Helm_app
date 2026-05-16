// PR Sprint D-2 — Studio page (HeyGen V3 Video Agent chat-mode).
//
// Server entry — resolves the active project + auth, hands off
// to the StudioClient. Same shell pattern as Generate / Library
// / Calendar.
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getActiveProject } from '@/lib/active-project';
import { StudioClient } from './client';

export default async function MarketingStudioPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const project = await getActiveProject(user.id);
  if (!project) redirect('/onboarding');

  return <StudioClient projectId={project.id} />;
}
