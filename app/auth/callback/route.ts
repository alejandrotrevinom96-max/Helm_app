// PR #33 — Sprint 6.1: callback hardened for non-GitHub providers.
//
// Pre-PR-33 this route assumed every incoming session came from
// GitHub and unconditionally tried to extract `user_name`, save a
// GitHub provider token, and bump onboarding step. That worked fine
// for the original sign-in flow but breaks when a user comes back
// via email/password or Google OAuth — there's no `provider_token`,
// no GitHub metadata, and the GitHub-only side effects shouldn't
// fire.
//
// New behavior:
//   1. Always exchange the code for a session.
//   2. Always upsert the user row with whatever metadata is present
//      (full_name / name fall back to email prefix).
//   3. Save GitHub provider_token + bump onboarding step ONLY when
//      the session's app_metadata.provider is 'github'.
//
// Email/password signups land here via the Supabase confirmation
// link; Google OAuth lands here after the redirect. Both work
// without GitHub metadata.
import { createClient } from '@/lib/supabase/server';
import { encrypt } from '@/lib/crypto';
import { db } from '@/lib/db';
import { users, integrations } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { type NextRequest } from 'next/server';

interface MetadataShape {
  user_name?: string;
  preferred_username?: string;
  provider_id?: string;
  full_name?: string;
  name?: string;
  avatar_url?: string;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/onboarding';

  if (!code) {
    return redirect(`/login?error=no_code`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session || !data.user) {
    console.error('Auth error:', error);
    return redirect(`/login?error=auth_failed`);
  }

  const user = data.user;
  const session = data.session;
  const meta = (user.user_metadata ?? {}) as MetadataShape;
  // app_metadata.provider tells us which OAuth provider (or 'email')
  // owned this session. We use it to gate provider-specific work
  // below.
  const provider =
    (user.app_metadata?.provider as string | undefined) ?? 'email';
  const providerToken = session.provider_token; // present for OAuth
  const isGithub = provider === 'github';

  // Display name fallback chain: full_name → name → email local part.
  // The third arm matters for email signups where neither metadata
  // field is set.
  const displayName =
    meta.full_name ??
    meta.name ??
    user.email?.split('@')[0] ??
    'Founder';

  // Provider-specific GitHub fields only land when the actual session
  // came from GitHub. Email + Google sessions leave them null.
  await db
    .insert(users)
    .values({
      id: user.id,
      email: user.email!,
      githubUsername: isGithub
        ? meta.user_name ?? meta.preferred_username ?? null
        : null,
      githubId:
        isGithub && meta.provider_id ? parseInt(meta.provider_id) : undefined,
      name: displayName,
      avatarUrl: meta.avatar_url ?? null,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        // Only refresh the GitHub-specific fields when re-logging in
        // via GitHub. Other providers shouldn't clobber a previously
        // saved GitHub username with null.
        ...(isGithub
          ? {
              githubUsername:
                meta.user_name ?? meta.preferred_username ?? null,
            }
          : {}),
        avatarUrl: meta.avatar_url ?? undefined,
      },
    });

  // Save the GitHub access token only when this session is GitHub.
  // Supabase reuses the same callback for every provider, but the
  // token is provider-specific — saving a Google token under
  // provider='github' would corrupt the integrations table.
  if (isGithub && providerToken) {
    // PR #72 — Sprint 7.2A hotfix: scope string trimmed in sync with
    // _oauth-buttons.tsx. The actual granted scopes live on GitHub's
    // side; this column is just bookkeeping for what we asked for.
    // The repo-scan path in onboarding will skip gracefully when the
    // token can't read repos (the GitHub API returns 403 for those
    // calls and the scanner already swallows that into scanError).
    await db
      .insert(integrations)
      .values({
        userId: user.id,
        provider: 'github',
        encryptedAccessToken: encrypt(providerToken),
        scope: 'read:user user:email',
      })
      .onConflictDoUpdate({
        target: [integrations.userId, integrations.provider],
        set: {
          encryptedAccessToken: encrypt(providerToken),
          updatedAt: new Date(),
        },
      });
  }

  const [dbUser] = await db
    .select()
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  // Connecting GitHub satisfies wizard step 1. We don't auto-bump
  // for email/Google because those flows don't yet have integration
  // data — the user has to add a project manually (PR #33 modal) or
  // open Settings to connect more.
  if (isGithub && providerToken && (dbUser?.onboardingStep ?? 0) < 2) {
    await db
      .update(users)
      .set({ onboardingStep: 2 })
      .where(eq(users.id, user.id));
  }

  if (dbUser?.hasCompletedOnboarding) {
    return redirect('/analytics');
  }

  return redirect(next);
}
