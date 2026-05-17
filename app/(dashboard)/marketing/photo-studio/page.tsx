// PR Sprint D-8 Phase 2 — Photo Studio chat-agent page.
//
// Replaces the legacy form-flow surface (Brand Bible card +
// PerformanceInsights + AssetGeneratePanel) with the new chat-
// agent paradigm. The page itself is a thin server shell (auth +
// active-project resolve); PhotoStudioClient owns the three-panel
// UI + state-machine driving.
//
// Revert path: the old AssetGeneratePanel + BrandBible card stay
// at components/marketing/asset-generate-panel.tsx and
// components/marketing/collapsible-brand-bible.tsx — restoring
// the legacy surface is a one-line import swap here.
//
// History — this file was app/(dashboard)/marketing/generate/page.tsx
// through PR #76 → Sprint 7.26 → Sprint D-8 Phase 1 (where it got
// renamed to photo-studio/). Sprint D-8 Phase 2 (this PR) is the
// substantive replacement of the flow.
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getActiveProject } from '@/lib/active-project';
import { PhotoStudioClient } from './client';

export default async function PhotoStudioPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const project = await getActiveProject(user.id);
  if (!project) redirect('/onboarding');

  return <PhotoStudioClient projectId={project.id} />;
}
