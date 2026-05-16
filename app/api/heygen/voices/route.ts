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

    const collected: VoiceOption[] = [];
    for (const v of body.data?.voices ?? []) {
      if (!v.voice_id || !v.name) continue;
      collected.push({
        voiceId: v.voice_id,
        name: v.name,
        gender: normalizeGender(v.gender),
        language: v.language ?? v.language_code ?? 'unknown',
        previewAudioUrl: v.preview_audio ?? null,
        supportPause: Boolean(v.support_pause),
      });
    }

    return NextResponse.json({ voices: collected });
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
