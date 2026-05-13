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
import { projects } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AvatarType = 'stock' | 'photo' | 'twin';
const AVATAR_TYPES: AvatarType[] = ['stock', 'photo', 'twin'];

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
        { error: 'avatarType must be one of: stock, photo, twin' },
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

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: 'No updatable fields supplied' },
      { status: 400 },
    );
  }

  await db.update(projects).set(updates).where(eq(projects.id, id));

  const refreshed = await loadOwnedProject(user.id, id);
  return NextResponse.json({
    avatarType: (refreshed?.heygenAvatarType ?? 'stock') as AvatarType,
    avatarId: refreshed?.heygenAvatarId ?? null,
    photoUrl: refreshed?.heygenPhotoUrl ?? null,
    voiceId: refreshed?.heygenVoiceId ?? null,
  });
}
