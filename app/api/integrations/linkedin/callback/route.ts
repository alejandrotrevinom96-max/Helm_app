// PR #66 — Sprint 7.0.9: LinkedIn OAuth callback.
//
// Verifies the HMAC-signed state, enforces a 10-minute freshness
// window, exchanges the code for tokens, fetches the OpenID
// profile so we can render "✓ Connected as <Name>" in the UI, and
// upserts a row in `linkedin_integrations` keyed on projectId.
//
// On any failure we redirect back to /integrations with an
// `?error=` querystring so the UI's LinkedInCard banner can pick
// it up.
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { linkedinIntegrations, projects } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { verifyState } from '@/lib/security/oauth-state';
import {
  exchangeCodeForTokens,
  fetchUserinfo,
  getRedirectUri,
  parseScopes,
} from '@/lib/linkedin/oauth';
import { encryptToken } from '@/lib/crypto/token-encryption';

const STATE_TTL_MS = 10 * 60 * 1000;

interface LinkedInOAuthState {
  userId: string;
  projectId: string;
  returnTo: string;
  timestamp: number;
  provider?: string;
}

function redirectErr(req: Request, code: string): NextResponse {
  return NextResponse.redirect(
    new URL(`/integrations?linkedin_error=${encodeURIComponent(code)}`, req.url),
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthErr = url.searchParams.get('error');
  if (oauthErr) return redirectErr(request, oauthErr);
  if (!code || !state) return redirectErr(request, 'missing_params');

  const parsed = verifyState<LinkedInOAuthState>(state);
  if (!parsed) return redirectErr(request, 'invalid_state');
  if (parsed.provider && parsed.provider !== 'linkedin') {
    return redirectErr(request, 'wrong_provider');
  }
  if (Date.now() - parsed.timestamp > STATE_TTL_MS) {
    return redirectErr(request, 'state_expired');
  }

  // Project ownership re-check — the signed state is trusted for
  // freshness but we still confirm the founder still owns the
  // project. (Edge case: project deleted between auth & callback.)
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.id, parsed.projectId),
        eq(projects.userId, parsed.userId),
      ),
    )
    .limit(1);
  if (!project) return redirectErr(request, 'project_not_found');

  let tokens;
  let profile;
  try {
    tokens = await exchangeCodeForTokens({
      code,
      redirectUri: getRedirectUri(request),
    });
    profile = await fetchUserinfo(tokens.access_token);
  } catch (err) {
    console.error('[linkedin-callback] token/profile failed:', err);
    return redirectErr(request, 'token_exchange_failed');
  }

  if (!profile.sub) {
    return redirectErr(request, 'profile_missing_sub');
  }

  const accessEnc = encryptToken(tokens.access_token);
  const refreshEnc = tokens.refresh_token
    ? encryptToken(tokens.refresh_token)
    : null;
  // LinkedIn token responses set `expires_in` (seconds). Stamp a
  // little early (30s) to dodge clock skew on the publisher side.
  const expiresAt = new Date(Date.now() + (tokens.expires_in - 30) * 1000);
  // PR #79 — Sprint 7.5.1 hotfix: parseScopes tolerates LinkedIn's
  // inconsistent separator. Pre-hotfix this was `split(' ')` which
  // produced a single-element array when LinkedIn returned commas,
  // breaking every downstream `.includes('w_member_social')` check.
  const scopes = parseScopes(tokens.scope);
  console.log(
    '[linkedin-callback] scope parsed',
    JSON.stringify({ raw: tokens.scope, parsed: scopes }),
  );

  await db
    .insert(linkedinIntegrations)
    .values({
      projectId: parsed.projectId,
      userId: parsed.userId,
      accessTokenEncrypted: accessEnc,
      refreshTokenEncrypted: refreshEnc,
      tokenExpiresAt: expiresAt,
      linkedinUserId: profile.sub,
      linkedinName: profile.name ?? null,
      linkedinHandle: profile.email ?? null,
      scopes,
      status: 'connected',
      connectedAt: new Date(),
      lastUsedAt: null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: linkedinIntegrations.projectId,
      set: {
        accessTokenEncrypted: accessEnc,
        refreshTokenEncrypted: refreshEnc,
        tokenExpiresAt: expiresAt,
        linkedinUserId: profile.sub,
        linkedinName: profile.name ?? null,
        linkedinHandle: profile.email ?? null,
        scopes,
        status: 'connected',
        lastError: null,
        updatedAt: new Date(),
      },
    });

  const returnTo = parsed.returnTo?.startsWith('/')
    ? parsed.returnTo
    : '/integrations';
  return NextResponse.redirect(
    new URL(`${returnTo}?linkedin=connected`, request.url),
  );
}
