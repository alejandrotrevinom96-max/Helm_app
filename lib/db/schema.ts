import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  numeric,
  date,
  boolean,
  unique,
  bigint,
} from 'drizzle-orm/pg-core';
import type { BrandBible } from '@/lib/types/brand';
import type { ScoreBreakdown } from '@/lib/ai/consistency-score';

// ===== Users =====
// Synced from Supabase auth.users via trigger
export const users = pgTable('users', {
  id: uuid('id').primaryKey(), // matches auth.users.id
  email: text('email').notNull().unique(),
  githubUsername: text('github_username'),
  githubId: integer('github_id'),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  // Helm-specific
  hasCompletedOnboarding: boolean('has_completed_onboarding').default(false),
  // Granular wizard progress: 0 = not started, 1-4 = on step N, 99 = completed/skipped.
  // Distinct from hasCompletedOnboarding (which gates the legacy GitHub-repo
  // scan flow): this tracks the 4-step in-app wizard shown over the dashboard.
  onboardingStep: integer('onboarding_step').default(0).notNull(),
  onboardingCompletedAt: timestamp('onboarding_completed_at'),
  // Outbound webhook for scheduled-post events. Optional; null = no delivery.
  // The secret signs payloads with HMAC-SHA256 — receiver MUST verify it.
  webhookUrl: text('webhook_url'),
  webhookSecret: text('webhook_secret'),
  // PR #58 — Sprint 7.0.2: opt-in for the Monday-morning Weekly Brief
  // email. Defaults off so we never email a user who hasn't asked.
  weeklyBriefEnabled: boolean('weekly_brief_enabled').default(false).notNull(),
});

// ===== Integrations =====
// One per (user, provider) pair. Stores encrypted OAuth tokens.
export const integrations = pgTable(
  'integrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(), // 'github' | 'vercel' | 'supabase' | 'meta'
    encryptedAccessToken: text('encrypted_access_token').notNull(),
    encryptedRefreshToken: text('encrypted_refresh_token'),
    expiresAt: timestamp('expires_at'),
    scope: text('scope'),
    metadata: jsonb('metadata').$type<{
      teamId?: string;
      accountId?: string;
      username?: string;
      [key: string]: unknown;
    }>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    uniqueUserProvider: unique().on(t.userId, t.provider),
  })
);

// ===== Projects =====
// Auto-detected from GitHub repos during onboarding
export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(), // URL-safe version
    // GitHub
    githubRepoFullName: text('github_repo_full_name'), // 'owner/repo'
    githubRepoId: integer('github_repo_id'),
    // Vercel
    vercelProjectId: text('vercel_project_id'),
    vercelTeamId: text('vercel_team_id'),
    // Supabase
    supabaseProjectRef: text('supabase_project_ref'),
    // Tables to count for the metrics widget. Each entry becomes a row
    // in metric_snapshots with metric=<tableName>. When this is empty
    // we fall back to `auth.users` (PR #1 behaviour). PR #19 lets users
    // pick custom public tables (e.g. `profiles`, `waitlist`) so projects
    // without auth-based signups still get a meaningful count.
    supabaseTables: jsonb('supabase_tables').$type<
      Array<{ tableName: string; metricLabel: string }>
    >(),
    // Meta Ads
    metaAdAccountId: text('meta_ad_account_id'),
    // Detected stack
    detectedStack: jsonb('detected_stack').$type<{
      framework?: string;
      hasSupabase?: boolean;
      hasStripe?: boolean;
      hasMeta?: boolean;
    }>(),
    domain: text('domain'),
    isActive: boolean('is_active').default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    // Brand context for the marketing tab. Originally stored a flat shape
    // from PR #2 (voice/tone/audience as plain strings). PR #10 expands it
    // into a full BrandBible — see lib/types/brand.ts. The migration script
    // (scripts/migrate-brand-context.ts) maps legacy rows into the new shape
    // and preserves the original under `_legacyOriginal`.
    brandUrl: text('brand_url'),
    brandContext: jsonb('brand_context').$type<BrandBible>(),
    // PR #49 — Sprint 6.8: Voice Fingerprint.
    //
    // Abstract patterns derived from brand_quotes by an Opus pass.
    // The generator reads this (NOT the raw quotes) so we don't
    // copy founder phrasings verbatim into outputs — we mimic the
    // STRUCTURE / VOCABULARY / TONE patterns instead. Refreshed
    // when the founder adds or edits quotes.
    //
    // Shape (see lib/types/voice.ts):
    //   {
    //     structuralPatterns: string[],
    //     vocabularyTraits: string[],
    //     signaturePhrasings: string[],   // pattern descriptions, not literals
    //     toneCharacteristics: string[],
    //     avoidPatterns: string[],
    //     sourceQuotesCount: number,
    //     derivedAt: ISO string,
    //   }
    voiceFingerprint: jsonb('voice_fingerprint'),
    voiceFingerprintUpdatedAt: timestamp('voice_fingerprint_updated_at'),
  },
  (t) => ({
    uniqueUserRepo: unique().on(t.userId, t.githubRepoId),
  })
);

