// PR #68 — Sprint 7.1B: Compass Priority Matrix sub-page.
//
// Server-resolves the active project + the latest matrix + items
// + a has-analysis gate (the generator requires brand_analysis).
// Hands off to the client for interactive flows.
//
// We deliberately do NOT replace the existing /compass root page —
// the dial/score work from prior sprints stays. This lives at
// /compass/priority as a sibling sub-page.
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getActiveProject } from '@/lib/active-project';
import { db } from '@/lib/db';
import {
  priorityMatrices,
  priorityItems,
  brandAnalysis,
} from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { PriorityClient } from './client';

export default async function CompassPriorityPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const project = await getActiveProject(user.id);
  if (!project) redirect('/onboarding');

  const [analysis] = await db
    .select({ id: brandAnalysis.id })
    .from(brandAnalysis)
    .where(eq(brandAnalysis.projectId, project.id))
    .orderBy(desc(brandAnalysis.createdAt))
    .limit(1);

  const [matrix] = await db
    .select()
    .from(priorityMatrices)
    .where(eq(priorityMatrices.projectId, project.id))
    .orderBy(desc(priorityMatrices.createdAt))
    .limit(1);

  const items = matrix
    ? await db
        .select()
        .from(priorityItems)
        .where(eq(priorityItems.matrixId, matrix.id))
        .orderBy(desc(priorityItems.impactScore))
    : [];

  return (
    <PriorityClient
      project={{ id: project.id, name: project.name }}
      hasBrandAnalysis={Boolean(analysis)}
      initialMatrix={
        matrix
          ? {
              id: matrix.id,
              totalItems: matrix.totalItems,
              itemsDoNow: matrix.itemsDoNow,
              itemsScheduled: matrix.itemsScheduled,
              itemsFillers: matrix.itemsFillers,
              itemsAvoid: matrix.itemsAvoid,
              expiresAt: matrix.expiresAt?.toISOString() ?? null,
              createdAt: matrix.createdAt.toISOString(),
            }
          : null
      }
      initialItems={items.map((i) => ({
        id: i.id,
        title: i.title,
        description: i.description,
        impactScore: i.impactScore,
        effortScore: i.effortScore,
        quadrant: i.quadrant,
        userOverrideQuadrant: i.userOverrideQuadrant,
        sourceType: i.sourceType,
        sourceContext: i.sourceContext,
        suggestedAction: i.suggestedAction,
        suggestedContentType: i.suggestedContentType,
        suggestedPlatform: i.suggestedPlatform,
        userStatus: i.userStatus,
        reasoning: i.reasoning,
      }))}
    />
  );
}
