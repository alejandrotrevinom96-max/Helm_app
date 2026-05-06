// PR #24 — Sprint 2.3: Calendar funcional.
//
// Server shell — same pattern as Library: resolve the active project
// SSR (cookie-driven, falls back to oldest project), redirect to login
// or onboarding if missing, then hand off to the client component.
//
// Drag-and-drop, drag state, golden-times modal, the date grid — all
// of that lives in client.tsx because it needs interactivity.
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getActiveProject } from '@/lib/active-project';
import { CalendarClient } from './client';

export default async function CalendarPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const project = await getActiveProject(user.id);
  if (!project) redirect('/onboarding');

  return (
    <CalendarClient
      projectId={project.id}
      projectName={project.name}
    />
  );
}
