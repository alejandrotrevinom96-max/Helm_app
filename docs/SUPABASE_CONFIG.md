# Supabase configuration

Manual configuration steps that live outside the repo. These are the
external/dashboard-side changes a code commit can't apply on its own.

---

## 1. GitHub OAuth scopes (PR #72, Sprint 7.2A hotfix)

**Status:** code-side trim complete in `app/(auth)/_oauth-buttons.tsx`
and `app/auth/callback/route.ts`. The OAuth request now asks for
`read:user user:email` only — the `repo` scope was dropped because a
real signup attempt reported the GitHub consent screen ("Helm wants
to read AND write to all your repos") as a conversion killer.

**No Supabase dashboard action required** for this scope change — the
client passes scopes at request-time via `signInWithOAuth(options.scopes)`.
The GitHub OAuth App credentials (client ID / secret) stay as-is.

If you ever want to re-enable repo scanning, add an opt-in button in
Settings → Integrations that triggers a second OAuth with `repo:read`
appended to the scope string. That keeps signup friction minimum
while letting power users connect repos explicitly.

---

## 2. Custom auth domain (`auth.trythelm.com`)

**Why:** Google's consent screen currently shows the raw Supabase
subdomain (`msabfpbilxzasfxmhdkx.supabase.co`) instead of a Helm-owned
domain. New users see "Continue to msabfpbilxzasfxmhdkx.supabase.co"
which looks phishy and is conversion-fatal.

**This is dashboard + DNS only.** No code change needed beyond the env
var update in step 3.

### Step 1 — Add the custom domain in Supabase

1. Supabase Dashboard → Project Settings → **Custom Domains** (Pro
   plan or higher; Free tier does not support custom domains).
2. Click **Add custom domain**.
3. Enter `auth.trythelm.com`.
4. Supabase shows a CNAME record to add at your DNS provider.

### Step 2 — Add the CNAME at your DNS provider

| Type  | Name | Value                |
|-------|------|----------------------|
| CNAME | auth | `cname.supabase.co`  |

Wait ~5–30 min for propagation. Verify with
`dig auth.trythelm.com CNAME` or
[dnschecker.org](https://dnschecker.org/#CNAME/auth.trythelm.com).

Return to Supabase → click **Verify**. Once green, Supabase
auto-provisions an SSL cert (Let's Encrypt) for the new host.

### Step 3 — Update OAuth provider redirect URIs

The Google OAuth client needs to know the new host is authorized.

**Google Cloud Console → APIs & Services → Credentials → OAuth client:**

- **Authorized domains** (OAuth consent screen): add `trythelm.com`
- **Authorized redirect URIs** (Credentials → client): replace
  `https://msabfpbilxzasfxmhdkx.supabase.co/auth/v1/callback` with
  `https://auth.trythelm.com/auth/v1/callback`. Keep
  `https://trythelm.com/auth/callback` (the app-side handler).

Click **Save**. Google may require re-verification of the consent
screen if you also update the brand name; that's usually instant for
existing verified apps.

**GitHub OAuth App:**

- Settings → Developer Settings → OAuth Apps → Helm
- **Authorization callback URL:** `https://auth.trythelm.com/auth/v1/callback`
- GitHub allows only ONE callback URL per app; this replaces the
  Supabase-subdomain one.

### Step 4 — Flip the env var in Vercel

```
NEXT_PUBLIC_SUPABASE_URL = https://auth.trythelm.com
```

Redeploy. The Supabase JS client uses this value for every auth call,
so the consent screen will start showing `auth.trythelm.com` from the
first request after the deploy.

### Verification

In an **incognito window**:

1. `https://trythelm.com` → click "Continue with Google".
2. Consent screen should say **"Continue to auth.trythelm.com"**
   (not the supabase.co subdomain).
3. Approve → land back on `/auth/callback` → onboarding.

Same for GitHub.

---

## 3. Common gotchas

- **Browser DNS cache:** if you tested before the CNAME propagated,
  use a fresh incognito or run `ipconfig /flushdns` (Windows) /
  `sudo killall -HUP mDNSResponder` (macOS).
- **Stale OAuth sessions:** revoke Helm in the user's
  [Google account permissions](https://myaccount.google.com/permissions)
  before re-testing so the consent screen reappears.
- **Vercel preview deploys:** they still hit the production
  `NEXT_PUBLIC_SUPABASE_URL` unless you've set the env var per env.
  Add it to Preview + Production both if you want previews to work.
