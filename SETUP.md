# Helm — Setup Guide

The command center for indie hackers. This is the production codebase.

## 🏗 Stack

- **Next.js 15** (App Router) + **TypeScript**
- **Supabase** (Auth + Postgres)
- **Drizzle ORM**
- **Tailwind CSS**
- **Anthropic Claude API** (Haiku 4.5 + Opus 4.7)
- **Octokit** (GitHub)
- **Vercel** (hosting + cron)

## 📋 Pre-requisites

You'll need accounts on:

1. **Supabase** — [supabase.com](https://supabase.com) (auth + database)
2. **Anthropic Console** — [console.anthropic.com](https://console.anthropic.com) (Claude API key, ~$10 credit)
3. **GitHub** (you already have it)
4. **Vercel** — [vercel.com](https://vercel.com) (hosting)

---

## 🚀 Step-by-step setup

### 1. Clone and install

```bash
git clone <your-repo-url> helm
cd helm
npm install
```

### 2. Set up Supabase

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**
2. Name: `helm-prod`, region closest to you, generate strong password
3. Wait ~2 min for provisioning
4. Once ready, go to **Settings → API** and grab:
   - `Project URL` → goes in `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → goes in `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → goes in `SUPABASE_SERVICE_ROLE_KEY` (keep secret!)
5. Go to **Settings → Database → Connection string** → URI mode
   - Copy and replace `[YOUR-PASSWORD]` with the password you set
   - Use the **Transaction pooler** URL (port 6543) for `DATABASE_URL`

### 3. Configure GitHub OAuth in Supabase

1. In Supabase: **Authentication → Providers → GitHub** → enable
2. In another tab, go to [github.com/settings/developers](https://github.com/settings/developers) → **New OAuth App**
   - Application name: `Helm`
   - Homepage URL: `https://yourdomain.com` (or `http://localhost:3000` for dev)
   - Authorization callback URL: copy this from Supabase's GitHub provider config (looks like `https://YOUR_PROJECT.supabase.co/auth/v1/callback`)
3. Click **Register application** → on the next page click **Generate a new client secret**
4. Copy the **Client ID** and **Client Secret** back into Supabase's GitHub provider config
5. Click **Save** in Supabase

### 4. Get Anthropic API key

1. Go to [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
2. Click **Create Key** → name it `helm-prod`
3. Copy the key (starts with `sk-ant-...`) → goes in `ANTHROPIC_API_KEY`
4. Add $10-20 credit at **Settings → Billing** (Haiku is cheap; this lasts months)

### 5. Generate encryption keys

In your terminal:

```bash
# For ENCRYPTION_KEY (encrypts OAuth tokens at rest)
openssl rand -hex 32

# For CRON_SECRET (auth for cron endpoints)
openssl rand -base64 32
```

### 6. Create `.env.local`

Copy `.env.example` to `.env.local` and fill in all the values.

### 7. Run database migrations

```bash
npm run db:push
```

This creates all the tables in your Supabase Postgres.

### 8. Run locally

```bash
npm run dev
```

Open `http://localhost:3000` — landing page should load.
Click "Sign in" → GitHub OAuth flow → onboarding → dashboard.

---

## 🌐 Deploy to Vercel

```bash
npm install -g vercel
vercel
```

Follow prompts. Then:

1. Go to your Vercel project → **Settings → Environment Variables**
2. Add ALL the variables from `.env.local` (production values)
3. Set `NEXT_PUBLIC_APP_URL` to your production URL
4. **Cron Jobs** → already configured in `vercel.json` (syncs metrics hourly)

### Update GitHub OAuth callback for production

In your GitHub OAuth App settings:
- Add a second callback URL: `https://yourdomain.com/auth/callback`

In Supabase Auth settings:
- **URL Configuration** → Redirect URLs → add `https://yourdomain.com/auth/callback`

---

## 🔌 How users connect integrations

After GitHub login + onboarding, users connect:

### Vercel
- We use Vercel's OAuth Integration flow
- You need to create a Vercel Integration: [vercel.com/integrations/console](https://vercel.com/integrations/console)
- Setting this up requires being on Vercel's developer team (they need to approve)
- **Workaround for V1**: Have users paste their Vercel API token directly (Settings → Tokens)

### Supabase
- Users paste their **Personal Access Token** (Account → Access Tokens)
- We encrypt and store it
- We use it to query their `auth.users` table via Supabase Management API

### Meta Ads
- Standard OAuth with Facebook Login
- Requires App Review for production access (~2 weeks)
- **Workaround for V1**: Run app in development mode, only your own ad accounts work

---

## 🛠 Project structure

```
helm/
├── app/
│   ├── (marketing)/         # Public landing page
│   ├── (auth)/              # /login, /auth/callback
│   ├── (dashboard)/         # /marketing (generate/calendar/library), /research, /compass, /analytics
│   │   └── onboarding/      # First-run setup flow
│   ├── api/
│   │   ├── onboarding/      # Create projects after scan
│   │   ├── integrations/    # OAuth callbacks for Vercel/Supabase/Meta
│   │   ├── ai/              # Claude-powered features
│   │   ├── research/        # Reddit scanning
│   │   └── cron/            # Hourly sync jobs
│   └── w/[slug]/            # Public waitlist pages users create
├── components/
│   ├── dashboard/           # Sidebar, KPI cards, charts
│   └── ui/                  # Reusable primitives
├── lib/
│   ├── db/                  # Drizzle schema + client
│   ├── integrations/        # GitHub, Vercel, Supabase Mgmt, Meta, Reddit
│   ├── ai/                  # Claude client + prompts
│   ├── supabase/            # SSR helpers
│   └── crypto.ts            # Token encryption
└── middleware.ts            # Auth + route protection
```

---

## 💰 Costs (mes 1 con ~20 usuarios)

| Service | Cost |
|---------|------|
| Vercel Hobby | $0 |
| Supabase Free | $0 |
| Anthropic (Haiku) | $5-10 |
| Domain | $12/year |
| **Total** | **~$5-10/mo** |

---

## 🧪 Testing the flow

1. Sign up with GitHub at `/login`
2. Onboarding scans your repos and shows SaaS candidates
3. Select 1-2 → click Continue
4. Dashboard loads at `/analytics` (empty state initially — no metrics yet)
5. Click **Connect Vercel** → paste API token → metrics start syncing
6. Click **Connect Supabase** → paste Management token → signups appear
7. Try **Marketing** tab → write a prompt → Claude generates a post
8. Try **Research** tab → triggers Reddit scan
9. Try **Validate** tab → create a waitlist page → visit `/w/your-slug` to see public version

---

## 🐛 Common issues

**"Invalid encryption key"** → ENCRYPTION_KEY must be 64 hex chars (32 bytes). Run `openssl rand -hex 32`.

**"GitHub OAuth fails"** → Check the callback URL in GitHub OAuth App matches Supabase's exactly.

**"Drizzle migration fails"** → Use the **Transaction pooler** connection string (port 6543), not direct.

**"Reddit returns empty"** → Reddit's API rate-limits hard. Wait a minute and retry. Set User-Agent header.

**"Claude API 401"** → Check ANTHROPIC_API_KEY starts with `sk-ant-` and you've added credit.

---

## 📈 Next steps after launch

- [ ] Add Stripe for billing (when you go paid)
- [ ] Implement auto-publishing to Instagram/Facebook (Meta Graph API)
- [ ] Add HN, Indie Hackers, Product Hunt scrapers
- [ ] Build A/B testing for waitlist pages
- [ ] Survey builder with qualitative analysis
- [ ] Email digests via Resend
- [ ] Telegram bot for real-time alerts

Good luck shipping! 🚀
