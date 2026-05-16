// PR Sprint C — HeyGen voice catalog proxy.
//
// GET /api/heygen/voices
// Returns a flat list of available voices with gender + language
// so the avatar picker can auto-match a voice to the selected
// avatar's gender (avoiding the male-avatar-female-voice
// uncanny-valley bug).
//
// Why this endpoint exists: the avatars route (/api/heygen/avatars)
// surfaces `default_voice` per studio avatar but `null` for every
// talking_photo (UGC) avatar — HeyGen doesn't tie voices to those.
// Without a voices catalog the picker had nothing to pick from
// for UGC avatars and silently fell back to the deploy-wide
// HEYGEN_DEFAULT_VOICE_ID, which is female. Hence the bug.
//
// HeyGen returns voice gender as 'Male' / 'Female' / 'Unknown' /
// etc. with inconsistent casing. We lowercase + collapse anything
// non-male/female to 'neutral' so the matcher logic is simple.
//
// PR Sprint D-6 — V3 engine filter (Starfish-capable voices only).
//
// HeyGen V3 doesn't ship a separate voice catalog endpoint — the
// canonical list of ~700 pre-made voices still lives at /v2/voices.
// What V3 changed is the RENDER engine: Starfish (V3) is the new
// ElevenLabs-v3-native TTS pipeline, vs the legacy HeyGen-internal
// TTS that V2 used by default. Voices flagged with
// `emotion_support: true` are Starfish-capable (they accept the
// emotion enum, locale override, speed control — the V3 quality
// envelope). Voices without it are legacy TTS-only, lower quality,
// monotone in feed. Founder feedback was that the rigid avatars
// looked bad; legacy voices are the audio equivalent.
//
// We filter on emotion_support + language_code presence (newer
// voices ship with locale codes, older ones often have just a
// human-readable language string). The filter takes the catalog
// from ~700 voices down to the ~250-300 Starfish-compatible ones
// that render with V3 quality.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isHeygenEnvConfigured } from '@/lib/heygen/gate';

interface HeygenVoiceRaw {
  voice_id?: string;
  language?: string;
  language_code?: string;
  gender?: string;
  name?: string;
  preview_audio?: string;
  support_pause?: boolean;
  emotion_support?: boolean;
}

interface HeygenVoicesResponse {
  error?: { message?: string } | null;
  data?: {
    voices?: HeygenVoiceRaw[];
  };
}

export type VoiceGender = 'male' | 'female' | 'neutral';

export interface VoiceOption {
  voiceId: string;
  name: string;
  gender: VoiceGender;
  language: string;
  previewAudioUrl: string | null;
  supportPause: boolean;
}

// 10-minute cache — HeyGen's voice catalog is huge (~700 voices)
// and only changes when they add new ones. We don't need to
// re-fetch on every Settings page load.
export const revalidate = 600;

function normalizeGender(raw: string | undefined): VoiceGender {
  const lower = (raw ?? '').toLowerCase().trim();
  if (lower === 'male') return 'male';
  if (lower === 'female') return 'female';
  // HeyGen sometimes returns 'unknown' / 'neutral' / '' — collapse
  // them all into 'neutral' so the matcher can treat them as
  // "no opinion, both ok".
  return 'neutral';
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
        voices: [],
      },
      { status: 503 },
    );
  }

  try {
    const res = await fetch('https://api.heygen.com/v2/voices', {
      method: 'GET',
      headers: {
        'x-api-key': process.env.HEYGEN_API_KEY!,
        accept: 'application/json',
      },
      next: { revalidate: 600 },
    });

    if (!res.ok) {
      return NextResponse.json(
        {
          error: `HeyGen /v2/voices returned HTTP ${res.status}`,
          voices: [],
        },
        { status: 502 },
      );
    }

    const body = (await res.json().catch(() => ({}))) as HeygenVoicesResponse;
    if (body.error) {
      return NextResponse.json(
        {
          error: body.error.message ?? 'voices endpoint reported error',
          voices: [],
        },
        { status: 502 },
      );
    }

    // PR Sprint D-6 — track totals so we can surface "filtered
    // X legacy voices" in the picker UI later if useful.
    let totalSeen = 0;
    let droppedLegacy = 0;
    const collected: VoiceOption[] = [];
    for (const v of body.data?.voices ?? []) {
      if (!v.voice_id || !v.name) continue;
      totalSeen += 1;

      // V3-engine filter. A voice is considered "modern / Starfish-
      // capable" if BOTH:
      //   - emotion_support === true (V3 emotion enum compatibility)
      //   - language_code is present (newer catalog metadata)
      // Either signal alone has too many false positives — a few
      // legacy voices have emotion_support tagged but render with
      // the old TTS, and a few modern voices ship without
      // language_code in this API version. The AND is conservative
      // but stable.
      const isModern = Boolean(v.emotion_support) && Boolean(v.language_code);
      if (!isModern) {
        droppedLegacy += 1;
        continue;
      }

      collected.push({
        voiceId: v.voice_id,
        name: v.name,
        gender: normalizeGender(v.gender),
        language: v.language ?? v.language_code ?? 'unknown',
        previewAudioUrl: v.preview_audio ?? null,
        supportPause: Boolean(v.support_pause),
      });
    }

    return NextResponse.json({
      voices: collected,
      totalSeen,
      droppedLegacy,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : 'HeyGen voices request failed',
        voices: [],
      },
      { status: 502 },
    );
  }
}
