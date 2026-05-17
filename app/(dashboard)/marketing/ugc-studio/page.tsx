// PR Sprint D-2 — UGC Studio page (V3 Video Agent chat-mode).
// PR Sprint D-8 — route renamed from /marketing/studio to
// /marketing/ugc-studio (Photo Studio is the new sibling tab for
// images / carousels). next.config.mjs 301-redirects the legacy
// path so external links keep resolving.
//
// Server entry — resolves the active project + auth, hands off
// to the StudioClient. Same shell pattern as Photo Studio /
// Library / Calendar.
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
