// PR #70 — Sprint 7.1C: Blind Spots server shell.
//
// Resolves the active project, pre-loads any existing scan rows
// (so the client knows immediately whether to show "Run first
// scan" or the populated panel without an extra roundtrip), and
// also checks whether brand analysis exists — the scan endpoint
// requires it, and showing the requirement upfront is friendlier
// than the 400 surfacing mid-click.
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getActiveProject } from '@/lib/active-project';
import { db } from '@/lib/db';
import {
  compassBlindSpots,
  brandAnalysis,
  positioningBenchmarks,
} from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { BlindSpotsClient } from './client';

export default async function CompassBlindSpotsPage() {
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

  const [benchmark] = await db
    .select({ id: positioningBenchmarks.id })
    .from(positioningBenchmarks)
    .where(eq(positioningBenchmarks.projectId, project.id))
    .orderBy(desc(positioningBenchmarks.createdAt))
    .limit(1);

  const rows = await db
    .select()
    .from(compassBlindSpots)
    .where(eq(compassBlindSpots.projectId, project.id))
    .orderBy(
      desc(compassBlindSpots.detected),
      desc(compassBlindSpots.confidenceScore),
    );

  const initialRows = rows.map((r) => ({
    id: r.id,
    framework: r.framework,
    detected: r.detected,
    severity: r.severity,
    confidenceScore: r.confidenceScore,
    title: r.title,
    description: r.description,
    evidence: Array.isArray(r.evidence) ? (r.evidence as string[]) : [],
    recommendation: r.recommendation,
    suggestedActions: Array.isArray(r.suggestedActions)
      ? (r.suggestedActions as string[])
      : [],
    userStatus: r.userStatus,
    userNotes: r.userNotes,
    createdAt:
      r.createdAt instanceof Date ? r.createdAt.toISOString() : null,
    expiresAt:
      r.expiresAt instanceof Date ? r.expiresAt.toISOString() : null,
  }));

  return (
    <BlindSpotsClient
      project={{ id: project.id, name: project.name }}
      hasBrandAnalysis={Boolean(analysis)}
      hasBenchmark={Boolean(benchmark)}
      initialBlindSpots={initialRows}
    />
  );
}
