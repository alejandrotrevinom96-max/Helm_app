// PR Sprint D-5 — poll a single translation job.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { heygenTranslationJobs } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { getVideoTranslation } from '@/lib/heygen/v3-client';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const maxDuration = 30;

function serialize(row: typeof heygenTranslationJobs.$inferSelect) {
  return {
    id: row.id,
    sourceJobId: row.sourceJobId,
    heygenTranslationId: row.heygenTranslationId,
    targetLanguage: row.targetLanguage,
    mode: row.mode,
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
    .from(heygenTranslationJobs)
    .where(
      and(
        eq(heygenTranslationJobs.id, id),
        eq(heygenTranslationJobs.userId, user.id),
      ),
    )
    .limit(1);
  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (row.status === 'completed' || row.status === 'failed') {
    return NextResponse.json({ translation: serialize(row) });
  }
  const r = await getVideoTranslation(row.heygenTranslationId);
  if (!r.ok) {
    return NextResponse.json({
      translation: serialize(row),
      warning: r.error,
    });
  }
  const updates: Partial<typeof heygenTranslationJobs.$inferSelect> = {
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
      r.job.failure_message ?? r.job.failure_code ?? 'Translation failed';
  }
  if (
    (r.job.status === 'completed' || r.job.status === 'failed') &&
    !row.completedAt
  ) {
    updates.completedAt = new Date();
  }
  await db
    .update(heygenTranslationJobs)
    .set(updates)
    .where(eq(heygenTranslationJobs.id, row.id));
  return NextResponse.json({
    translation: serialize({ ...row, ...updates } as typeof row),
  });
}
