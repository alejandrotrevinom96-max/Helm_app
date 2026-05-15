// PR Sprint 7.22 Sprint B — Patch 2 product bridges auto-trigger.
//
// Fire-and-forget helper used by save-brand-context (and any future
// save path that touches brandContext). Conditions for actually
// running the LLM intake:
//
//   1. The project's brandContext already has audience.primary
//      .painPoints with at least 3 entries (we need pains to seed
//      the intake; without them the LLM has nothing to bridge from).
//   2. The project's brandContext does NOT already have at least 3
//      approved bridges (so the intake only runs once per project,
//      avoiding cost + churn from re-running on every brand-bible
//      tweak).
//   3. The project's brandContext has at least some product framing:
//      identity.name OR identity.tagline OR messaging.primaryTagline
//      OR a meaningful pillar list (1+ pillar with a description).
//
// All checks fail-closed — if any condition isn't met, the helper
// no-ops silently. The caller does NOT await this function — it
// kicks off the Haiku call in the background and lets the response
// return immediately.

import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import type { BrandBible, ProductBridge } from '@/lib/types/brand';
import { logAudit } from '@/lib/voice-engine/loader';
import { generateBridgeDrafts } from './product-bridge-intake';

const MIN_PAIN_POINTS = 3;
const MIN_APPROVED_BRIDGES = 3;

/**
 * Best-effort background trigger for the LLM intake.
 *
 * Loads the project's brandContext, checks the gating conditions
 * above, and either:
 *   - runs the intake + writes the resulting bridges back to the
 *     project row, OR
 *   - no-ops silently when conditions aren't met.
 *
 * Failures are logged but never rethrown — this is fire-and-forget.
 */
export async function maybeGenerateBridges(
  projectId: string,
  userId: string,
): Promise<void> {
  try {
    const [row] = await db
      .select({ brandContext: projects.brandContext })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!row) return;

    const bible = (row.brandContext as BrandBible | null) ?? null;
    if (!bible) return;

    // Already have enough approved bridges? Skip — the intake only
    // runs once per project. An operator who wants to re-run can
    // null the field out via SQL (or we add an admin endpoint later).
    const existingBridges = bible.painToProductBridges ?? [];
    const approvedCount = existingBridges.filter((b) => !b.pendingReview).length;
    if (approvedCount >= MIN_APPROVED_BRIDGES) return;

    // Need enough audience pain points to seed the intake.
    const pains = bible.audience?.primary?.painPoints ?? [];
    if (pains.length < MIN_PAIN_POINTS) return;

    // Need at least some product framing.
    const oneLiner =
      bible.identity?.tagline ??
      bible.messaging?.primaryTagline ??
      bible.identity?.name ??
      null;
    if (!oneLiner) return;

    const productDescription = buildProductDescription(bible);
    if (productDescription.length < 20) return;

    const drafts = await generateBridgeDrafts({
      productDescription,
      audiencePains: pains.map((p) => p.pain),
      marketingOneLiner: oneLiner,
    });

    if (drafts.length === 0) {
      // Intake produced 0 survivors after the quality gate. Audit
      // the no-op so operators can investigate if it persists.
      void logAudit({
        userId,
        projectId,
        action: 'product_bridge_intake_no_survivors',
        notes: 'LLM intake returned 0 bridges after quality gate',
      }).catch(() => {});
      return;
    }

    // Merge: keep any existing approved bridges, append new ones.
    // (In practice approvedCount < 3 here, so this is usually just
    // the new list — but the merge keeps any operator-edited
    // historical bridges intact.)
    const merged: ProductBridge[] = [
      ...existingBridges,
      ...drafts,
    ];

    const nextBible: BrandBible = {
      ...bible,
      painToProductBridges: merged,
    };

    await db
      .update(projects)
      .set({ brandContext: nextBible })
      .where(eq(projects.id, projectId));

    void logAudit({
      userId,
      projectId,
      action: 'product_bridge_intake_completed',
      notes: `generated ${drafts.length} auto-approved bridges`,
    }).catch(() => {});
  } catch (err) {
    // Fire-and-forget: never bubble up to the caller. Log so the
    // failure is observable in server logs.
    console.warn(
      '[maybe-generate-bridges] background intake failed:',
      err instanceof Error ? err.message : err,
    );
  }
}

function buildProductDescription(bible: BrandBible): string {
  const parts: string[] = [];
  if (bible.identity?.tagline) parts.push(bible.identity.tagline);
  if (bible.identity?.mission) parts.push(`Mission: ${bible.identity.mission}`);
  const pillars = (bible.pillars ?? []).filter((p) => p.name && p.description);
  if (pillars.length > 0) {
    const list = pillars
      .slice(0, 4)
      .map((p) => `${p.name} — ${p.description}`)
      .join('; ');
    parts.push(`Core pillars: ${list}.`);
  }
  if (bible.messaging?.primaryTagline) {
    parts.push(`Tagline: ${bible.messaging.primaryTagline}.`);
  }
  return parts.join(' ').trim();
}