// ===== Metric Snapshots =====
// Cached metric values to avoid hammering APIs
export const metricSnapshots = pgTable('metric_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  source: text('source').notNull(), // 'vercel' | 'supabase' | 'meta'
  metric: text('metric').notNull(), // 'visitors' | 'signups' | 'spend' | etc
  value: numeric('value', { precision: 12, scale: 2 }).notNull(),
  date: date('date').notNull(),
  syncedAt: timestamp('synced_at').defaultNow().notNull(),
});

// ===== Generated Posts =====
// Marketing tab — Claude-generated content
export const generatedPosts = pgTable('generated_posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(), // 'instagram' | 'facebook' | 'linkedin' | 'threads' | 'reddit'
  content: text('content').notNull(),
  prompt: text('prompt'), // What the user asked for
  status: text('status').notNull().default('draft'), // 'draft' | 'copied' | 'published'
  createdAt: timestamp('created_at').defaultNow().notNull(),
  // PR #23: when this draft was created via "Clone & remix" from a
  // published/scheduled post in the Library, this points back to the
  // original (could be in scheduled_posts OR generated_posts — no FK
  // because the reference crosses tables).
  clonedFromId: uuid('cloned_from_id'),
  // PR #30 — Sprint 5.2. The "post as Story" intent travels with the
  // draft so the founder can mark it once in Generate and have the
  // flag preserved if the draft sits in the pool before scheduling.
  // The schedule-from-draft endpoint copies this into scheduled_posts.
  isStory: boolean('is_story').default(false).notNull(),
  // PR #32 — Sprint 5.3: Reel intent + uploaded video URL travel with
  // the draft. Drafts only carry the URL (the source of truth lives
  // in the Supabase bucket) — duration / size / aspect_ratio belong to
  // scheduled_posts because that's where they affect publish behaviour.
  isReel: boolean('is_reel').default(false).notNull(),
  videoUrl: text('video_url'),
  // PR #42 — Sprint 6.7: per-draft voting. Pre-PR-42 only the
  // "best by consistency score" draft per platform was persisted;
  // others died in client memory and the founder couldn't keep
  // multiple good drafts from one generate run. New flow saves
  // every draft and lets the user 👍 / 👎 each one.
  //   - userVote: null while unvoted; 'liked' or 'disliked' once
  //     the user clicks. Drafts can move between states.
  //   - votedAt: when the most recent vote happened (for future
  //     fine-tuning + analytics).
  //   - visibleInLibrary: defaults true. Soft-deleted (false)
  //     when disliked, so the data survives for learning while
  //     disappearing from the user's Library + drafts pool.
  userVote: text('user_vote'), // 'liked' | 'disliked' | null
  votedAt: timestamp('voted_at'),
  visibleInLibrary: boolean('visible_in_library').default(true).notNull(),
  // PR #43 — Sprint 6.7.1: persist visual on the draft itself.
  // Pre-PR-43 a generated visual lived only in client memory
  // (DraftCard.draft.visual.url). If the founder hit "Like"
  // without first hitting "Use this draft → Schedule", the
  // visual was orphaned and the draft showed up image-less in
  // the Library. Now the visuals/generate endpoint writes URL
  // + prompt back here when called with a draftId, so a
  // refreshed Library row carries its image.
  imageUrl: text('image_url'),
  imagePrompt: text('image_prompt'),
  // PR #51 — Sprint 6.8.2: performance rating ALSO on drafts.
  // Pre-PR-51 only scheduled_posts could be rated (post-publish
  // reality check). The founder QA asked for a single
  // /api/marketing/posts/[id]/performance endpoint that works
  // regardless of source — we route polymorphically by id
  // lookup. The same four fields shape mirrors scheduled_posts
  // (rating, note, metrics jsonb, ratedAt) so generate-post can
  // pull "what worked" from either table with a single field
  // contract.
  performanceRating: text('performance_rating'),
  performanceNote: text('performance_note'),
  performanceMetrics: jsonb('performance_metrics'),
  performanceRatedAt: timestamp('performance_rated_at'),
  // PR #60 — Sprint 7.0.4: structured drafts.
  //
  // `contentType` references content_types.type (e.g. 'reel',
  // 'carousel'). Null = legacy plain-text draft from the original
  // generate-post flow, kept null-safe so the old UI still works.
  // `structuredContent` holds the parsed JSON output from Opus
  // (hook+beats+caption for reels, slides+caption for carousels,
  // etc.). The original `content` field stays populated with a
  // human-readable fallback string for backward compatibility.
  contentType: text('content_type'),
  structuredContent: jsonb('structured_content'),
});

