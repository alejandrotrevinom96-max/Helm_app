# Sprint 5.1 — Manual Setup Required

PR #29 ships the foundation for auto-posting to Facebook + Instagram, but
several pieces are operator-controlled and have to be wired up by hand
before the feature works in production.

## 1. Run the database migration

Already applied automatically by the deploy script during PR #29 review,
but if you're rolling forward from a clean DB:

```bash
DATABASE_URL=<prod_url> npx tsx scripts/add-meta-integrations.ts
```

Idempotent — safe to re-run. Adds the `meta_integrations` table plus
9 publish-lifecycle columns on `scheduled_posts`.

## 2. Set environment variables in Vercel

Vercel dashboard → your project → **Settings → Environment Variables**.
Add the following:

```
META_APP_ID=<from Meta for Developers>
META_APP_SECRET=<from Meta for Developers>
META_REDIRECT_URL=https://trythelm.com/api/integrations/meta/callback
TOKEN_ENCRYPTION_KEY=<openssl rand -hex 32>
CRON_SECRET=<openssl rand -hex 32>
NEXT_PUBLIC_APP_URL=https://trythelm.com
```

Until `META_APP_ID` is set the integration card shows "Connect Meta" but
clicking it returns 503 with a clear "operator must configure" message.
Until `CRON_SECRET` is set the cron worker returns 401 — no scheduled
posts will publish (this is the safe default).

## 3. Create the Meta App

1. Go to https://developers.facebook.com/apps/ and click **Create App**.
2. **Type:** Business.
3. **App Display Name:** "Helm".
4. **Contact Email:** your email.
5. Add Products:
   - **Facebook Login for Business**
   - **Instagram Graph API**
6. **OAuth Redirect URI** (in FB Login settings):
   ```
   https://trythelm.com/api/integrations/meta/callback
   ```
7. **Permissions** (request these in App Review):
   - `pages_show_list`
   - `pages_read_engagement`
   - `pages_manage_posts`
   - `instagram_basic`
   - `instagram_content_publish`
   - `business_management`
8. **Privacy Policy URL:** https://trythelm.com/privacy
9. **Terms of Service URL:** https://trythelm.com/terms
10. Copy **App ID** + **App Secret** into the Vercel env vars above.

## 4. Submit for Meta App Review (required for production)

Until the app is approved, only accounts you add as **App Testers**
inside the Meta dashboard can complete the OAuth flow. Review takes
3–5 business days typically.

For testing without review: add yourself as an App Tester at
**App settings → Roles → Testers**.

## 5. Verify the cron worker

Once `CRON_SECRET` is set and Vercel redeploys, `/api/cron/publish-scheduled`
runs every minute. Check `vercel.json` to confirm:

```json
{
  "crons": [
    { "path": "/api/cron/sync-metrics", "schedule": "0 0 * * *" },
    { "path": "/api/cron/publish-scheduled", "schedule": "* * * * *" }
  ]
}
```

You can manually trigger a tick (debug only):

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://trythelm.com/api/cron/publish-scheduled
```

Response includes `candidates`, `processed`, `published`, `failed`, and
`retrying` counts.

## 6. Test the full loop

1. **Connect**: Settings → Integrations → "Connect Meta".
2. After OAuth, the card flips to **Connected** and shows your Page +
   IG handle.
3. **Schedule a post**: Marketing → Generate, schedule for 2 minutes
   from now, platform = `facebook`.
4. Wait — the cron picks it up at the next minute boundary.
5. **Library** shows the post with a green **Posted ↗** chip linking to
   the live FB post.
6. If it fails, the **Failed** chip appears with the error text on
   hover; opening the modal lets you click **Retry now**.
