// PR #86 — Sprint 7.10: HeyGen stock avatar list proxy.
// PR Sprint 7.25 Phase 11.15 — surface HeyGen's modern UGC /
// Instant Avatar catalog alongside the legacy stock catalog.
//
// GET /api/heygen/avatars
// Returns a unified list of:
//   - GET /v2/avatars?include_public=true   (own + public stock)
//   - GET /v2/talking_photo                (Instant / UGC avatars)
//
// Why two endpoints: HeyGen's account-scoped /v2/avatars only
// returned the legacy "studio" catalog (Annelore in Red sweater
// etc). The modern UGC-style avatars (Annie, Terry, Christina,
// the colorful selfie-cam ones founders actually want) live
// under /v2/talking_photo AND in the public catalog flag on
// /v2/avatars. Founders kept asking why their "stock catalog"
// only showed corporate avatars; this PR is the answer.
//
// Each item gets two new metadata fields:
//   - kind: 'avatar' | 'talking_photo' — which HeyGen API the
//     id came from. The avatar save endpoint stores this so
//     lib/heygen/fire.ts can build the right `character` payload
//     ('avatar' → {type:'avatar', avatar_id}, 'talking_photo' →
//     {type:'talking_photo', talking_photo_id, use_avatar_iv_model}).
//   - category: 'ugc' | 'professional' | 'lifestyle' | 'other' —
//     heuristic from name + HeyGen tags. Drives the picker UI
//     tabs ([All | UGC | Professional | Lifestyle]).
//
// Sort: ugc > lifestyle > other > professional (so the modern
// UGC styles surface first in the default 'All' view).
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
  default_voice?: string;
  // Some HeyGen responses include tags / type per avatar. We
  // capture both opportunistically — neither is strictly typed
  // on their side.
  tags?: string[];
  type?: string;
}

interface HeygenTalkingPhotoRaw {
  talking_photo_id?: string;
  talking_photo_name?: string;
  name?: string;
  preview_image_url?: string;
  status?: string;
  // Talking photos also occasionally surface gender / tags in
  // newer API versions.
  gender?: string;
  tags?: string[];
}

interface HeygenAvatarsResponse {
  error?: { message?: string } | null;
  data?: {
    avatars?: HeygenAvatarRaw[];
    // Some HeyGen API versions return talking_photos in the
    // /v2/avatars response when include_public=true. Capture
    // both shapes.
    talking_photos?: HeygenTalkingPhotoRaw[];
  };
}

interface HeygenTalkingPhotoResponse {
  error?: { message?: string } | null;
  data?: HeygenTalkingPhotoRaw[];
}

export type AvatarKind = 'avatar' | 'talking_photo';
export type AvatarCategory = 'ugc' | 'professional' | 'lifestyle' | 'other';

export interface AvatarOption {
  avatarId: string;
  name: string;
  previewImageUrl: string | null;
  gender: string | null;
  premium: boolean;
  defaultVoiceId: string | null;
  // PR Sprint 7.25 Phase 11.15
  kind: AvatarKind;
  category: AvatarCategory;
}

// 10-minute cache — HeyGen's catalog changes rarely; we don't
// need to hammer their API on every Settings page load.
export const revalidate = 600;

// Heuristic categorization. Looks at name + tags for keywords
// that HeyGen uses for their modern styles. Talking photos
// always default to 'ugc' because they ARE the UGC/Instant
// Avatar category by definition.
function categorize(
  kind: AvatarKind,
  name: string,
  tags: ReadonlyArray<string>,
): AvatarCategory {
  if (kind === 'talking_photo') return 'ugc';
  const haystack = (name + ' ' + tags.join(' ')).toLowerCase();
  if (
    /\b(ugc|casual|selfie|social|gen[-_ ]?z|tiktok|reels?|creator)\b/.test(
      haystack,
    )
  ) {
    return 'ugc';
  }
  if (
    /\b(lifestyle|outdoor|coffee|cafe|park|nature|home|kitchen|beach)\b/.test(
      haystack,
    )
  ) {
    return 'lifestyle';
  }
  if (
    /\b(professional|studio|suit|business|corporate|office|formal|news)\b/.test(
      haystack,
    )
  ) {
    return 'professional';
  }
  return 'other';
}

