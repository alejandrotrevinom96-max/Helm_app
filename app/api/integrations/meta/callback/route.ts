// PR #29 — Sprint 5.1: Auto-posting Meta foundation.
//
// GET /api/integrations/meta/callback?code=…&state=…[&error=…]
//
// OAuth callback. Steps:
//   1. Validate state (CSRF + 10min freshness check).
//   2. Exchange `code` for short-lived user token.
//   3. Swap short-lived for long-lived (60d) user token.
//   4. List the user's Pages, auto-pick the first one (TODO: picker
//      UI when a user owns multiple).
//   5. Resolve linked IG Business account, if any.
//   6. Encrypt the Page Access Token (AES-256-GCM) and upsert the
//      meta_integrations row.
//
// Result is communicated by redirect to /integrations with a
// ?meta_connected=true / ?meta_error=… query string the client card
// reads on mount. We deliberately don't return JSON because this
// endpoint is hit by the browser as part of an OAuth dance.
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { metaIntegrations, projects } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { MetaGraphClient } from '@/lib/meta/graph-client';
import { encryptToken } from '@/lib/crypto/token-encryption';
import { verifyState } from '@/lib/security/oauth-state';

const STATE_TTL_MS = 10 * 60 * 1000; // 10 min
const DEFAULT_LONG_LIVED_EXPIRES_S = 60 * 24 * 60 * 60; // 60 days

function appOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.VERCEL_URL?.startsWith('http')
      ? (process.env.VERCEL_URL as string)
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://trythelm.com'
  );
}

function redirectTo(qs: string): NextResponse {
  return NextResponse.redirect(`${appOrigin()}/integrations${qs}`);
}

interface DecodedState {
  userId: string;
  projectId: string;
  timestamp: number;
}

// PR #39 Sprint 6.5: state is now HMAC-signed via
// lib/security/oauth-state. Pre-PR-39 it was just base64(JSON);
// callback authentication relied on the Supabase session check
// + userId equality. Signing means we refuse forged states
// before we even look at the DB.
function decodeState(state: string): DecodedState | null {
  const parsed = verifyState<DecodedState>(state);
  if (!parsed) return null;
  if (
    typeof parsed.userId !== 'string' ||
    typeof parsed.projectId !== 'string' ||
    typeof parsed.timestamp !== 'number'
  ) {
    return null;
  }
  if (Date.now() - parsed.timestamp > STATE_TTL_MS) return null;
  return parsed;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');

  if (error) {
    return redirectTo(
      `?meta_error=${encodeURIComponent(errorDescription ?? error)}`
    );
  }
  if (!code || !state) {
    return redirectTo('?meta_error=missing_params');
  }

  const stateData = decodeState(state);
  if (!stateData) {
    return redirectTo('?meta_error=invalid_state');
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.id !== stateData.userId) {
    return redirectTo('?meta_error=user_mismatch');
  }

  // Check project ownership again on callback — defense in depth.
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.id, stateData.projectId),
        eq(projects.userId, user.id)
      )
    )
    .limit(1);
  if (!project) {
    return redirectTo('?meta_error=project_not_found');
  }

  if (
    !process.env.META_APP_ID ||
    !process.env.META_APP_SECRET ||
    !process.env.META_REDIRECT_URL
  ) {
    return redirectTo('?meta_error=server_misconfigured');
  }

  try {
    // Step 1: code → short-lived user token.
    const tokenUrl = new URL(
      'https://graph.facebook.com/v21.0/oauth/access_token'
    );
    tokenUrl.searchParams.set('client_id', process.env.META_APP_ID);
    tokenUrl.searchParams.set('client_secret', process.env.META_APP_SECRET);
    tokenUrl.searchParams.set(
      'redirect_uri',
      process.env.META_REDIRECT_URL
    );
    tokenUrl.searchParams.set('code', code);
    const tokenRes = await fetch(tokenUrl.toString());
    const tokenData = (await tokenRes.json()) as {
      access_token?: string;
      error?: { message?: string };
    };
    if (!tokenRes.ok || tokenData.error || !tokenData.access_token) {
      return redirectTo(
        `?meta_error=${encodeURIComponent(
          tokenData.error?.message ?? 'token_exchange_failed'
        )}`
      );
    }

    const shortClient = new MetaGraphClient(tokenData.access_token);

    // Step 2: short → long-lived (60d) user token.
    const longLived = await shortClient.exchangeForLongLivedToken(
      tokenData.access_token,
      process.env.META_APP_ID,
      process.env.META_APP_SECRET
    );
    const longClient = new MetaGraphClient(longLived.access_token);
    const expiresIn = longLived.expires_in ?? DEFAULT_LONG_LIVED_EXPIRES_S;

    // Step 3: who is this + what pages do they manage?
    const me = await longClient.getMe();
    const pages = await longClient.getPages();
    if (!pages.data || pages.data.length === 0) {
      return redirectTo('?meta_error=no_pages');
    }
    const page = pages.data[0]; // auto-pick first; picker UI in future PR.

    // Step 4: resolve linked IG Business account, if any.
    let igBusinessId: string | null = null;
    let igBusinessUsername: string | null = null;
    if (page.instagram_business_account?.id) {
      try {
        const ig = await longClient.getInstagramBusinessAccount(
          page.instagram_business_account.id
        );
        igBusinessId = ig.id;
        igBusinessUsername = ig.username;
      } catch {
        // Page-without-IG is fine; just leave fields null.
      }
    }

    // Step 5: persist (upsert by project_id — UNIQUE constraint
    // enforces "one integration per project"). Use the PAGE access
    // token (not the user token) for posting — it's scoped + lives 60d.
    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);
    const integrationData = {
      userId: user.id,
      projectId: stateData.projectId,
      facebookPageId: page.id,
      facebookPageName: page.name,
      facebookPageAccessToken: encryptToken(page.access_token),
      instagramBusinessId: igBusinessId,
      instagramBusinessUsername: igBusinessUsername,
      metaUserId: me.id,
      metaUserName: me.name,
      tokenExpiresAt,
      tokenRefreshedAt: new Date(),
      status: 'connected' as const,
      lastError: null,
      updatedAt: new Date(),
    };

    const [existing] = await db
      .select({ id: metaIntegrations.id })
      .from(metaIntegrations)
      .where(eq(metaIntegrations.projectId, stateData.projectId))
      .limit(1);

    if (existing) {
      await db
        .update(metaIntegrations)
        .set(integrationData)
        .where(eq(metaIntegrations.id, existing.id));
    } else {
      await db.insert(metaIntegrations).values(integrationData);
    }

    return redirectTo(
      `?meta_connected=true&page=${encodeURIComponent(page.name)}`
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown_error';
    return redirectTo(`?meta_error=${encodeURIComponent(message)}`);
  }
}
