// PR Sprint D-5 — Video Translation entry point + collection list.
//
// POST /api/heygen/translate
//   Body: { sourceJobId, targetLanguages: string[], mode? }
//   Creates one heygen_translation_jobs row per target language.
//   HeyGen returns one translation_id per language; we persist
//   them in parallel.
//
// GET /api/heygen/translate?sourceJobId=...
//   Lists every translation job for a source render so the
//   Library modal can show a per-language status grid.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  heygenJobs,
  heygenTranslationJobs,
  projects,
  type HeygenTranslationJobRow,
} from '@/lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { isHeygenEnvConfigured } from '@/lib/heygen/gate';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  createVideoTranslation,
  type TranslationMode,
} from '@/lib/heygen/v3-client';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const maxDuration = 60;

function serialize(row: HeygenTranslationJobRow) {
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

// ─── POST: create translations ───────────────────────────────

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isHeygenEnvConfigured()) {
    return NextResponse.json(
      { error: 'HeyGen is not configured for this deployment.' },
      { status: 503 },
    );
  }
  const limit = checkRateLimit(`translate:${user.id}`, 6, 60 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
        hint: `Try again in ${Math.ceil(limit.resetMs / 60000)} minutes.`,
      },
      { status: 429 },
    );
  }

  let body: {
    sourceJobId?: string;
    targetLanguages?: string[];
    mode?: TranslationMode;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const sourceJobId = body.sourceJobId;
  const targets = (body.targetLanguages ?? []).filter(
    (l): l is string => typeof l === 'string' && l.trim().length > 0,
  );
  if (!sourceJobId || !UUID_RE.test(sourceJobId)) {
    return NextResponse.json(
      { error: 'sourceJobId required' },
      { status: 400 },
    );
  }
  if (targets.length === 0) {
    return NextResponse.json(
      { error: 'targetLanguages required (≥1)' },
      { status: 400 },
    );
  }
  // Hard cap per request — HeyGen accepts up to 10+ but each
  // costs quota. 8 lines up with the unique reasonable locales
  // we surface in the UI.
  if (targets.length > 8) {
    return NextResponse.json(
      { error: 'Max 8 languages per request' },
      { status: 400 },
    );
  }
  const mode: TranslationMode =
    body.mode === 'precision' ? 'precision' : 'speed';

  const [row] = await db
    .select({ job: heygenJobs, project: projects })
    .from(heygenJobs)
    .innerJoin(projects, eq(projects.id, heygenJobs.projectId))
    .where(
      and(eq(heygenJobs.id, sourceJobId), eq(projects.userId, user.id)),
    )
    .limit(1);
  if (!row) {
    return NextResponse.json(
      { error: 'Source render not found or forbidden' },
      { status: 403 },
    );
  }
  if (row.job.status !== 'completed' || !row.job.videoUrl) {
    return NextResponse.json(
      {
        error:
          'Source render must be completed before translation. Wait for the avatar pass to finish.',
      },
      { status: 409 },
    );
  }

  const t = await createVideoTranslation({
    videoUrl: row.job.videoUrl,
    outputLanguages: targets,
    mode,
    title: `Translation of ${sourceJobId.slice(0, 8)}`,
    enableCaption: true,
    enableSpeechEnhancement: true,
  });
  if (!t.ok) {
    return NextResponse.json(
      { error: `Translation submission failed: ${t.error}` },
      { status: 502 },
    );
  }

  // HeyGen returns translation IDs in the SAME order as
  // outputLanguages was sent. Persist one row per pair.
  const inserts = await Promise.all(
    targets.map(async (lang, i) => {
      const id = t.translationIds[i];
      if (!id) return null;
      const [created] = await db
        .insert(heygenTranslationJobs)
        .values({
          userId: user.id,
          projectId: row.project.id,
          sourceJobId,
          heygenTranslationId: id,
          targetLanguage: lang,
          mode,
          status: 'processing',
        })
        .returning();
      return created;
    }),
  );

  const created = inserts.filter(
    (r): r is HeygenTranslationJobRow => r !== null,
  );
  return NextResponse.json({
    translations: created.map(serialize),
    requested: targets.length,
  });
}

// ─── GET: list translations for a source ─────────────────────

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const sourceJobId = searchParams.get('sourceJobId');
  if (!sourceJobId || !UUID_RE.test(sourceJobId)) {
    return NextResponse.json(
      { error: 'sourceJobId required' },
      { status: 400 },
    );
  }
  const rows = await db
    .select()
    .from(heygenTranslationJobs)
    .where(
      and(
        eq(heygenTranslationJobs.userId, user.id),
        eq(heygenTranslationJobs.sourceJobId, sourceJobId),
      ),
    )
    .orderBy(desc(heygenTranslationJobs.createdAt));
  return NextResponse.json({ translations: rows.map(serialize) });
}
