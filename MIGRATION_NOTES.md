# Sprint 5.x — Manual Setup Required

This file covers the post-deploy steps that the operator must run by
hand. Sprint 5.1 added the Meta foundation; Sprint 5.3 added Reels
(Supabase Storage bucket + a second cron worker).

## Sprint 5.3 — Reels-specific setup

### Create the "reels" Supabase Storage bucket

```bash
SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/setup-reels-bucket.ts
```

Idempotent. Creates a public-read bucket allowed for `video/mp4` and
`video/quicktime`. We deliberately don't set a bucket-level file-size
cap (Supabase Free rejects values > 50 MB at bucket creation). The
100 MB cap is enforced client-side (`lib/storage/reels-upload.ts`)
and server-side (the `/api/marketing/schedule` endpoint).

### Apply the RLS policies (manual, Supabase Dashboard)

The script prints the exact policies — copy them into
**Storage → reels → Policies**. Without them anyone can write to
your bucket.

### Run the migration

```bash
DATABASE_URL=<prod_url> npx tsx scripts/add-reel-fields.ts
```

Adds `is_reel`, `video_url`, video metadata, and the polling state
columns to `scheduled_posts`. Adds `is_reel`/`video_url` to
`generated_posts` so the flag survives draft → scheduled. Idempotent.

### Reels polling cron

`/api/cron/poll-reels` is registered in `vercel.json`. On Hobby plan
this runs once per day — useless for an "auto-publish at the
scheduled minute" feature. Use the same external pinger you set up
for `/api/cron/publish-scheduled` (Sprint 5.1 setup, step 5) and
add a second job that hits `/api/cron/poll-reels` with the same
`Authorization: Bearer $CRON_SECRET` header on a 1-minute schedule.

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

## 5. Trigger the publish-scheduled cron

The `/api/cron/publish-scheduled` endpoint exists and is auth-gated by
`CRON_SECRET`, but it is **NOT** wired up to Vercel Cron because the
project runs on the Hobby plan (which limits cron jobs to once per
day — useless for a "publish at the scheduled minute" feature).

You have three options to drive the cron:

### Option A — External cron service (recommended for Hobby plan)

Set up a free pinger like [cron-job.org](https://cron-job.org) or
[uptimerobot.com](https://uptimerobot.com) to hit the endpoint every
minute:

- **URL:** `https://trythelm.com/api/cron/publish-scheduled`
- **Method:** GET
- **Headers:** `Authorization: Bearer <CRON_SECRET>`
- **Schedule:** every 1 minute

The endpoint is idempotent (it claims rows via `publishStatus =
'publishing'` before firing) so overlapping ticks won't double-post.

### Option B — GitHub Actions cron

Add `.github/workflows/publish-cron.yml`:

```yaml
on:
  schedule:
    - cron: '* * * * *'
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -fsS -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            https://trythelm.com/api/cron/publish-scheduled
```

GitHub Actions cron has ~5min jitter — slightly less precise than a
dedicated pinger, but free and within the same repo.

### Option C — Upgrade to Vercel Pro

If you upgrade to Pro ($20/mo), add this back to `vercel.json`:

```json
{
  "path": "/api/cron/publish-scheduled",
  "schedule": "* * * * *"
}
```

Pro unlocks per-minute crons and saves you from the external dance.

### Manual test (debug)

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
