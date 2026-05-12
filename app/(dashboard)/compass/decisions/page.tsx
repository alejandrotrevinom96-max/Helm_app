// PR #71 — Sprint 7.1E: Decision Log server shell.
//
// Pre-loads the decision rows + brand analysis presence (so the
// "score" path can render the empty state vs the requirement
// banner upfront without an extra roundtrip). We don't pre-load
// the benchmark — the score endpoint uses it if present but the
// UI doesn't gate on it.
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getActiveProject } from '@/lib/active-project';
import { db } from '@/lib/db';
import { compassDecisions, brandAnalysis } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { DecisionsClient } from './client';

export default async function CompassDecisionsPage() {
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

  const rows = await db
    .select()
    .from(compassDecisions)
    .where(eq(compassDecisions.projectId, project.id))
    .orderBy(desc(compassDecisions.decidedAt));

  const initialDecisions = rows.map((d) => ({
    id: d.id,
    title: d.title,
    description: d.description,
    category: d.category,
    alignmentScore: d.alignmentScore,
    alignmentReasoning: d.alignmentReasoning,
    reversibility: d.reversibility,
    reversalCostNotes: d.reversalCostNotes,
    founderConfidence: d.founderConfidence,
    status: d.status,
    decidedAt:
      d.decidedAt instanceof Date ? d.decidedAt.toISOString() : null,
    evaluatedAt:
      d.evaluatedAt instanceof Date ? d.evaluatedAt.toISOString() : null,
    outcomeWorked: d.outcomeWorked,
    outcomeNotes: d.outcomeNotes,
    lessonsLearned: d.lessonsLearned,
    aiRetrospective: d.aiRetrospective,
  }));

  // Build summary same shape as the GET endpoint so the client
  // doesn't need a re-fetch on mount.
  const evaluatedRows = initialDecisions.filter(
    (d) => d.outcomeWorked !== null,
  );
  const workedRows = initialDecisions.filter((d) => d.outcomeWorked === true);

  const initialSummary = {
    total: initialDecisions.length,
    decided: initialDecisions.filter((d) => d.status === 'decided').length,
    executing: initialDecisions.filter((d) => d.status === 'executing').length,
    evaluated: initialDecisions.filter((d) => d.status === 'evaluated').length,
    reversed: initialDecisions.filter((d) => d.status === 'reversed').length,
    avgAlignment:
      initialDecisions.length > 0
        ? Math.round(
            initialDecisions.reduce(
              (s, d) => s + (d.alignmentScore ?? 0),
              0,
            ) / initialDecisions.length,
          )
        : null,
    workedRate:
      evaluatedRows.length > 0
        ? Math.round((workedRows.length / evaluatedRows.length) * 100)
        : null,
  };

  return (
    <DecisionsClient
      project={{ id: project.id, name: project.name }}
      hasBrandAnalysis={Boolean(analysis)}
      initialDecisions={initialDecisions}
      initialSummary={initialSummary}
    />
  );
}
