// PR Sprint D-4 — poll a lipsync job.
//
// GET /api/heygen/lipsync/[id]
//   Polls HeyGen for the latest status, persists the snapshot
//   locally, and returns the merged view. Client polls every
//   5s while status is 'pending' / 'processing'.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { heygenLipsyncJobs } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { getLipsync } from '@/lib/heygen/v3-client';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const maxDuration = 30;

function serialize(row: typeof heygenLipsyncJobs.$inferSelect) {
  return {
    id: row.id,
    sourceJobId: row.sourceJobId,
    heygenLipsyncId: row.heygenLipsyncId,
    mode: row.mode,
    editedScript: row.editedScript,
    status: row.status,
    resultVideoUrl: row.resultVideoUrl,
    resultCaptionUrl: row.resultCaptionUrl,
    durationSec: row.durationSec,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

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
  const [row] = await db
    .select()
    .from(heygenLipsyncJobs)
    .where(
      and(
        eq(heygenLipsyncJobs.id, id),
        eq(heygenLipsyncJobs.userId, user.id),
      ),
    )
    .limit(1);
  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Short-circuit for terminal states — saves quota.
  if (row.status === 'completed' || row.status === 'failed') {
    return NextResponse.json({ lipsync: serialize(row) });
  }

  // Poll HeyGen.
  const r = await getLipsync(row.heygenLipsyncId);
  if (!r.ok) {
    // Soft error — keep the row alive, surface the error on
    // next poll. Don't flip to 'failed' yet (HeyGen recovers
    // from transient blips).
    return NextResponse.json({ lipsync: serialize(row), warning: r.error });
  }

  const updates: Partial<typeof heygenLipsyncJobs.$inferSelect> = {
    status: r.job.status,
    updatedAt: new Date(),
  };
  if (r.job.video_url) updates.resultVideoUrl = r.job.video_url;
  if (r.job.caption_url) updates.resultCaptionUrl = r.job.caption_url;
  if (r.job.duration != null) {
    updates.durationSec = r.job.duration.toFixed(2);
  }
  if (r.job.status === 'failed') {
    updates.errorMessage =
      r.job.failure_message ?? r.job.failure_code ?? 'Lipsync failed';
  }
  if (
    (r.job.status === 'completed' || r.job.status === 'failed') &&
    !row.completedAt
  ) {
    updates.completedAt = new Date();
  }

  await db
    .update(heygenLipsyncJobs)
    .set(updates)
    .where(eq(heygenLipsyncJobs.id, row.id));

  return NextResponse.json({
    lipsync: serialize({ ...row, ...updates } as typeof row),
  });
}
