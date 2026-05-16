// PR #86 — Sprint 7.10: read + save HeyGen avatar settings per
// project.
//
// GET  → the 4 avatar fields (type / id / photo url / voice).
// PATCH → upsert any subset of those 4.
//
// We didn't extend /api/projects/[id]/content-preferences because
// these settings persist on the `projects` row itself, not on a
// child preferences table. Keeping the routes parallel
// (.../content-preferences and .../heygen-avatar) makes the
// /settings page's data layer trivially testable.
//
// Ownership is enforced via projects.userId — identical pattern
// to the content-preferences route.
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projects, heygenJobs } from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PR Sprint 7.25 Phase 11.15 — 'talking_photo' is a new avatarType
// for HeyGen's modern UGC/Instant Avatar catalog. The picker can
// now save IDs from /v2/talking_photo (kind='talking_photo' on the
// AvatarOption); lib/heygen/fire.ts reads heygenAvatarId as the
// talking_photo_id and builds the matching `character` payload.
// The DB column `projects.heygen_avatar_type` is a plain `text`
// column with no CHECK constraint, so no migration is needed —
// we just expand the API's allowlist.
type AvatarType = 'stock' | 'photo' | 'twin' | 'talking_photo';
const AVATAR_TYPES: AvatarType[] = [
  'stock',
  'photo',
  'twin',
  'talking_photo',
];

async function loadOwnedProject(
  userId: string,
  projectId: string,
): Promise<typeof projects.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  return row ?? null;
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
    return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 });
  }

  const project = await loadOwnedProject(user.id, id);
  if (!project) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json({
    avatarType: (project.heygenAvatarType ?? 'stock') as AvatarType,
    avatarId: project.heygenAvatarId,
    photoUrl: project.heygenPhotoUrl,
    voiceId: project.heygenVoiceId,
    // PR Sprint C — return saved gender pairs so the picker can
    // render the match indicator without a second round-trip.
    avatarGender: project.heygenAvatarGender,
    voiceGender: project.heygenVoiceGender,
    // PR Sprint D-1 — tuning fields. All nullable; null means
    // "use the smart default in fire.ts".
    voiceEmotion: project.heygenVoiceEmotion,
    voiceLocale: project.heygenVoiceLocale,
    voiceSpeed: project.heygenVoiceSpeed,
    avatarExpressiveness: project.heygenAvatarExpressiveness,
    avatarMotionPrompt: project.heygenAvatarMotionPrompt,
  });
}

