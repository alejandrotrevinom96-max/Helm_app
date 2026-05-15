// PR #86 — Sprint 7.10: HeyGen stock avatar list proxy.
//
// GET /api/heygen/avatars
// Returns the trimmed list of stock avatars HeyGen offers under
// the founder's account. We proxy (instead of having the browser
// call HeyGen directly) because:
//   1. The HeyGen API key must stay server-side.
//   2. We filter the upstream payload to the three fields the
//      Settings dropdown actually renders (avatar_id, name,
//      preview_image_url) — keeps the page payload tiny.
//   3. We can cache per-deploy in front of HeyGen's quota.
//
// Auth: any logged-in user can list — the picker drives a
// settings choice scoped to their own active project later.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isHeygenEnvConfigured } from '@/lib/heygen/gate';

interface HeygenAvatarRaw {
  avatar_id?: string;
  avatar_name?: string;
  name?: string;
  preview_image_url?: string;
  preview_url?: string;
  gender?: string;
  premium?: boolean;
  // PR Sprint 7.25 Phase 11.12 — HeyGen exposes each avatar's
  // recommended voice. We pass it through to the picker so the
  // avatar-save endpoint can stamp the project with a working
  // voice_id automatically (the V2 API now rejects payloads that
  // omit voice_id).
  default_voice?: string;
}

interface HeygenAvatarsResponse {
  error?: { message?: string } | null;
  data?: {
    avatars?: HeygenAvatarRaw[];
  };
}

export interface AvatarOption {
  avatarId: string;
  name: string;
  previewImageUrl: string | null;
  gender: string | null;
  premium: boolean;
  // PR Sprint 7.25 Phase 11.12 — passes through to the picker UI
  // so the avatar save can stamp project.heygenVoiceId with the
  // avatar's recommended voice on selection.
  defaultVoiceId: string | null;
}

// 10-minute cache — HeyGen's avatar catalog changes rarely; we
// don't need to hammer their API on every Settings page load.
export const revalidate = 600;

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isHeygenEnvConfigured()) {
    return NextResponse.json(
      {
        error: 'HeyGen is not configured for this deployment.',
        errorKind: 'feature_disabled',
        avatars: [],
      },
      { status: 503 },
    );
  }

  try {
    const res = await fetch('https://api.heygen.com/v2/avatars', {
      method: 'GET',
      headers: {
        'x-api-key': process.env.HEYGEN_API_KEY!,
        accept: 'application/json',
      },
      // Match the route-level revalidate so Next's fetch cache is
      // the source of truth (revalidate-on-build / on-cache-tag).
      next: { revalidate: 600 },
    });
    const body = (await res.json().catch(
      () => ({}),
    )) as HeygenAvatarsResponse;

    if (!res.ok || body.error) {
      return NextResponse.json(
        {
          error: body.error?.message ?? `HeyGen returned HTTP ${res.status}`,
          avatars: [],
        },
        { status: 502 },
      );
    }

    const trimmed: AvatarOption[] = (body.data?.avatars ?? [])
      .map((a) => ({
        avatarId: a.avatar_id ?? '',
        name: a.avatar_name ?? a.name ?? 'Untitled avatar',
        previewImageUrl: a.preview_image_url ?? a.preview_url ?? null,
        gender: a.gender ?? null,
        premium: Boolean(a.premium),
        defaultVoiceId: a.default_voice ?? null,
      }))
      .filter((a) => a.avatarId);

    return NextResponse.json({ avatars: trimmed });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : 'HeyGen request failed',
        avatars: [],
      },
      { status: 502 },
    );
  }
}
