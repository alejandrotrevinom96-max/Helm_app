// PR Sprint D-finish — list pain points for a project.
//
// GET /api/research/pain-points?projectId=…
//
// Returns the most recent extraction's pain points so the
// Photo Studio + UGC Studio can render them as quick-pick chips
// in the new-session panel. The founder clicks a chip → the
// studio seeds the chat / textarea with that pain point and
// (for Photo Studio) creates a session with painPointId so the
// agent uses its Case-B greeting (theme + real quote + 3 angles).
//
// Returns ONLY the most recent insights row's array, not the
// historical union — older extractions tend to surface the same
// themes worded differently, and the chip rail is for "here's
// what your audience is saying THIS week". Historical analytics
// would warrant a separate endpoint.
//
// Backward compat: rows missing an id (predate the D-8 backfill)
// are filtered out — the studios can't route to them without a
// stable id. Founders see a hint in the picker if the latest
// batch is entirely pre-backfill.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projects, researchInsights } from '@/lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';

export const maxDuration = 15;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PainPointShape {
  id?: string;
  theme?: string;
  frequency?: number;
  sampleQuote?: string;
  platform?: string;
  isOnDomain?: boolean;
  actionableAngle?: string;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('projectId');
  if (!projectId || !UUID_RE.test(projectId)) {
    return NextResponse.json(
      { error: 'projectId required' },
      { status: 400 },
    );
  }

  // Ownership check before reading insights.
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) {
    return NextResponse.json(
      { error: 'Project not found or forbidden' },
      { status: 403 },
    );
  }

  const [latest] = await db
    .select({
      id: researchInsights.id,
      painPoints: researchInsights.painPoints,
      createdAt: researchInsights.createdAt,
    })
    .from(researchInsights)
    .where(eq(researchInsights.projectId, projectId))
    .orderBy(desc(researchInsights.createdAt))
    .limit(1);

  if (!latest) {
    return NextResponse.json({
      painPoints: [],
      insightId: null,
      insightCreatedAt: null,
      missingIds: 0,
    });
  }

  const arr = Array.isArray(latest.painPoints)
    ? (latest.painPoints as PainPointShape[])
    : [];
  // Stable shape — only return what the studios actually consume.
  // Drop pre-backfill rows (no id) so the picker chips never 404.
  // Surface missingIds count so the UI can hint "run backfill".
  const withId = arr.filter((p) => typeof p?.id === 'string');
  const missingIds = arr.length - withId.length;

  return NextResponse.json({
    painPoints: withId.map((p) => ({
      id: p.id,
      theme: p.theme ?? '',
      frequency: p.frequency ?? 0,
      sampleQuote: p.sampleQuote ?? '',
      platform: p.platform ?? 'unknown',
      actionableAngle: p.actionableAngle ?? '',
    })),
    insightId: latest.id,
    insightCreatedAt: latest.createdAt.toISOString(),
    missingIds,
  });
}
