// PR #23 — Sprint 2.2: Library funcional.
//
// Server shell: resolves the active project (cookie-driven, falling back
// to the user's oldest project) and hands it to the client. We do this
// SSR-style so the user can never accidentally land on Library showing
// posts from a project they don't own — getActiveProject already enforces
// userId match.
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getActiveProject } from '@/lib/active-project';
import { LibraryClient } from './client';

export default async function LibraryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const project = await getActiveProject(user.id);
  if (!project) redirect('/onboarding');

  return (
    <LibraryClient
      projectId={project.id}
      projectName={project.name}
    />
  );
}