// ===== Research Findings =====
// Reddit/HN/IH posts that match the user's niche
export const researchFindings = pgTable('research_findings', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  source: text('source').notNull(), // 'reddit' | 'hackernews' | 'producthunt' | 'indiehackers'
  externalId: text('external_id').notNull(),
  title: text('title').notNull(),
  url: text('url').notNull(),
  snippet: text('snippet'),
  matchScore: integer('match_score'), // 0-100, computed by Claude
  upvotes: integer('upvotes'),
  comments: integer('comments'),
  postedAt: timestamp('posted_at'),
  foundAt: timestamp('found_at').defaultNow().notNull(),
  isHidden: boolean('is_hidden').default(false),
  // Set by the scoring step when the finding mentions a known competitor.
  // Null for findings that are about the user's own product / niche only.
  competitor: text('competitor'),
  // PR #57 — Sprint 7.0.1: link each finding back to the directory row
  // it came from. Nullable because the scan endpoint still inserts
  // legacy un-sourced findings until we wire the sources loop end-to-
  // end (Sprint 7.0.2 territory).
  sourceId: uuid('source_id').references(() => sourceDirectory.id),
});

// ===== Waitlist Pages =====
// Validate tab — landing pages users create
export const waitlistPages = pgTable('waitlist_pages', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  subtitle: text('subtitle'),
  ctaText: text('cta_text').default('Join waitlist'),
  // DEPRECATED: replaced by templateConfig below. Kept here only so the TS
  // schema stays in sync with the DB column until we drop it via
  // scripts/cleanup-legacy-config.ts. Don't read or write to this field.
  config: jsonb('config').$type<{
    primaryColor?: string;
    showCount?: boolean;
    [key: string]: unknown;
  }>(),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  // Validation template + per-template config
  template: text('template').default('minimal'),
  // 'minimal' | 'beta-tester' | 'feature-vote' | 'pricing-test' | 'survey-5q'
  // Cached AI analysis for survey-5q pages. Legacy field — Validate UI
  // and analyze endpoint were removed in PR #22, but the column stays so
  // existing waitlist data (still used by Compass + Analytics) is intact.
  surveyAnalysis: jsonb('survey_analysis').$type<{
    summary: string;
    overallSentiment: 'positive' | 'mixed' | 'negative';
    problemSolutionFit: number; // 0-10
    perQuestionThemes: {
      question: string;
      themes: string[];
      quotes: { text: string; from?: string }[];
    }[];
    overallThemes: string[];
    standoutQuotes: { text: string; from?: string; reason: string }[];
    nextActions: string[];
    generatedAt: string;
    // Number of responses available when this analysis was generated; the
    // panel uses this to mark itself "Outdated" once new responses arrive.
    respondedCount?: number;
  }>(),
  templateConfig: jsonb('template_config').$type<{
    subtitle?: string;
    ctaText?: string;
    qualifyingQuestions?: {
      question: string;
      type: 'text' | 'select';
      options?: string[];
    }[];
    features?: { id: string; title: string; description: string }[];
    maxVotesPerUser?: number;
    pricePerMonth?: number;
    priceVariant?: 'a' | 'b';
    discountPct?: number;
    questions?: string[];
  }>(),
  // Auto-increments on every PATCH that touches templateConfig. Responses
  // record this number when submitted, so an A/B test can attribute each
  // response to the exact config the visitor saw.
  templateVersion: integer('template_version').default(1).notNull(),
});

