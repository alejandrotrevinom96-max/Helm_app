// PR Sprint D-3 — Design a Voice (HeyGen V3).
//
// POST /api/heygen/voices/design
//   Body: { prompt, gender?, locale?, seed? }
//
// Returns up to 3 voices matching the natural-language prompt.
// The founder picks one and we stamp project.heygenVoiceId on
// save — same downstream contract as the existing voice picker.
//
// Why a proxy (not a direct fetch from the client): the HeyGen
// API key is server-only. The proxy also normalizes the
// envelope and adds auth + a soft rate-limit.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isHeygenEnvConfigured } from '@/lib/heygen/gate';
import { checkRateLimit } from '@/lib/rate-limit';

export const maxDuration = 30;

interface DesignedVoice {
  voice_id: string;
  name: string;
  language: string;
  gender: string;
  preview_audio_url: string | null;
  support_pause: boolean;
  support_locale: boolean;
  type: 'public' | 'private';
}

interface HeygenEnvelope {
  data?: {
    voices?: DesignedVoice[];
    seed?: number;
  };
  error?: { message?: string };
  message?: string;
}

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
      {
        error: 'HeyGen is not configured for this deployment.',
        errorKind: 'feature_disabled',
        voices: [],
      },
      { status: 503 },
    );
  }
  // 30/hr cap — voice design is cheap on HeyGen's side but the
  // UI fires it every "Find voices" click + every "Try different
  // voices" seed bump. Cap keeps a runaway client from burning
  // through quota.
  const limit = checkRateLimit(
    `voice-design:${user.id}`,
    30,
    60 * 60 * 1000,
  );
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
        hint: `Try again in ${Math.ceil(limit.resetMs / 60000)} minutes.`,
        voices: [],
      },
      { status: 429 },
    );
  }

  let body: {
    prompt?: string;
    gender?: 'male' | 'female';
    locale?: string;
    seed?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const prompt = (body.prompt ?? '').trim();
  if (prompt.length < 1 || prompt.length > 1000) {
    return NextResponse.json(
      { error: 'prompt must be 1–1000 chars' },
      { status: 400 },
    );
  }
  const seed =
    typeof body.seed === 'number' && body.seed >= 0
      ? Math.floor(body.seed)
      : 0;
  const payload: Record<string, unknown> = { prompt, seed };
  if (body.gender === 'male' || body.gender === 'female') {
    payload.gender = body.gender;
  }
  if (typeof body.locale === 'string' && body.locale.trim()) {
    payload.locale = body.locale.trim();
  }

  try {
    const res = await fetch('https://api.heygen.com/v3/voices', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.HEYGEN_API_KEY!,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as HeygenEnvelope;
    if (!res.ok || data.error || !data.data) {
      const msg =
        data.error?.message ??
        data.message ??
        `HeyGen returned HTTP ${res.status}`;
      return NextResponse.json(
        { error: msg, voices: [] },
        { status: 502 },
      );
    }
    return NextResponse.json({
      voices: data.data.voices ?? [],
      seed: data.data.seed ?? seed,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : 'Voice design failed',
        voices: [],
      },
      { status: 502 },
    );
  }
}
