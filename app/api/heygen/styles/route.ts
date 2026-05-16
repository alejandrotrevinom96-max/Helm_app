// PR Sprint D-2 — HeyGen Video Agent styles catalog proxy.
//
// GET /api/heygen/styles
//   ?tag=cinematic|retro-tech|iconic-artist|pop-culture|handmade|print
//   ?limit=20
//   ?token=<next-page-cursor>
//
// Returns the curated visual style templates that drive scene
// composition in V3 Video Agent renders. Founders pick a style
// in the /marketing/studio chat — the style_id flows into
// /v3/video-agents at session creation.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { listAgentStyles, type StyleTag } from '@/lib/heygen/v3-client';
import { isHeygenEnvConfigured } from '@/lib/heygen/gate';

const ALLOWED_TAGS = new Set<StyleTag>([
  'cinematic',
  'retro-tech',
  'iconic-artist',
  'pop-culture',
  'handmade',
  'print',
]);

// 10-min cache — HeyGen's style catalog changes slowly + this
// endpoint runs on every Studio mount.
export const revalidate = 600;

export async function GET(request: Request) {
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
        styles: [],
      },
      { status: 503 },
    );
  }
  const { searchParams } = new URL(request.url);
  const rawTag = searchParams.get('tag') as StyleTag | null;
  const tag = rawTag && ALLOWED_TAGS.has(rawTag) ? rawTag : undefined;
  const limitRaw = searchParams.get('limit');
  const limit = limitRaw ? Math.max(1, Math.min(100, Number(limitRaw))) : 50;
  const token = searchParams.get('token') ?? undefined;

  const result = await listAgentStyles({ tag, limit, token });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, styles: [] },
      { status: 502 },
    );
  }
  return NextResponse.json({
    styles: result.styles,
    nextToken: result.nextToken,
  });
}
