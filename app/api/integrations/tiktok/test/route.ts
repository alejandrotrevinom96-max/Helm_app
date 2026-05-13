// PR #87 — Sprint 7.11: TikTok connection health-check endpoint.
//
// Same shape as /api/integrations/linkedin/test (Sprint 7.0.9) —
// the Integrations page's TikTokCard polls this on mount + on
// demand to render the connection badge. Surfaces:
//   - configured: env vars present
//   - connected:  row exists in tiktok_integrations
//   - displayName / avatarUrl / handle for the chip
//   - hasUploadScope: scope string includes video.upload
//   - expired / healthy flags for surfacing "Re-authorize" vs
//     "Token expires …" copy
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { tiktokIntegrations } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { isTikTokConfigured } from '@/lib/tiktok/oauth';

export async function GET() {
  const configured = isTikTokConfigured();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { configured, connected: false, error: 'Unauthorized' },
      { status: 200 }, // status 200 — the card UI uses the JSON
    );
  }

  const [row] = await db
    .select()
    .from(tiktokIntegrations)
    .where(eq(tiktokIntegrations.userId, user.id))
    .limit(1);

  if (!row) {
    return NextResponse.json({ configured, connected: false });
  }

  const now = Date.now();
  const accessExpired = row.accessTokenExpiresAt.getTime() <= now;
  const refreshExpired = row.refreshTokenExpiresAt.getTime() <= now;
  const hasUploadScope =
    (row.scope ?? '').split(/[,\s]+/).includes('video.upload');

  return NextResponse.json({
    configured,
    connected: row.status === 'connected',
    status: row.status,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    openId: row.openId,
    accessTokenExpiresAt: row.accessTokenExpiresAt.toISOString(),
    refreshTokenExpiresAt: row.refreshTokenExpiresAt.toISOString(),
    accessExpired,
    refreshExpired,
    hasUploadScope,
    healthy:
      row.status === 'connected' && hasUploadScope && !refreshExpired,
    lastError: row.lastError,
  });
}