// ===== Waitlist Signups =====
// Users who sign up to a waitlist page
export const waitlistSignups = pgTable('waitlist_signups', {
  id: uuid('id').primaryKey().defaultRandom(),
  waitlistPageId: uuid('waitlist_page_id')
    .notNull()
    .references(() => waitlistPages.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ===== Waitlist Responses =====
// Generic response storage for any of the 5 validate templates. The shape of
// `responses` jsonb depends on the page's template:
//   minimal      → {}
//   beta-tester  → { q0: "...", q1: "..." }
//   feature-vote → { votes: ['feat-1', 'feat-3'] }
//   pricing-test → { commit: true, price, discountedPrice, variant }
//   survey-5q    → { q0: "...", q1: "...", ... }
export const waitlistResponses = pgTable('waitlist_responses', {
  id: uuid('id').primaryKey().defaultRandom(),
  waitlistPageId: uuid('waitlist_page_id')
    .notNull()
    .references(() => waitlistPages.id, { onDelete: 'cascade' }),
  email: text('email'),
  responses: jsonb('responses').$type<Record<string, unknown>>(),
  ipHash: text('ip_hash'), // sha256(ip + slug) for dedup
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  // Snapshot of waitlistPages.templateConfig at the moment this response
  // was submitted. Lets the responses page show "Saw price $19" even after
  // the user re-edits the config later.
  templateConfigSnapshot: jsonb('template_config_snapshot'),
  templateVersion: integer('template_version').default(1).notNull(),
});

// ===== Helm waitlist =====
// People signing up to the Helm landing page itself
export const helmWaitlist = pgTable('helm_waitlist', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  source: text('source'), // 'reddit', 'twitter', 'direct', etc
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ===== Research Config =====
// Per-project research preferences: keywords, competitors, sources, and
// the cached weekly insight generated by Claude Opus.
export const researchConfig = pgTable('research_config', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' })
    .unique(),
  keywords: jsonb('keywords').$type<string[]>().default([]),
  competitors: jsonb('competitors').$type<string[]>().default([]),
  excludeWords: jsonb('exclude_words').$type<string[]>().default([]),
  sources: jsonb('sources')
    .$type<{
      reddit: boolean;
      hackernews: boolean;
      indiehackers: boolean;
      googleTrends: boolean;
    }>()
    .default({
      reddit: true,
      hackernews: true,
      indiehackers: true,
      googleTrends: true,
    }),
  lastSyncedAt: timestamp('last_synced_at'),
  weeklyInsight: text('weekly_insight'),
  weeklyInsightAt: timestamp('weekly_insight_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  // PR #59 — Sprint 7.0.3: opt-in for Reddit RSS scanning. We keep
  // this OUTSIDE the `sources` JSONB so it's queryable + indexable +
  // doesn't conflict with the legacy keyword-search flag. The
  // timestamp captures consent for traceability if Reddit ever asks.
  redditRssOptin: boolean('reddit_rss_optin').default(false).notNull(),
  redditRssOptinAt: timestamp('reddit_rss_optin_at'),
});

// ===== Scheduled Posts =====
// Posts the user composed and scheduled for later (no auto-post yet — the
// cron just flips status to 'notified' so a future Resend hook can email
// the user a reminder + ready-to-paste content).
export const scheduledPosts = pgTable('scheduled_posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(), // instagram | facebook | linkedin | threads
  content: text('content').notNull(),
  templateUsed: text('template_used'),
  scheduledFor: timestamp('scheduled_for').notNull(),
  status: text('status').notNull().default('scheduled'),
  // 'scheduled' | 'notified' | 'posted' | 'cancelled'
  notifiedAt: timestamp('notified_at'),
  postedAt: timestamp('posted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  // Brand consistency score computed at schedule time. Null on rows from
  // before PR #11. The breakdown is stored separately so we can analyze
  // dimension drift without re-evaluating posts.
  consistencyScore: integer('consistency_score'),
  scoreBreakdown: jsonb('score_breakdown').$type<ScoreBreakdown>(),
  // Visual asset attached to the post. `visualUrl` points to a Supabase
  // Storage public URL when persistence succeeded, or to fal.ai's
  // transient CDN URL when it didn't. `visualType` differentiates plain
  // images from carousel slides (carousel URLs are stored in a slides
  // jsonb when implemented; for now the field is just for identification).
  visualUrl: text('visual_url'),
  visualPrompt: text('visual_prompt'),
  visualType: text('visual_type'), // 'image' | 'carousel' | null
  // Founder feedback after the post went out: 'worked' | 'flopped' | null.
  // Powers the Performance Memory analysis (PR #13). PR #23 added a
  // 'not_sure' option (kept as text, not enum, so legacy rows stay valid).
  performanceRating: text('performance_rating'),
  performanceNote: text('performance_note'),
  ratedAt: timestamp('rated_at'),
  // PR #23: optional manual metrics the founder enters in the Library
  // detail modal after a post goes out. Most platforms don't expose post-
  // level metrics via API for free, so we let the user fill these in by
  // hand for the rare cases where they want to track virality numerically.
  metricsImpressions: integer('metrics_impressions'),
  metricsLikes: integer('metrics_likes'),
  metricsComments: integer('metrics_comments'),
  metricsShares: integer('metrics_shares'),
  // PR #29 — Sprint 5.1: Auto-publishing fields. The scheduled-post
  // lifecycle is now: scheduled → (cron fires at scheduledFor) → the
  // publisher tries to push to Meta → published OR failed (with
  // retry). publishStatus is independent of `status` because some
  // failure modes leave the row in {status: 'scheduled',
  // publishStatus: 'failed'} (eligible for retry) while others move
  // straight to {status: 'published', publishStatus: 'published'}.
  publishStatus: text('publish_status'), // null | 'pending' | 'publishing' | 'published' | 'failed'
  publishedAt: timestamp('published_at'),
  publishFailureReason: text('publish_failure_reason'),
  publishRetryCount: integer('publish_retry_count').default(0).notNull(),
  publishNextRetryAt: timestamp('publish_next_retry_at'),
  // Meta-specific identifiers — stored only after a successful publish.
  // metaPostId is the FB post id or IG media id; metaPermalink is the
  // public URL we link to from Library. metaContainerId is the IG
  // 2-step container id we save before calling /media_publish so a
  // retry doesn't recreate it. metaTargetType is left flexible
  // ('facebook_page' | 'instagram_feed' | 'instagram_story' |
  // 'instagram_reel') — Sprint 5.2/5.3 will use the latter values.
  metaPostId: text('meta_post_id'),
  metaPermalink: text('meta_permalink'),
  metaTargetType: text('meta_target_type'),
  metaContainerId: text('meta_container_id'),
  // PR #30 — Sprint 5.2: Instagram Stories. When isStory is true the
  // publisher uses the STORIES container path instead of the regular
  // feed media call. storyExpiresAt is set to publishedAt + 24h so
  // the UI can flag a row as "expired" — Stories disappear from the
  // public IG view 24h after posting; the permalink may 404 after
  // that unless the founder archived it as a Highlight manually.
  isStory: boolean('is_story').default(false).notNull(),
  storyExpiresAt: timestamp('story_expires_at'),
  // PR #32 — Sprint 5.3: Instagram Reels. Reels diverge from
  // Stories/feed because Meta processes the video asynchronously
  // (~30-90s typically, can stretch). The publisher creates the
  // container and stops; a SECOND cron (poll-reels) checks
  // status_code on a backoff schedule and calls /media_publish
  // when status hits FINISHED.
  //
  // Storage: video lives in the "reels" Supabase bucket with a
  // public-read URL Meta can fetch. video_url is that URL.
  // Other fields are captured client-side at upload time so the
  // backend can re-validate without parsing the video again.
  isReel: boolean('is_reel').default(false).notNull(),
  videoUrl: text('video_url'),
  videoDurationSeconds: integer('video_duration_seconds'),
  videoSizeBytes: bigint('video_size_bytes', { mode: 'number' }),
  videoAspectRatio: numeric('video_aspect_ratio', {
    precision: 5,
    scale: 4,
  }),
  // Reel processing lifecycle, distinct from publishStatus:
  //   uploading → uploaded → meta_processing → ready → (publish path)
  //   uploading → uploaded → meta_processing → error
  reelProcessingStatus: text('reel_processing_status'),
  reelProcessingError: text('reel_processing_error'),
  reelPollingAttempts: integer('reel_polling_attempts')
    .default(0)
    .notNull(),
  reelPollingNextAt: timestamp('reel_polling_next_at'),
  // PR #63 — Sprint 7.0.6: structured-draft propagation.
  //
  // `contentType` and `structuredContent` are copied from
  // `generated_posts` when the founder schedules a structured draft.
  // Both nullable so legacy plain-text scheduled posts stay valid.
  //
  // Reading these here unlocks two follow-ups:
  //   - Calendar/Library badges (Sprint 7.0.5) now show per-format
  //     chips on scheduled posts, not just drafts.
  //   - The publisher cron (Sprint 7.0.7) can dispatch on
  //     contentType to pick the right Meta posting path (Carousel
  //     multi-image, Reel async upload, etc.).
  contentType: text('content_type'),
  structuredContent: jsonb('structured_content'),
});

// ===== Meta Integrations =====
// PR #29 — Sprint 5.1. One row per (user, project) pair representing
// a connected Meta (Facebook + Instagram) Business asset. The project
// is the unit of integration because a single user may run multiple
// brands (Voya, Helm, …) each with its own FB Page.
//
// We deliberately store only the Page Access Token (encrypted), not
// the user-level token — the Page token is what the publishing engine
// uses and Meta scopes it to the Page only. UNIQUE on project_id
// enforces "one active integration per project" — re-connecting
// upserts.
export const metaIntegrations = pgTable(
  'meta_integrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    // Facebook Page (auto-selected first page during OAuth — future PR
    // adds a picker UI when the user has multiple pages).
    facebookPageId: text('facebook_page_id'),
    facebookPageName: text('facebook_page_name'),
    // AES-256-GCM encrypted long-lived Page Access Token (60 days).
    // NEVER returned to the client.
    facebookPageAccessToken: text('facebook_page_access_token'),
    // Instagram Business account linked to the FB Page (optional —
    // pages without IG just can't post to IG).
    instagramBusinessId: text('instagram_business_id'),
    instagramBusinessUsername: text('instagram_business_username'),
    // User-level metadata captured during OAuth for display purposes.
    metaUserId: text('meta_user_id'),
    metaUserName: text('meta_user_name'),
    tokenExpiresAt: timestamp('token_expires_at'),
    tokenRefreshedAt: timestamp('token_refreshed_at'),
    // 'pending' | 'connected' | 'expired' | 'disconnected' | 'failed'
    status: text('status').notNull().default('pending'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    uniqueProject: unique().on(t.projectId),
  })
);

// ===== Brand Quotes =====
// Founder-curated library of quotes that capture authentic voice. Used by
// post generation to seed each draft with a real example of how the
// founder talks. usageCount + lastUsedAt let us round-robin so the same
// quote doesn't dominate every post.
export const brandQuotes = pgTable('brand_quotes', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  source: text('source'), // "Podcast X", "Tweet from Y", etc
  context: text('context'), // founder's own annotation
  tags: text('tags').array(),
  usageCount: integer('usage_count').default(0).notNull(),
  lastUsedAt: timestamp('last_used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ===== Compass Readings =====
// PR #14 — VC-style scorecard 0-100 across 5 dimensions. Each row is a
// snapshot computed at a moment in time. We persist every recompute so
// founders can see their score evolve.
export const compassReadings = pgTable('compass_readings', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  totalScore: integer('total_score').notNull(),
  // 'strong' | 'clear' | 'steady' | 'uncertain' | 'off-course'
  band: text('band').notNull(),
  // Full dimension breakdown — typed loosely here so the row is portable;
  // strict types live in lib/types/compass.ts.
  dimensions: jsonb('dimensions').notNull().$type<unknown>(),
  redFlags: jsonb('red_flags').$type<unknown>(),
  bullCase: jsonb('bull_case').$type<unknown>(),
  bearCase: jsonb('bear_case').$type<unknown>(),
  dueDiligenceQuestion: text('due_diligence_question'),
  recommendations: jsonb('recommendations').$type<unknown>(),
  // Snapshot of the form answers so we can pre-fill the wizard next time.
  formData: jsonb('form_data').$type<Record<string, unknown>>(),
  computedBy: text('computed_by').notNull().default('manual'),
  dataQuality: integer('data_quality').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ===== Brand Bible Sources =====
// PR #26 — Sprint 3. Multi-source feed for the auto-generated brand
// bible. Each row is one connected channel (website / FB page / IG
// business / etc) tied to a project. We store the raw analysis output
// in `analysis_result` so the auto-generation step can consume signals
// from every connected source without re-scraping.
//
// `access_token` is plain-text for now; OAuth + encryption land in
// Sprint 5 when the Meta integration ships. Keeping the column there
// today means no follow-up migration is needed.
export const brandBibleSources = pgTable('brand_bible_sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  // 'website' | 'facebook_page' | 'instagram_business' | 'linkedin' | 'twitter'
  // Only 'website' is wired up server-side today; the rest return 501
  // until OAuth ships in Sprint 5.
  sourceType: text('source_type').notNull(),
  sourceUrl: text('source_url'), // for 'website'
  sourceExternalId: text('source_external_id'), // Meta page id, etc
  sourceHandle: text('source_handle'), // @username
  // 'pending' | 'analyzing' | 'analyzed' | 'failed' | 'disconnected'
  status: text('status').notNull().default('pending'),
  // Raw output of the per-source analysis (WebScrapingResult shape for
  // 'website'; per-platform shape for the rest later).
  analysisResult: jsonb('analysis_result'),
  // OAuth fields — unused until Sprint 5; kept here so the schema is
  // stable when that PR lands.
  accessToken: text('access_token'),
  tokenExpiresAt: timestamp('token_expires_at'),
  lastAnalyzedAt: timestamp('last_analyzed_at'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ===== Brand Image Validations =====
// PR #27 — Sprint 4. After the user applies an auto-generated bible
// (PR #26), they can ask Helm to render 12 sample images across
// realistic marketing surfaces (IG cover, LinkedIn header, hero
// banner, quote tile, etc) and thumbs-up/down each one. The vote
// data feeds into a future re-generation pass that nudges prompts
// based on what landed and what didn't.
//
// `batch_id` groups the 12 images of a single "Generate" click so the
// UI can render the latest batch without paginating across history.
// `vote` is nullable so an image starts unvoted; null vote also lets
// the user retract a vote later.
export const brandImageValidations = pgTable('brand_image_validations', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  batchId: uuid('batch_id').notNull(),
  // 'instagram_cover' | 'linkedin_header' | 'website_hero' |
  // 'quote_tile' | 'founder_photo' | 'product_mockup' |
  // 'behind_scenes' | 'testimonial' | 'stats_viz' |
  // 'announcement' | 'lifestyle' | 'brand_mood'
  contextType: text('context_type').notNull(),
  contextLabel: text('context_label').notNull(),
  contextDimensions: text('context_dimensions').notNull(), // '1:1' | '16:9' | '4:5'
  prompt: text('prompt').notNull(),
  imageUrl: text('image_url').notNull(),
  // Tracked so the UI can show running cost + future cost-cap rules.
  // Stored as numeric so we don't lose cents to float roundoff.
  generationCost: numeric('generation_cost', { precision: 10, scale: 4 }),
  // 'positive' | 'negative' | null
  vote: text('vote'),
  votedAt: timestamp('voted_at'),
  voteReason: text('vote_reason'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ===== Public Bible Previews =====
// PR #34 — Sprint 6.2. Cache for the landing page's "see your brand"
// teaser. Anyone can hit POST /api/public/preview-bible with a URL
// and get a small AI-generated preview of how Helm would interpret
// their brand — no signup required. We cache for 7 days per URL hash
// so a viral share doesn't hammer Anthropic.
//
// `url_hash` = sha256(normalized URL).slice(0, 32) — collision-safe
// for the corpus we'd ever cache, and shorter than the full URL on
// the index. The original URL stays in `original_url` for display.
export const publicBiblePreviews = pgTable('public_bible_previews', {
  id: uuid('id').primaryKey().defaultRandom(),
  urlHash: text('url_hash').notNull().unique(),
  originalUrl: text('original_url').notNull(),
  previewArchetype: text('preview_archetype'),
  previewVoice: text('preview_voice'),
  previewPillars: jsonb('preview_pillars').$type<string[]>(),
  previewAudience: text('preview_audience'),
  previewOneLiner: text('preview_one_liner'),
  // Tracked so we can spot expensive runs in the future.
  generationCost: numeric('generation_cost', { precision: 10, scale: 6 }),
  visitCount: integer('visit_count').default(0).notNull(),
  lastVisitedAt: timestamp('last_visited_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at'),
});

// ===== Preview Rate Limits =====
// PR #34 — per-IP-hash rate limiter for /api/public/preview-bible.
// Plain hashed IPs (no plaintext) — see lib/landing/rate-limit.ts.
// Window is 1h; 5 requests/window; 1h block on overflow.
export const previewRateLimits = pgTable('preview_rate_limits', {
  ipHash: text('ip_hash').primaryKey(),
  count: integer('count').notNull().default(0),
  windowStart: timestamp('window_start').notNull().defaultNow(),
  blockedUntil: timestamp('blocked_until'),
});

// ===== Anthropic Usage Log =====
// PR #35 — Sprint 6.3: every cached endpoint persists usage stats
// here so we can watch cache hit rate trend over time and spot any
// endpoint that regressed (cache_read_input_tokens dropping to zero
// = something broke the prefix). user_id and project_id are
// nullable because the public preview endpoint logs without either.
export const anthropicUsageLog = pgTable('anthropic_usage_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id'),
  projectId: uuid('project_id'),
  endpoint: text('endpoint').notNull(), // 'generatePost' | 'consistency-score' | …
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
  cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
  estimatedCostUsd: numeric('estimated_cost_usd', {
    precision: 10,
    scale: 6,
  }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ===== Source Directory (PR #56 — Sprint 7.0) =====
// Global catalog of every research source we've ever discovered. Rows
// are NOT per-project — many founders care about r/SaaS, so we don't
// want to insert it three times. The (platform, identifier) pair is
// the natural key (Reddit subreddit name, YouTube channel ID, etc.)
// and `unique` enforces dedup at the DB layer.
//
// `metadata` is platform-specific raw payload (subreddit's
// `subscribers`, `over18`, `lang`, etc.) — we keep the full JSON so
// future ranking improvements don't need a re-scan.
export const sourceDirectory = pgTable(
  'source_directory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    platform: text('platform').notNull(), // 'reddit' | 'youtube' | …
    identifier: text('identifier').notNull(), // subreddit name, channel id
    displayName: text('display_name').notNull(),
    url: text('url').notNull(),
    memberCount: integer('member_count'),
    activityLevel: text('activity_level'), // 'low' | 'medium' | 'high'
    language: text('language'),
    description: text('description'),
    metadata: jsonb('metadata'),
    discoveredAt: timestamp('discovered_at').defaultNow().notNull(),
    lastVerified: timestamp('last_verified'),
  },
  (t) => ({
    platformIdent: unique('source_directory_platform_ident_uk').on(
      t.platform,
      t.identifier,
    ),
  }),
);

// ===== Project Sources (PR #56 — Sprint 7.0) =====
// Per-project join row: which sources from the directory has this
// project's founder chosen to monitor (`connected`), explicitly
// dismissed (`skipped`), or simply seen as a suggestion (`suggested`).
//
// Defense-in-depth: `userId` is redundant with `projects.userId` but
// duplicated here so every isolation query can filter directly without
// an extra join — same pattern as `generatedPosts.userId` (PR #15).
//
// `signalScore` is the Haiku-4.5 ranking output (0-100, defaults to
// 50 if a connect happens without ranking). `findingsCount` is a
// denormalized counter we'll bump as the scan loop discovers items
// from this source.
export const projectSources = pgTable('project_sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull(),
  sourceId: uuid('source_id')
    .notNull()
    .references(() => sourceDirectory.id),
  status: text('status').notNull(), // 'suggested' | 'connected' | 'skipped'
  connectedAt: timestamp('connected_at'),
  lastScannedAt: timestamp('last_scanned_at'),
  scanCount: integer('scan_count').default(0),
  signalScore: integer('signal_score').default(50),
  findingsCount: integer('findings_count').default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ===== Research Insights (PR #57 — Sprint 7.0.1) =====
// One row per weekly Pain Point extraction run. The Haiku extractor
// summarizes connected-source findings into a structured pain-point
// list with a quote, frequency, platform, and an actionable angle.
//
// `weekStarting` lets the Weekly Brief (deferred to Sprint 7.0.2) pull
// "this week's pains" reliably without re-running the extractor.
// `briefSent` is a guard so a re-run of the cron can't double-email.
// `sourcesUsed` is a flat jsonb array of project_source IDs the
// extraction actually drew from — useful for the UI to surface
// "extracted from N sources".
export const researchInsights = pgTable('research_insights', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull(), // defense-in-depth — same as projectSources
  painPoints: jsonb('pain_points'),
  summary: text('summary'),
  skippedReason: text('skipped_reason'),
  sourcesUsed: jsonb('sources_used'),
  weekStarting: timestamp('week_starting'),
  briefSent: boolean('brief_sent').default(false),
  briefSentAt: timestamp('brief_sent_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ===== Brand Analysis (PR #62 — Sprint 7.0.5) =====
// Cached Opus-4.7 deep analysis of a brand's niche, audience layers,
// competitor gap, and recommended specificity. Drives Smart Auto-
// configure (`/api/research/analyze-brand`).
//
// We cache 30 days because re-running is expensive (~$0.10 Opus call
// + ~$0.005 Haiku follow-up) and the underlying brand bible rarely
// changes that fast. Founder can force-regenerate via the UI's
// "Regenerate" button.
//
// `searchKeywords` + `suggestedSources` + `toneGuidance` come from
// the Haiku follow-up pass and downstream endpoints
// (auto-connect-sources) read this row directly.
export const brandAnalysis = pgTable('brand_analysis', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull(), // defense-in-depth
  niche: text('niche').notNull(),
  subNiches: jsonb('sub_niches'),
  audienceLayers: jsonb('audience_layers'),
  competitorGap: text('competitor_gap'),
  specificityRecommended: text('specificity_recommended'), // 'broad' | 'niche' | 'hyper'
  specificityReasoning: text('specificity_reasoning'),
  searchKeywords: jsonb('search_keywords'),
  suggestedSources: jsonb('suggested_sources'),
  toneGuidance: jsonb('tone_guidance'),
  competitorAngles: jsonb('competitor_angles'),
  generatedBy: text('generated_by').default('claude-opus-4-7'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at'),
});

// ===== Content Types (PR #60 — Sprint 7.0.4) =====
// Templates per (platform, type) pair that describe how the AI should
// structure a draft for that specific format. Seeded once via
// scripts/seed-content-types.ts; updating a template doesn't break
// existing drafts since each draft already stores its own
// structuredContent snapshot in generatedPosts.
//
// Why a table (vs hardcoding in code): the founder will iterate on
// these prompts based on real output quality, and we want hot-fixing
// the prompt for "Instagram Reel" to be a single UPDATE rather than
// a redeploy.
export const contentTypes = pgTable(
  'content_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    platform: text('platform').notNull(), // 'instagram' | 'facebook' | 'linkedin' | 'reddit' | 'threads' | 'x'
    type: text('type').notNull(), // 'reel' | 'carousel' | 'photo' | 'text_post' | 'self_post' | 'thread' | …
    displayName: text('display_name').notNull(),
    description: text('description'),
    promptTemplate: text('prompt_template').notNull(),
    structureSchema: jsonb('structure_schema').notNull(),
    guidelines: text('guidelines'),
    maxLength: integer('max_length'),
    defaultEnabled: boolean('default_enabled').default(true).notNull(),
    displayOrder: integer('display_order').default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    platformTypeUk: unique('content_types_platform_type_uk').on(
      t.platform,
      t.type,
    ),
  }),
);

// ===== User Content Preferences (PR #60 — Sprint 7.0.4) =====
// Per-project: which content types is THIS project's founder
// generating right now. One row per (project, platform). The
// `enabledTypes` jsonb is just an array of type strings.
//
// We carry redundant userId for defense-in-depth (same pattern as
// projectSources in PR #56).
export const userContentPreferences = pgTable(
  'user_content_preferences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    platform: text('platform').notNull(),
    enabledTypes: jsonb('enabled_types').notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    projectPlatformUk: unique('user_content_preferences_project_platform_uk').on(
      t.projectId,
      t.platform,
    ),
  }),
);

// ===== Research Cache (PR #59 — Sprint 7.0.3) =====
// Generic TTL cache used by the Reddit RSS client (and any future
// rate-limited fetchers). We put this in Postgres rather than Vercel
// KV because KV moved to a paid tier in late 2025 and the access
// pattern (writes ~ every 24h per key, reads on every scan) is fine
// for Postgres at our volume.
//
// `cacheKey` is the natural PK — unique-indexed for fast lookup +
// upserts via onConflictDoUpdate. `expiresAt` lets the cron sweep
// stale rows daily.
export const researchCache = pgTable('research_cache', {
  id: uuid('id').primaryKey().defaultRandom(),
  cacheKey: text('cache_key').notNull().unique(),
  cacheValue: jsonb('cache_value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ===== Type exports =====
export type User = typeof users.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Integration = typeof integrations.$inferSelect;
export type MetricSnapshot = typeof metricSnapshots.$inferSelect;
export type GeneratedPost = typeof generatedPosts.$inferSelect;
export type ResearchFinding = typeof researchFindings.$inferSelect;
export type WaitlistPage = typeof waitlistPages.$inferSelect;
export type WaitlistResponse = typeof waitlistResponses.$inferSelect;
export type ScheduledPost = typeof scheduledPosts.$inferSelect;
export type ResearchConfig = typeof researchConfig.$inferSelect;
export type BrandQuote = typeof brandQuotes.$inferSelect;
export type CompassReadingRow = typeof compassReadings.$inferSelect;
export type BrandBibleSource = typeof brandBibleSources.$inferSelect;
export type BrandImageValidation = typeof brandImageValidations.$inferSelect;
export type MetaIntegration = typeof metaIntegrations.$inferSelect;
export type SourceDirectoryRow = typeof sourceDirectory.$inferSelect;
export type ProjectSource = typeof projectSources.$inferSelect;
export type ResearchInsight = typeof researchInsights.$inferSelect;
export type ResearchCacheRow = typeof researchCache.$inferSelect;
export type ContentType = typeof contentTypes.$inferSelect;
export type UserContentPreference = typeof userContentPreferences.$inferSelect;
export type BrandAnalysisRow = typeof brandAnalysis.$inferSelect;
