// PR Sprint D-8 — pain point lookup by stable UUID.
//
// GET /api/research/pain-points/[id]
//   Scans the user's research_insights jsonb arrays for a pain
//   point with the matching id. Returns the full pain-point
//   object so the Studio agents (UGC + Photo) can hydrate from
//   a URL param without the founder re-typing context.
//
// Why scan instead of join: pain points live as a jsonb array on
// research_insights, not as their own table. A real table is
// queued for a future sprint (the user explicitly wants by-niche
// analytics). For now we filter the small set of insights rows
// per project and walk the jsonb in memory — at our scale (~10
// insights × ≤10 pain points per project) this is microseconds.
//
// Ownership: enforced via projects.userId — same pattern as every
// other research endpoint.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  projects,
  researchInsights,
} from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';

export const maxDuration = 15;

interface PainPointShape {
  id?: string;
  theme?: string;
  frequency?: number;
  sampleQuote?: string;
  platform?: string;
  isOnDomain?: boolean;
  actionableAngle?: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  // Pull every insights row across every project the user owns.
  // We have to walk all of them because the founder might bounce
  // between projects in a single session and a pain-point id
  // doesn't carry its project id in the URL.
  const rows = await db
    .select({
      id: researchInsights.id,
      projectId: researchInsights.projectId,
      painPoints: researchInsights.painPoints,
    })
    .from(researchInsights)
    .innerJoin(projects, eq(projects.id, researchInsights.projectId))
    .where(eq(projects.userId, user.id))
    .limit(200);

  for (const row of rows) {
    const arr = Array.isArray(row.painPoints)
      ? (row.painPoints as PainPointShape[])
      : [];
    const hit = arr.find((p) => p?.id === id);
    if (hit) {
      return NextResponse.json({
        painPoint: {
          id: hit.id,
          theme: hit.theme ?? '',
          frequency: hit.frequency ?? 0,
          sampleQuote: hit.sampleQuote ?? '',
          platform: hit.platform ?? 'unknown',
          isOnDomain: hit.isOnDomain !== false,
          actionableAngle: hit.actionableAngle ?? '',
        },
        projectId: row.projectId,
        insightId: row.id,
      });
    }
  }

  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}
