// PR Sprint D-8 — backfill stable UUIDs into existing pain points.
//
// Pre-D-8 the pain_points jsonb arrays on research_insights stored
// items without an `id` field. The Studio routing flow needs an id
// to look up a pain point from a URL param, so every existing row
// gets a fresh UUID stamped in-place.
//
// POST /api/admin/backfill-pain-point-ids
//   Scans every research_insights row, walks the pain_points
//   jsonb, and assigns crypto.randomUUID() to any item missing an
//   id. Returns a count summary.
//
// Idempotent: items that already have an id (newly-created post-
// D-8 deploy) are left alone. Safe to re-run.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { researchInsights } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export const maxDuration = 60;

interface PainPointShape {
  id?: string;
  theme?: string;
  frequency?: number;
  sampleQuote?: string;
  platform?: string;
  isOnDomain?: boolean;
  actionableAngle?: string;
}

export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rows = await db
      .select({
        id: researchInsights.id,
        painPoints: researchInsights.painPoints,
      })
      .from(researchInsights);

    let scannedRows = 0;
    let updatedRows = 0;
    let assignedIds = 0;
    let alreadyHadIds = 0;

    for (const row of rows) {
      scannedRows += 1;
      if (!Array.isArray(row.painPoints) || row.painPoints.length === 0) {
        continue;
      }
      const arr = row.painPoints as PainPointShape[];
      let dirty = false;
      const next = arr.map((p) => {
        if (p?.id) {
          alreadyHadIds += 1;
          return p;
        }
        dirty = true;
        assignedIds += 1;
        return { ...p, id: crypto.randomUUID() };
      });
      if (dirty) {
        await db
          .update(researchInsights)
          .set({ painPoints: next })
          .where(eq(researchInsights.id, row.id));
        updatedRows += 1;
      }
    }

    return NextResponse.json({
      success: true,
      scannedRows,
      updatedRows,
      assignedIds,
      alreadyHadIds,
      message: `Stamped ${assignedIds} new ids across ${updatedRows} rows. ${alreadyHadIds} pain points already had ids.`,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Backfill failed' },
      { status: 500 },
    );
  }
}

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rows = await db
      .select({ painPoints: researchInsights.painPoints })
      .from(researchInsights);

    let total = 0;
    let withId = 0;
    for (const row of rows) {
      const arr = Array.isArray(row.painPoints)
        ? (row.painPoints as PainPointShape[])
        : [];
      for (const p of arr) {
        total += 1;
        if (p?.id) withId += 1;
      }
    }

    return NextResponse.json({
      totalPainPoints: total,
      withId,
      withoutId: total - withId,
      coverage: total > 0 ? Math.round((withId / total) * 100) : 100,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Status check failed' },
      { status: 500 },
    );
  }
}
