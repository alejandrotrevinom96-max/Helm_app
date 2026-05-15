// PR #76 — Sprint 7.3: /marketing/generate refactored to lead
// with the structured-drafts flow.
//
// What changed vs the previous version (PR #60):
//   - The legacy pillar-variants UI (MarketingClient) is no
//     longer rendered here. The component file itself is NOT
//     deleted — it stays at app/(dashboard)/marketing/client.tsx
//     so a quick revert (this file only) can restore the prior
//     behavior if the new flow regresses something.
//   - StructuredGeneratePanel becomes the primary surface
//     (formerly StructuredDraftsPanel was an opt-in collapse at
//     the bottom of the page).
//   - BrandBibleCard is wrapped by CollapsibleBrandBible —
//     collapsed when bible completion ≥80%, expanded with a
//     yellow nudge otherwise.
//   - PerformanceInsights (Voice Memory + Performance Memory)
//     and Voice Fingerprint (inside BrandBibleCard) preserved.
//
// What we deliberately did NOT change:
//   - The marketing sub-nav (Generate/Calendar/Library tabs)
//     lives in app/(dashboard)/marketing/layout.tsx — untouched.
//   - The like/dislike + scheduling APIs — untouched.
//   - The BrandBibleCard internals — wrapped, not edited, so
//     voiceFingerprint rendering and the modal-open behavior
//     stay byte-for-byte identical.
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getActiveProject } from '@/lib/active-project';
import type { BrandBible } from '@/lib/types/brand';
import type { VoiceFingerprint } from '@/lib/types/voice';
import { CollapsibleBrandBible } from '@/components/marketing/collapsible-brand-bible';
import { StructuredGeneratePanel } from '@/components/marketing/structured-generate-panel';
import { PerformanceInsights } from '../performance-insights';

export default async function MarketingGeneratePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const project = await getActiveProject(user.id);
  if (!project) redirect('/onboarding');

  // Reshape the project into BrandProject (the shape
  // CollapsibleBrandBible / BrandBibleCard expect). Same casting
  // pattern as the legacy MarketingClient — voice fingerprint
  // fields are loosely typed on the DB row so we narrow here.
  const projectForCard = {
    id: project.id,
    name: project.name,
    brandUrl: project.brandUrl,
    brandContext: (project.brandContext as BrandBible | null) ?? null,
    voiceFingerprint:
      (
        project as unknown as {
          voiceFingerprint?: VoiceFingerprint | null;
        }
      ).voiceFingerprint ?? null,
    voiceFingerprintUpdatedAt:
      (
        project as unknown as { voiceFingerprintUpdatedAt?: Date | null }
      ).voiceFingerprintUpdatedAt?.toISOString() ?? null,
  };

  return (
    <div className="space-y-6 platform-reveal-2">
      {/* Voice Memory + Performance Memory — unchanged from the
          legacy flow, fetched via /api/marketing/insights. */}
      <PerformanceInsights projectId={project.id} />

      {/* Brand bible — collapsible based on completion score. */}
      <CollapsibleBrandBible project={projectForCard} />

      {/* Primary generation flow — promoted from the opt-in beta
          panel. Handles platform select + content types (with
          Flux/HeyGen badges) + prompt + categorized errors. */}
      <StructuredGeneratePanel projectId={project.id} />
    </div>
  );
}
