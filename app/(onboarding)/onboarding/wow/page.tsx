// PR Sprint onboarding-wow — Cambio D.
//
// Server shell for /onboarding/wow.
//
// This is the FINAL step of the new-project flow surfaced by the
// "+ Add project" sidebar modal. The path is:
//
//   /onboarding/project  → set name + URL (handled elsewhere)
//   /onboarding/brand    → set BrandBible (with optional ✨ Autogen)
//   /onboarding/wow      → THIS page — auto-generate 3 drafts + 1
//                          visual the founder can see before they
//                          even hit the Library.
//
// The shell:
//   - Auth + ownership check on `?projectId=<uuid>`.
//   - Reads project.brand_context.
//   - Pulls valueProp + primaryPain (Cambio A) which the wow client
//     uses to compose the auto-fire prompts. If either is empty
//     we still proceed — the client falls back to brand identity
//     + audience description.
//   - Server-side redirect to /onboarding/brand?project=...&newProject=1
//     when brand_context is missing (the founder can't have skipped
//     it and reached wow with a usable brand, so this is a defensive
//     redirect, not the happy path).
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import type { BrandBible } from '@/lib/types/brand';
import { WowClient } from './client';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function OnboardingWowPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string | string[] }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const params = await searchParams;
  const raw = Array.isArray(params.projectId)
    ? params.projectId[0]
    : params.projectId;
  if (!raw || !UUID_RE.test(raw)) {
    // No project context → bounce to project step. The sidebar modal
    // and /onboarding/brand both always pass projectId, so hitting
    // this branch means the founder hand-typed the URL.
    redirect('/onboarding/project');
  }
  const projectId = raw;

  const [project] = await db
    .select({
      id: projects.id,
      name: projects.name,
      brandContext: projects.brandContext,
    })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);

  if (!project) {
    // Ownership fail → push back to project step. We don't surface
    // an error UI here because the only way to reach this state is
    // a hand-typed URL or a stale tab after the project was
    // deleted; either way "start over" is the right affordance.
    redirect('/onboarding/project');
  }

  const bible = (project.brandContext as BrandBible | null) ?? null;
  if (!bible) {
    // No brand bible yet — defensive redirect. The /onboarding/brand
    // flow saves brand_context before navigating here, so this can
    // only fire if the founder hit /onboarding/wow without coming
    // through brand. Send them back to set the bible first.
    redirect(
      `/onboarding/brand?project=${encodeURIComponent(projectId)}&newProject=1`,
    );
  }

  // Cambio A — wow anchors. Optional on the bible, populated by
  // /api/brand-bible/auto-generate (via /api/brand-bible/quickstart)
  // or hand-entered. The client uses these to compose prompts; if
  // either is empty it falls back to identity + audience.description.
  const valueProp = bible.valueProp?.trim() ?? '';
  const primaryPain = bible.primaryPain?.trim() ?? '';

  // Fallback inputs when the wow anchors are empty. The audience
  // primary description is the closest thing to a pain hint we have
  // outside of valueProp/primaryPain; identity.tagline is the
  // closest thing to a valueProp surrogate.
  const fallbackValueProp =
    bible.identity?.tagline?.trim() ??
    bible.identity?.mission?.trim() ??
    project.name ??
    'this product';
  const fallbackPrimaryPain =
    bible.audience?.primary?.description?.trim() ??
    bible.audience?.primary?.painPoints?.[0]?.pain?.trim() ??
    'the audience problem this brand solves';

  return (
    <WowClient
      projectId={projectId}
      projectName={project.name ?? 'Your brand'}
      valueProp={valueProp || fallbackValueProp}
      primaryPain={primaryPain || fallbackPrimaryPain}
    />
  );
}