// PR Sprint D-6 — drop legacy pre-rendered stock avatars.
//
// HeyGen's /v2/avatars catalog includes the OG Avatar III pre-
// rendered stock catalog: "Annelore in Red sweater", "Anna in
// white blouse", "Edward in Business Suit", etc. These ship with
// a single fixed pose, can't be re-rendered with new prompts, and
// look stiff / "rigid" in the picker preview. Founder feedback:
// surface only the Avatar IV / V engine-compatible catalog.
//
// Filter heuristics (in priority order):
//   1. talking_photo kind → always keep. Talking photos are by
//      definition Avatar IV/V (they're rendered with the modern
//      photo-avatar engine at render time).
//   2. " in <color> <garment>" name pattern → DROP. This is the
//      tell-tale signature of the legacy pre-rendered catalog.
//   3. category === 'professional' → DROP. The corporate suit
//      stock avatars are the most-complained-about subset of the
//      legacy catalog; the modern equivalents are in talking_photos.
//   4. Anything else → keep (gives benefit of the doubt to
//      unrecognized modern stock avatars on premium accounts).
//
// Future: replace heuristic with HeyGen's `supported_api_engines`
// field once it's reliably populated across the catalog.
const LEGACY_NAME_PATTERN =
  /\bin\s+(red|blue|black|grey|gray|white|green|yellow|pink|navy|brown|orange|purple|tan|beige)\s+(sweater|suit|shirt|blazer|jacket|dress|tie|blouse|polo|cardigan|hoodie|t-?shirt|outfit)\b/i;

function isLegacyAvatar(opt: AvatarOption): boolean {
  if (opt.kind === 'talking_photo') return false;
  if (LEGACY_NAME_PATTERN.test(opt.name)) return true;
  if (opt.category === 'professional') return true;
  return false;
}

// Sort priority so the modern UGC styles surface first in the
// 'All' view. Within a category, alphabetical by name for
// stable scanning.
const CATEGORY_PRIORITY: Record<AvatarCategory, number> = {
  ugc: 0,
  lifestyle: 1,
  other: 2,
  professional: 3,
};

