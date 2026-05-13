// PR #87 — Sprint 7.11: explicit TikTok token refresh endpoint.
//
// The lib/tiktok/client helper auto-refreshes on every call, so
// this endpoint is mostly an admin / debugging surface — the UI
// can POST here to force a refresh + show the new expiresAt to
// the founder without waiting for an upload to trigger it.
//
// Returns { refreshed, expiresAt, refreshExpiresAt } on success.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { tiktokIntegrations } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  getValidAccessToken,
  TikTokAuthError,
} from '@/lib/tiktok/client';

export async function POST(_request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await getValidAccessToken(user.id);
    // Re-read the row so we surface the refreshed expiresAt even
    // when the helper short-circuited (token wasn't actually
    // refreshed because it was still fresh).
    const [row] = await db
      .select({
        accessTokenExpiresAt: tiktokIntegrations.accessTokenExpiresAt,
        refreshTokenExpiresAt: tiktokIntegrations.refreshTokenExpiresAt,
      })
      .from(tiktokIntegrations)
      .where(eq(tiktokIntegrations.userId, user.id))
      .limit(1);
    return NextResponse.json({
      refreshed: true,
      openId: result.openId,
      accessTokenExpiresAt: row?.accessTokenExpiresAt ?? null,
      refreshTokenExpiresAt: row?.refreshTokenExpiresAt ?? null,
    });
  } catch (err) {
    if (err instanceof TikTokAuthError) {
      return NextResponse.json(
        { refreshed: false, error: err.message, errorKind: err.code },
        { status: err.code === 'not_connected' ? 404 : 401 },
      );
    }
    return NextResponse.json(
      {
        refreshed: false,
        error: err instanceof Error ? err.message : 'Refresh failed',
        errorKind: 'unknown',
      },
      { status: 500 },
    );
  }
}