export async function PATCH(
  request: Request,
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
    return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 });
  }
  if (!(await loadOwnedProject(user.id, id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: {
    avatarType?: unknown;
    avatarId?: unknown;
    photoUrl?: unknown;
    voiceId?: unknown;
    // PR Sprint C — gender fields. Both optional; the picker
    // stamps them when it knows the gender (from the avatars +
    // voices catalogs). Stored normalized to lowercase
    // 'male' | 'female' | 'neutral'.
    avatarGender?: unknown;
    voiceGender?: unknown;
    // PR Sprint D-1 — tuning fields. All optional; pass null
    // to clear (reverts to fire.ts defaults).
    voiceEmotion?: unknown;
    voiceLocale?: unknown;
    voiceSpeed?: unknown;
    avatarExpressiveness?: unknown;
    avatarMotionPrompt?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const updates: Record<string, string | null> = {};
  if (body.avatarType !== undefined) {
    if (
      typeof body.avatarType !== 'string' ||
      !AVATAR_TYPES.includes(body.avatarType as AvatarType)
    ) {
      return NextResponse.json(
        {
          error:
            'avatarType must be one of: stock, photo, twin, talking_photo',
        },
        { status: 400 },
      );
    }
    // 'twin' is intentionally NOT yet usable — but we let users
    // save the choice so the radio button shows their intent. The
    // generate route refuses 'twin' explicitly until the
    // enrollment flow ships.
    updates.heygenAvatarType = body.avatarType;
  }
  if (body.avatarId !== undefined) {
    updates.heygenAvatarId =
      typeof body.avatarId === 'string' && body.avatarId.length > 0
        ? body.avatarId
        : null;
  }
  if (body.photoUrl !== undefined) {
    if (
      body.photoUrl !== null &&
      (typeof body.photoUrl !== 'string' ||
        !body.photoUrl.startsWith('https://'))
    ) {
      return NextResponse.json(
        { error: 'photoUrl must be an https URL or null' },
        { status: 400 },
      );
    }
    updates.heygenPhotoUrl =
      typeof body.photoUrl === 'string' ? body.photoUrl : null;
  }
  if (body.voiceId !== undefined) {
    updates.heygenVoiceId =
      typeof body.voiceId === 'string' && body.voiceId.length > 0
        ? body.voiceId
        : null;
  }
  // PR Sprint C — gender fields. Normalize at write time so the
  // DB never holds 'Male' / 'MALE' / 'female ' / etc. — fire.ts
  // and the UI both expect strict lowercase.
  const normalizeGender = (raw: unknown): string | null => {
    if (typeof raw !== 'string') return null;
    const lower = raw.toLowerCase().trim();
    if (lower === 'male' || lower === 'female' || lower === 'neutral') {
      return lower;
    }
    return null;
  };
  if (body.avatarGender !== undefined) {
    updates.heygenAvatarGender = normalizeGender(body.avatarGender);
  }
  if (body.voiceGender !== undefined) {
    updates.heygenVoiceGender = normalizeGender(body.voiceGender);
  }

  // PR Sprint D-1 — tuning fields. Each normalizer is permissive
  // (returns null on any invalid value) so a buggy client can't
  // poison the row with stray strings; null is the "use default"
  // sentinel fire.ts already understands.
  const ALLOWED_EMOTIONS = new Set([
    'Excited',
    'Friendly',
    'Serious',
    'Soothing',
    'Broadcaster',
    'Angry',
  ]);
  const ALLOWED_EXPRESSIVENESS = new Set(['high', 'medium', 'low']);

  if (body.voiceEmotion !== undefined) {
    if (typeof body.voiceEmotion === 'string') {
      // Title-case before validating against HeyGen's enum.
      const norm =
        body.voiceEmotion.charAt(0).toUpperCase() +
        body.voiceEmotion.slice(1).toLowerCase();
      updates.heygenVoiceEmotion = ALLOWED_EMOTIONS.has(norm) ? norm : null;
    } else {
      updates.heygenVoiceEmotion = null;
    }
  }
  if (body.voiceLocale !== undefined) {
    // Locale shape is loose ('en-US', 'es-MX', etc.). We accept
    // any non-empty lowercase-or-dash string; HeyGen rejects
    // unsupported locales server-side.
    if (typeof body.voiceLocale === 'string' && body.voiceLocale.trim()) {
      updates.heygenVoiceLocale = body.voiceLocale.trim();
    } else {
      updates.heygenVoiceLocale = null;
    }
  }
  if (body.voiceSpeed !== undefined) {
    const n =
      typeof body.voiceSpeed === 'number'
        ? body.voiceSpeed
        : typeof body.voiceSpeed === 'string'
          ? Number(body.voiceSpeed)
          : NaN;
    if (Number.isFinite(n) && n >= 0.5 && n <= 1.5) {
      // Store as text (numeric column accepts string with
      // 2-decimal precision); fire.ts parses with Number()
      // before sending.
      updates.heygenVoiceSpeed = n.toFixed(2);
    } else {
      updates.heygenVoiceSpeed = null;
    }
  }
  if (body.avatarExpressiveness !== undefined) {
    if (
      typeof body.avatarExpressiveness === 'string' &&
      ALLOWED_EXPRESSIVENESS.has(body.avatarExpressiveness)
    ) {
      updates.heygenAvatarExpressiveness = body.avatarExpressiveness;
    } else {
      updates.heygenAvatarExpressiveness = null;
    }
  }
  if (body.avatarMotionPrompt !== undefined) {
    if (
      typeof body.avatarMotionPrompt === 'string' &&
      body.avatarMotionPrompt.trim()
    ) {
      // Hard-cap at 500 chars — HeyGen's motion prompt is a
      // sentence-or-two thing, not a script.
      updates.heygenAvatarMotionPrompt = body.avatarMotionPrompt
        .trim()
        .slice(0, 500);
    } else {
      updates.heygenAvatarMotionPrompt = null;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: 'No updatable fields supplied' },
      { status: 400 },
    );
  }

  await db.update(projects).set(updates).where(eq(projects.id, id));

  // PR Sprint 7.25 Phase 11.8 — re-queue stuck video jobs when the
  // avatar config changes. Before this, a founder whose first
  // generation failed with errorKind='voice_config' or
  // 'not_configured' was stuck:
  //   1. They open Settings, pick a working avatar.
  //   2. They go back to the Generator card.
  //   3. The auto-fire useEffect's ref is still TRUE so it doesn't
  //      re-fire.
  //   4. The cron's retry policy excludes voice_config errors.
  //   5. The job sits at status='failed' forever.
  // Now: any heygen_jobs row for this project with status='failed'
  // gets promoted back to status='queued' + attemptCount=0 +
  // cleared error fields. The heygen-worker cron picks it up
  // within ~60s on the next tick, fires with the new avatar, and
  // the founder's video renders without needing to click anything
  // else. We only do this when the update actually touched avatar
  // fields (not when only voice_id changed alone, which goes
  // through the existing voice-fallback path).
  const touchedAvatarFields =
    'heygenAvatarType' in updates ||
    'heygenAvatarId' in updates ||
    'heygenPhotoUrl' in updates;
  let requeuedCount = 0;
  if (touchedAvatarFields) {
    try {
      const requeued = await db
        .update(heygenJobs)
        .set({
          status: 'queued',
          errorMessage: null,
          errorKind: null,
          attemptCount: 0,
          completedAt: null,
        })
        .where(
          and(
            eq(heygenJobs.projectId, id),
            inArray(heygenJobs.status, ['failed']),
          ),
        )
        .returning({ id: heygenJobs.id });
      requeuedCount = requeued.length;
    } catch (err) {
      // Don't fail the avatar save if the re-queue errors — the
      // founder can manually retry from the Library. Log + move on.
      console.warn(
        '[heygen-avatar] re-queue failed jobs after avatar update:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  const refreshed = await loadOwnedProject(user.id, id);
  return NextResponse.json({
    avatarType: (refreshed?.heygenAvatarType ?? 'stock') as AvatarType,
    avatarId: refreshed?.heygenAvatarId ?? null,
    photoUrl: refreshed?.heygenPhotoUrl ?? null,
    voiceId: refreshed?.heygenVoiceId ?? null,
    // PR Sprint C — return persisted genders so the picker UI
    // re-renders the match indicator off the same source of
    // truth fire.ts reads from.
    avatarGender: refreshed?.heygenAvatarGender ?? null,
    voiceGender: refreshed?.heygenVoiceGender ?? null,
    // PR Sprint D-1 — tuning fields round-trip.
    voiceEmotion: refreshed?.heygenVoiceEmotion ?? null,
    voiceLocale: refreshed?.heygenVoiceLocale ?? null,
    voiceSpeed: refreshed?.heygenVoiceSpeed ?? null,
    avatarExpressiveness: refreshed?.heygenAvatarExpressiveness ?? null,
    avatarMotionPrompt: refreshed?.heygenAvatarMotionPrompt ?? null,
    requeuedFailedJobs: requeuedCount,
  });
}