function sortAvatars(a: AvatarOption, b: AvatarOption): number {
  const ap = CATEGORY_PRIORITY[a.category];
  const bp = CATEGORY_PRIORITY[b.category];
  if (ap !== bp) return ap - bp;
  return a.name.localeCompare(b.name);
}

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
    // PR Sprint 7.25 Phase 11.15 — fetch BOTH catalogs in
    // parallel. Promise.allSettled so one endpoint failing
    // (e.g. talking_photo deprecated on some accounts) doesn't
    // hide the other. Same Next.js fetch cache TTL on each.
    const headers = {
      'x-api-key': process.env.HEYGEN_API_KEY!,
      accept: 'application/json',
    } as const;
    const [stockSettled, talkingSettled] = await Promise.allSettled([
      fetch('https://api.heygen.com/v2/avatars?include_public=true', {
        method: 'GET',
        headers,
        next: { revalidate: 600 },
      }),
      fetch('https://api.heygen.com/v2/talking_photo', {
        method: 'GET',
        headers,
        next: { revalidate: 600 },
      }),
    ]);

    const errors: string[] = [];
    const collected: AvatarOption[] = [];
    const seenIds = new Set<string>();

    // ---- Stock avatars (/v2/avatars?include_public=true) ----
    if (stockSettled.status === 'fulfilled' && stockSettled.value.ok) {
      const body = (await stockSettled.value
        .json()
        .catch(() => ({}))) as HeygenAvatarsResponse;
      if (body.error) {
        errors.push(body.error.message ?? 'avatars endpoint reported error');
      } else {
        for (const a of body.data?.avatars ?? []) {
          const id = a.avatar_id ?? '';
          if (!id || seenIds.has(id)) continue;
          seenIds.add(id);
          const name = a.avatar_name ?? a.name ?? 'Untitled avatar';
          collected.push({
            avatarId: id,
            name,
            previewImageUrl: a.preview_image_url ?? a.preview_url ?? null,
            gender: a.gender ?? null,
            premium: Boolean(a.premium),
            defaultVoiceId: a.default_voice ?? null,
            kind: 'avatar',
            category: categorize('avatar', name, a.tags ?? []),
          });
        }
        // Some HeyGen API versions inline talking_photos under
        // /v2/avatars when include_public=true is set. Capture
        // them too.
        for (const tp of body.data?.talking_photos ?? []) {
          const id = tp.talking_photo_id ?? '';
          if (!id || seenIds.has(id)) continue;
          seenIds.add(id);
          const name =
            tp.talking_photo_name ?? tp.name ?? 'Untitled talking photo';
          collected.push({
            avatarId: id,
            name,
            previewImageUrl: tp.preview_image_url ?? null,
            gender: tp.gender ?? null,
            premium: false,
            defaultVoiceId: null,
            kind: 'talking_photo',
            category: 'ugc',
          });
        }
      }
    } else if (stockSettled.status === 'rejected') {
      errors.push(
        stockSettled.reason instanceof Error
          ? stockSettled.reason.message
          : String(stockSettled.reason),
      );
    } else {
      // fulfilled but !res.ok
      errors.push(`avatars endpoint HTTP ${stockSettled.value.status}`);
    }

    // ---- Talking photos (/v2/talking_photo) ----
    if (talkingSettled.status === 'fulfilled' && talkingSettled.value.ok) {
      const body = (await talkingSettled.value
        .json()
        .catch(() => ({}))) as HeygenTalkingPhotoResponse;
      if (body.error) {
        errors.push(
          body.error.message ?? 'talking_photo endpoint reported error',
        );
      } else {
        for (const tp of body.data ?? []) {
          const id = tp.talking_photo_id ?? '';
          if (!id || seenIds.has(id)) continue;
          // Skip non-completed talking photos — they can't render
          // a video yet. HeyGen sometimes returns 'processing'
          // rows for the user's own enrollments.
          if (tp.status && tp.status !== 'completed') continue;
          seenIds.add(id);
          const name =
            tp.talking_photo_name ?? tp.name ?? 'Untitled talking photo';
          collected.push({
            avatarId: id,
            name,
            previewImageUrl: tp.preview_image_url ?? null,
            gender: tp.gender ?? null,
            premium: false,
            defaultVoiceId: null,
            kind: 'talking_photo',
            category: 'ugc',
          });
        }
      }
    } else if (talkingSettled.status === 'rejected') {
      errors.push(
        talkingSettled.reason instanceof Error
          ? talkingSettled.reason.message
          : String(talkingSettled.reason),
      );
    } else {
      errors.push(`talking_photo endpoint HTTP ${talkingSettled.value.status}`);
    }

    // If BOTH endpoints failed, surface a 502 so the UI knows
    // the catalog couldn't be loaded.
    if (collected.length === 0 && errors.length > 0) {
      return NextResponse.json(
        {
          error: errors.join('; '),
          avatars: [],
        },
        { status: 502 },
      );
    }

    // PR Sprint D-6 — strip legacy Avatar III pre-rendered stock
    // before sorting. Founder feedback was "muchos rígidos, nada
    // que ver" — the "in <color> <garment>" stock catalog is the
    // culprit. See isLegacyAvatar() for the heuristics. Tracking
    // dropped count so we can surface "N legacy avatars filtered"
    // in the picker UI later if useful.
    const beforeFilter = collected.length;
    const modern = collected.filter((a) => !isLegacyAvatar(a));
    const droppedLegacy = beforeFilter - modern.length;
    modern.sort(sortAvatars);

    return NextResponse.json({
      avatars: modern,
      droppedLegacy,
      // Surface non-fatal errors so the UI can show "some
      // sources couldn't load" if one endpoint dropped.
      partialErrors: errors.length > 0 ? errors : undefined,
    });
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
