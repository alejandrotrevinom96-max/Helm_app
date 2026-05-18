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
  uniqueIndex,
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
    // PR #86 — Sprint 7.10: HeyGen avatar configuration. Lives on
    // projects (not a separate project_settings table) because
    // every project gets exactly one avatar and the column count
    // is small. heygenAvatarType drives a dispatch in the
    // generate-video route:
    //   - 'stock': use heygenAvatarId against HeyGen's stock
    //     avatar library (GET /v2/avatars).
    //   - 'photo': use heygenPhotoUrl against the Photo Avatar IV
    //     model (talking_photo + use_avatar_iv_model: true).
    //   - 'twin' (locked, Coming Soon): would record a 15s clip
    //     and create a Digital Twin avatar. Reserved as a paid-
    //     plan feature; the dispatcher refuses 'twin' until the
    //     enrollment flow ships.
    // heygenVoiceId is optional — when null we fall back to the
    // avatar's default voice (HeyGen returns one with the avatar
    // metadata).
    heygenAvatarType: text('heygen_avatar_type').default('stock'),
    heygenAvatarId: text('heygen_avatar_id'),
    heygenPhotoUrl: text('heygen_photo_url'),
    heygenVoiceId: text('heygen_voice_id'),
    // PR Sprint C — track gender for both avatar and voice so the
    // picker can auto-match (avoid the "male avatar speaking with
    // the deploy-wide female default voice" uncanny-valley bug),
    // and so fire.ts can pick a gender-correct fallback when
    // HeyGen rejects the saved voice_id. Lowercase 'male' |
    // 'female' | 'neutral' — HeyGen returns capitalized strings
    // from /v2/avatars + /v2/voices; we normalize at write time.
    heygenAvatarGender: text('heygen_avatar_gender'),
    heygenVoiceGender: text('heygen_voice_gender'),
    // PR Sprint D-1 — voice & avatar tuning fields the founder
    // can override per project. All nullable; null means "let
    // fire.ts pick a sensible default". Values that ship to
    // HeyGen's /v2/video/generate payload under the `voice` and
    // `character` objects.
    //
    //   voiceEmotion        → voice.emotion (case-sensitive
    //                          HeyGen enum: 'Excited' | 'Friendly'
    //                          | 'Serious' | 'Soothing' |
    //                          'Broadcaster' | 'Angry')
    //   voiceLocale         → voice.locale (e.g. 'en-US', 'es-MX')
    //   voiceSpeed          → voice.speed (0.5–1.5)
    //   avatarExpressiveness → character.alpha for Avatar IV photo
    //                          avatars. high=-0.3 (more expressive)
    //                          medium=0.0 low=0.2. Pre-fix UGC
    //                          rendered "rígida"; high is what we
    //                          want by default for UGC.
    //   avatarMotionPrompt  → character.prompt for Avatar IV. NL
    //                          description of body language ("hand
    //                          gestures while explaining a chart").
    heygenVoiceEmotion: text('heygen_voice_emotion'),
    heygenVoiceLocale: text('heygen_voice_locale'),
    heygenVoiceSpeed: numeric('heygen_voice_speed', {
      precision: 3,
      scale: 2,
    }),
    heygenAvatarExpressiveness: text('heygen_avatar_expressiveness'),
    heygenAvatarMotionPrompt: text('heygen_avatar_motion_prompt'),
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

// ===== Content Assets =====
// PR Sprint 7.26 — Asset-based content flow.
//
// Helm's content model used to be "1 generated_post per platform" —
// the founder picked a platform, the generator produced a post for
// that platform, and shipping to 3 platforms meant generating 3
// independent posts (3 image calls, 3 HeyGen renders, 3x cost).
//
// New model: ONE asset (video / carousel / photo / long-form text)
// is generated ONCE. Then the SAME asset is published to N platforms
// with platform-specific captions (TikTok hashtags vs. LinkedIn
// professional opener vs. IG storytelling). content_assets stores
// the asset; generated_posts becomes the per-platform variant
// pointing back via assetId.
//
// Why a separate table (vs. a self-foreign-key on generated_posts):
//   - Asset media (videoUrl, imageUrls) lives once, not duplicated
//     across N rows.
//   - HeyGen jobs / Flux renders link to the asset, not to one
//     of the N captions.
//   - Library + Calendar can group rows by asset cleanly.
//   - The brand-bible snapshot at generation time travels with
//     the asset for future audits, not duplicated per caption.
//
// Lifecycle:
//   1. UI POST /api/ai/generate-asset {assetType, platforms[], prompt}.
//   2. Backend creates the asset row first (status implicit:
//      pending media gen if it's a video/carousel).
//   3. Backend fires N parallel Haiku calls — one per platform —
//      with platform-specific tone rules. Each returns a caption
//      that we store in a new generated_posts row keyed to this
//      asset by asset_id.
//   4. Media generation (Flux for image/carousel, HeyGen for video)
//      either runs synchronously or fires-and-forgets via the
//      existing pipelines; the asset is the join point.
//
// Backfill: scripts/migrate-content-assets.ts creates 1 asset per
// existing generated_post (1:1) so legacy data still groups
// correctly under the new model. Old posts keep their existing
// shape; the new flow uses asset_id + caption/hashtags/cta columns.
export const contentAssets = pgTable('content_assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  // 'ugc_video' | 'reel' | 'carousel' | 'photo' | 'long_form_text'
  // Drives platform allowlist (PLATFORM_RULES in
  // lib/marketing/platform-rules.ts) and media-generation dispatch.
  assetType: text('asset_type').notNull(),
  // Media URLs. Exactly one of these is populated based on assetType:
  //   ugc_video / reel → videoUrl (HeyGen render — may be null until
  //                                the heygen-worker finishes).
  //   carousel         → imageUrls (jsonb array, ~5-8 slides).
  //   photo            → imageUrls (jsonb array of length 1).
  //   long_form_text   → both null (baseContent IS the asset).
  videoUrl: text('video_url'),
  imageUrls: jsonb('image_urls').$type<string[]>(),
  // The core content — for video that's the script; for long-form
  // text that's the body; for visual types that's the seed prompt
  // expanded by Claude into something Flux can consume.
  baseContent: text('base_content').notNull(),
  // Snapshot of the brand bible (and voice fingerprint) at the
  // moment the asset was generated, so we can re-audit captions
  // against the brand context that was live then — independent of
  // later edits to projects.brandContext.
  brandAnalysisSnapshot: jsonb('brand_analysis_snapshot'),
  promptUsed: text('prompt_used').notNull(),
  // Carried for forward-compat with the A/B-pair flow (PR Sprint
  // 7.24). The new asset endpoint produces a SINGLE asset by
  // default (variantLabel=null); future variants can co-exist via
  // variantGroupId binding without a schema change.
  variantLabel: text('variant_label'), // 'A' | 'B' | null
  variantGroupId: uuid('variant_group_id'),
  // HeyGen callback id for ugc_video / reel assets. The
  // heygen-worker cron uses this to map upstream completion
  // webhooks back to the right asset.
  heygenJobId: text('heygen_job_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ===== Generated Posts =====
// Marketing tab — Claude-generated content
export const generatedPosts = pgTable('generated_posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  // PR Sprint 7.26 — Asset-based flow. When set, this row is the
  // per-platform variant of a content_asset. The asset holds the
  // shared media + base content; this row holds the per-platform
  // caption + hashtags + cta. Null for legacy pre-7.26 posts (which
  // act as their own implicit single-platform asset). After the
  // migration runs every existing row gets a 1:1 backfilled
  // asset_id, but we keep the column nullable so the type system
  // doesn't force every code path through a "guaranteed asset".
  assetId: uuid('asset_id').references(() => contentAssets.id, {
    onDelete: 'cascade',
  }),
  platform: text('platform').notNull(), // 'instagram' | 'facebook' | 'linkedin' | 'threads' | 'reddit'
  content: text('content').notNull(),
  // PR Sprint 7.26 — Asset-based flow. For asset-linked rows these
  // are the per-platform adapted strings (TikTok: hook + 3-5
  // hashtags; LinkedIn: professional opener; etc). For legacy
  // pre-7.26 rows these are null and `content` holds the entire
  // post text.
  caption: text('caption'),
  hashtags: jsonb('hashtags').$type<string[]>(),
  ctaText: text('cta_text'),
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
  // PR Sprint 7.24 — Prompt 3. Per-content-type variants. For
  // every (platform, contentType) the founder selects, the
  // generator now produces TWO drafts: variant 'A' uses a direct/
  // factual hook style, variant 'B' uses a story/question hook
  // style. Both share the same variantGroupId so the Library /
  // Calendar can render them as a 2-up comparison ("pick your
  // favorite, delete the other"). Legacy rows pre-7.24 have
  // variantLabel=null AND variantGroupId=null and render
  // un-grouped — same as before.
  variantLabel: text('variant_label'), // 'A' | 'B' | null
  variantGroupId: uuid('variant_group_id'),
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
  // PR #65 — Sprint 7.0.8: array of slide image URLs for carousel
  // drafts. One URL per slide in `structuredContent.slides`. Null
  // for everything else (Reel, Photo, Text, etc.). The legacy
  // `imageUrl` column stays the single-image source of truth for
  // non-carousel posts.
  visualUrls: jsonb('visual_urls').$type<string[]>(),
  // PR Sprint 7.13 (BUG 2) — Brand fit score on drafts.
  //
  // Pre-fix only scheduledPosts carried consistencyScore (Sprint
  // 6.9). The Library card rendered the "Brand fit XX/100" badge
  // conditionally on `consistencyScore`, but for drafts the
  // Library API hardcoded null because the column didn't exist.
  // Result: founders saw the badge on published rows but never on
  // freshly-generated drafts — they reported it as "the badge
  // disappeared".
  //
  // We now mirror the scheduledPosts shape on drafts so:
  //   - /api/ai/generate-structured can compute + persist the
  //     score immediately after each Opus call.
  //   - The Library API can surface the same value uniformly for
  //     drafts AND scheduled rows.
  consistencyScore: integer('consistency_score'),
  scoreBreakdown: jsonb('score_breakdown'),
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
  // PR #65 — Sprint 7.0.8: carousel slide image URLs. Carried from
  // generated_posts on schedule so the publisher cron has the
  // images ready to push to Meta's carousel container endpoint.
  visualUrls: jsonb('visual_urls').$type<string[]>(),
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

// ===== Compass Blind Spots (PR #70 — Sprint 7.1C) =====
//
// Strategic blind-spot detection across 6 fixed frameworks:
// credibility_gap, pricing_psychology, icp_drift,
// content_product_mismatch, platform_scatter, social_proof_vacuum.
//
// Always 6 rows per project per scan (one per framework, even when
// `detected=false`) — transparency over hiding. Scan endpoint
// DELETEs the previous batch before INSERTing a fresh one, so the
// most recent scan is always the source of truth.
//
// 14-day TTL — the strategic picture doesn't shift that fast and
// each scan is ~$0.15 Opus.
export const compassBlindSpots = pgTable('compass_blind_spots', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull(),
  framework: text('framework').notNull(), // 6-value closed set, validated upstream
  detected: boolean('detected').notNull(),
  severity: text('severity'), // 'low' | 'medium' | 'high' | 'critical' | null
  confidenceScore: integer('confidence_score'),
  title: text('title').notNull(),
  description: text('description').notNull(),
  evidence: jsonb('evidence'), // string[] of concrete citations
  recommendation: text('recommendation'),
  suggestedActions: jsonb('suggested_actions'), // string[]
  inputsAnalyzed: jsonb('inputs_analyzed'),
  userStatus: text('user_status').default('open').notNull(), // 'open' | 'acknowledged' | 'dismissed' | 'resolved'
  userNotes: text('user_notes'),
  modelUsed: text('model_used').default('claude-opus-4-7'),
  generationCostUsd: numeric('generation_cost_usd', { precision: 10, scale: 4 }),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ===== Compass Strategic Timeline (PR #69 — Sprint 7.1D) =====
//
// Weekly canvas of STRATEGIC tasks (research / decision / review /
// positioning / generate / other) — deliberately separate from the
// Marketing Calendar which holds tactical scheduled posts.
//
// `sourcePriorityItemId` references a priorityItems row but is NOT
// a foreign key — when a matrix is regenerated, its items get
// cascade-deleted (priorityMatrices → priorityItems), and we'd
// rather keep the historical task with an orphaned attribution
// than lose the founder's work. The column documents provenance.
//
// `generatedDraftId` + `linkedScheduledPostId` are connect-back
// pointers for "generate" tasks (filled in once the founder
// actually creates the draft from /marketing/generate).
export const compassTasks = pgTable('compass_tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  taskType: text('task_type').notNull(), // 'research' | 'decision' | 'review' | 'positioning' | 'generate' | 'other'
  scheduledFor: timestamp('scheduled_for').notNull(),
  estimatedMinutes: integer('estimated_minutes'),
  effortLevel: text('effort_level'), // 'low' | 'medium' | 'high'
  status: text('status').default('pending').notNull(), // 'pending' | 'in_progress' | 'done' | 'skipped'
  completedAt: timestamp('completed_at'),
  sourceType: text('source_type'), // 'priority_item' | 'manual'
  sourcePriorityItemId: uuid('source_priority_item_id'), // unenforced ref to priorityItems
  sourceContext: text('source_context'),
  generatedDraftId: uuid('generated_draft_id'),
  linkedScheduledPostId: uuid('linked_scheduled_post_id'),
  suggestedPlatform: text('suggested_platform'),
  suggestedContentType: text('suggested_content_type'),
  suggestedPrompt: text('suggested_prompt'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ===== Compass Priority Matrix (PR #68 — Sprint 7.1B) =====
//
// Strategic moves matrix scored on Impact (0-100) × Effort (0-100),
// quadrant-bucketed. One matrix row per generation; child rows in
// priority_items hold the actual moves with source attribution.
//
// Cached 7 days so Compass dashboard loads are cheap (Opus ~$0.15
// per regen). Founder can force-regenerate via the UI's "Regenerate"
// button.
export const priorityMatrices = pgTable('priority_matrices', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull(),
  sourcesUsed: jsonb('sources_used'), // {brandAnalysisId, benchmarkId, insightsCount, postsCount}
  totalItems: integer('total_items'),
  itemsDoNow: integer('items_do_now'),
  itemsScheduled: integer('items_scheduled'),
  itemsFillers: integer('items_fillers'),
  itemsAvoid: integer('items_avoid'),
  modelUsed: text('model_used').default('claude-opus-4-7'),
  generationCostUsd: numeric('generation_cost_usd', { precision: 10, scale: 4 }),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Each row is one strategic move. `userOverrideQuadrant` lets the
// founder manually re-bucket without re-running Opus. `userStatus`
// is a kanban-lite lifecycle (pending → in_progress → done) so the
// matrix stays useful as work happens.
export const priorityItems = pgTable('priority_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  matrixId: uuid('matrix_id')
    .notNull()
    .references(() => priorityMatrices.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  impactScore: integer('impact_score').notNull(),
  effortScore: integer('effort_score').notNull(),
  quadrant: text('quadrant').notNull(), // 'do_now' | 'scheduled' | 'fillers' | 'avoid'
  sourceType: text('source_type'), // 'pain_point' | 'opportunity' | 'competitor_gap' | 'content_gap'
  sourceContext: text('source_context'),
  suggestedAction: text('suggested_action'),
  suggestedContentType: text('suggested_content_type'),
  suggestedPlatform: text('suggested_platform'),
  userStatus: text('user_status').default('pending').notNull(), // 'pending' | 'in_progress' | 'done' | 'dismissed'
  userOverrideQuadrant: text('user_override_quadrant'),
  reasoning: text('reasoning'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ===== Compass Competitors (PR #67 — Sprint 7.1A) =====
// One row per (project, competitor URL). Detected by Opus 4.7 OR
// added manually by the founder. Confidence threshold C-3:
//   - 85+ auto-approves and queues scrape
//   - 60-84 surfaced to founder for explicit approval
//   - <60 skipped (still stored but never auto-promoted)
//
// Scraped fields land here only after `/api/compass/competitors/
// scrape` succeeds — Haiku 4.5 normalizes the cheerio-parsed HTML
// into the structured columns below. Per-row scrape state lives
// here (status / error / scrapedAt) so retries are observable.
export const competitors = pgTable(
  'competitors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    name: text('name').notNull(),
    url: text('url').notNull(),
    type: text('type'), // 'direct' | 'adjacent' | 'inspirational'
    detectedBy: text('detected_by').default('ai').notNull(), // 'ai' | 'user'
    confidenceScore: integer('confidence_score'),
    approvedByUser: boolean('approved_by_user').default(false).notNull(),
    scrapedAt: timestamp('scraped_at'),
    headline: text('headline'),
    valueProp: text('value_prop'),
    targetAudience: text('target_audience'),
    pricingVisible: jsonb('pricing_visible'),
    platformPresence: jsonb('platform_presence'),
    contentAngles: jsonb('content_angles').$type<string[]>(),
    positioningSummary: text('positioning_summary'),
    whereTheyWin: text('where_they_win'),
    whereTheyLose: text('where_they_lose'),
    scrapeStatus: text('scrape_status').default('pending').notNull(), // 'pending' | 'success' | 'failed'
    scrapeError: text('scrape_error'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    uniqueProjectUrl: unique('competitors_project_url_uk').on(t.projectId, t.url),
  }),
);

// ===== Compass Positioning Benchmarks (PR #67 — Sprint 7.1A) =====
// Generated output of `/api/compass/generate-benchmark`. 14-day TTL
// because the competitive landscape doesn't shift fast enough to
// justify re-running this on every Compass tab load — and Opus is
// expensive ($0.15-0.20 per call). Founder can force a regen via
// the UI's "Regenerate" button.
export const positioningBenchmarks = pgTable('positioning_benchmarks', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull(),
  marketGap: text('market_gap'),
  uniquePositioning: text('unique_positioning'),
  opportunitiesAccionable: jsonb('opportunities_accionable'),
  defensiveWeaknesses: jsonb('defensive_weaknesses'),
  comparisonDimensions: jsonb('comparison_dimensions'),
  competitorsAnalyzed: integer('competitors_analyzed'),
  modelUsed: text('model_used').default('claude-opus-4-7'),
  generationCostUsd: numeric('generation_cost_usd', { precision: 10, scale: 4 }),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ===== LinkedIn Integrations (PR #66 — Sprint 7.0.9) =====
// Per-project LinkedIn OAuth state. Mirrors the per-project shape
// of `metaIntegrations` rather than reusing the user-scoped
// `integrations` table because a founder running Voya + Helm +
// CritMatch may want a distinct LinkedIn persona per brand.
//
// Tokens are AES-256-GCM encrypted via lib/crypto/token-encryption
// (same helper Meta uses). `linkedinUserId` is the URN suffix
// (the `sub` field from OpenID Connect userinfo), so the publisher
// can construct `urn:li:person:<id>` for the share author field.
//
// `scopes` jsonb tells us at runtime whether the connection has
// w_member_social (post-on-behalf) — if a founder connected before
// we asked for that scope, the LinkedIn card surfaces a "reconnect"
// CTA rather than failing at publish time.
export const linkedinIntegrations = pgTable(
  'linkedin_integrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    accessTokenEncrypted: text('access_token_encrypted').notNull(),
    refreshTokenEncrypted: text('refresh_token_encrypted'),
    tokenExpiresAt: timestamp('token_expires_at'),
    linkedinUserId: text('linkedin_user_id').notNull(),
    linkedinName: text('linkedin_name'),
    linkedinHandle: text('linkedin_handle'),
    scopes: jsonb('scopes').$type<string[]>(),
    status: text('status').default('connected').notNull(), // 'connected' | 'expired' | 'disconnected'
    lastError: text('last_error'),
    connectedAt: timestamp('connected_at').defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at'),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    uniqueProject: unique('linkedin_integrations_project_uk').on(t.projectId),
  }),
);

// ===== TikTok Integrations =====
// PR #87 — Sprint 7.11: TikTok "Upload to Inbox" flow.
//
// USER-scoped (not project-scoped) because TikTok accounts are
// personal and a single founder typically has one TikTok handle
// they reuse across all their projects. LinkedIn is the opposite
// pattern (project-scoped) because brands often have a dedicated
// company LinkedIn page per project. If/when we ship TikTok
// Business accounts (multi-brand), this would shift to project-
// scoped — but Upload to Inbox lives on the personal API surface.
//
// We deliberately store BOTH access_token_expires_at and
// refresh_token_expires_at:
//   - access tokens expire in 24h (TikTok rotates aggressively)
//   - refresh tokens expire in 365d
//   - lib/tiktok/client.ts checks both before every call so we
//     never burn an upload trying to use an expired access token
//     OR a dead refresh token (which would require a re-auth).
//
// scope is stored as the canonical comma-separated string
// TikTok returns (same shape as the request) — we don't
// normalize because TikTok's scope membership check is exact.
export const tiktokIntegrations = pgTable(
  'tiktok_integrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    // TikTok's stable user identifier — survives display-name
    // changes and is what publish-status endpoints key off.
    openId: text('open_id').notNull(),
    displayName: text('display_name'),
    avatarUrl: text('avatar_url'),
    // Both tokens stored AES-256-GCM encrypted via
    // lib/crypto/token-encryption.ts. Never returned to the
    // client.
    accessTokenEncrypted: text('access_token_encrypted').notNull(),
    refreshTokenEncrypted: text('refresh_token_encrypted').notNull(),
    accessTokenExpiresAt: timestamp('access_token_expires_at').notNull(),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at').notNull(),
    scope: text('scope'),
    status: text('status').default('connected').notNull(), // 'connected' | 'expired' | 'disconnected' | 'failed'
    lastError: text('last_error'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    uniqueUser: unique('tiktok_integrations_user_uk').on(t.userId),
  }),
);

// ===== TikTok Publish Jobs =====
// PR #87 — Sprint 7.11: one row per "Send to TikTok inbox" attempt.
//
// scheduled_posts.id → publish_id mapping. We persist publish_id
// because TikTok's status endpoint needs it to report progress,
// and a single scheduled_post could be retried (the latest job
// row wins for status display).
//
// status mirrors TikTok's lifecycle states:
//   PROCESSING_UPLOAD      → in-flight on TikTok side
//   SEND_TO_USER_INBOX     → terminal success, ready in user's
//                            drafts inbox
//   PUBLISH_COMPLETE       → user has published from TikTok
//                            (we don't poll for this — terminal)
//   FAILED                 → TikTok refused or errored
//
// We don't FK scheduled_post_id because some flows (manual
// retry, debugging) may want to upload a video without a
// scheduled_posts row backing it. Soft ref via nullable column.
export const tiktokPublishJobs = pgTable('tiktok_publish_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  scheduledPostId: uuid('scheduled_post_id'),
  heygenJobId: uuid('heygen_job_id'),
  // TikTok's publish identifier — what we POST to /status/fetch/
  publishId: text('publish_id').notNull(),
  status: text('status').notNull().default('PROCESSING_UPLOAD'),
  // Snapshot of the video URL we asked TikTok to PULL_FROM_URL.
  // Useful for debugging when a job fails 12 hours later.
  sourceVideoUrl: text('source_video_url'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
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

// PR #76 — Sprint 7.3: HeyGen video generation queue.
//
// CRITICAL: this table is ONLY the queue ledger. We do NOT call
// the HeyGen API in this sprint — no key, no integration. The
// generate-structured endpoint inserts a row with status='queued'
// when the founder asks for a Reel or UGC, and the placeholder
// /api/heygen/generate-video endpoint refuses with feature_disabled
// until HEYGEN_ENABLED=true is set + a real key lands.
//
// The plan originally suggested FK to a `drafts` table — that
// doesn't exist. Drafts live in `generated_posts` (structured
// drafts have contentType + structuredContent jsonb, legacy drafts
// have a plain `content` string). The FK below points there.
//
// When HeyGen ships, the worker reads queued rows for users that
// have the feature flag on, calls HeyGen, polls for completion,
// and writes videoUrl + thumbnailUrl + duration back. The
// errorKind column matches the categorized-error vocabulary from
// PR #72 / #75 so the same UI can surface the failure reason.
export const heygenJobs = pgTable('heygen_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Soft ref to the draft this video belongs to. Cascade-delete:
  // if the founder deletes the draft, the job is meaningless.
  draftId: uuid('draft_id')
    .notNull()
    .references(() => generatedPosts.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull(),
  userId: uuid('user_id').notNull(),

  // 'queued' | 'processing' | 'completed' | 'failed'
  status: text('status').notNull().default('queued'),

  // Input — what we'd send to HeyGen when the worker fires.
  scriptText: text('script_text').notNull(),
  avatarId: text('avatar_id'),
  voiceId: text('voice_id'),

  // Output — populated by the worker on success.
  videoUrl: text('video_url'),
  thumbnailUrl: text('thumbnail_url'),
  durationSeconds: integer('duration_seconds'),

  // HeyGen's own job id (their async API returns one, we poll
  // with it until the video is ready).
  heygenJobId: text('heygen_job_id'),
  heygenStatus: text('heygen_status'),

  // Error tracking. errorKind uses the same vocabulary as
  // lib/ai/categorize-error.ts (overloaded/rate_limit/timeout/etc.)
  // even though HeyGen and Anthropic have different failure modes —
  // the UI rendering layer is shared.
  errorMessage: text('error_message'),
  errorKind: text('error_kind'),

  // PR Sprint 7.25 Phase 11.5 — retry counter consumed by the
  // /api/cron/heygen-worker. Incremented every time the helper
  // calls HeyGen for this row. The worker stops promoting
  // failed→queued once attemptCount >= MAX_HEYGEN_ATTEMPTS so a
  // hard upstream failure can't burn unlimited budget. Migration
  // lives in scripts/add-heygen-attempt-count.ts.
  attemptCount: integer('attempt_count').notNull().default(0),

  requestedAt: timestamp('requested_at').defaultNow().notNull(),
  processedAt: timestamp('processed_at'),
  completedAt: timestamp('completed_at'),
});

// PR #74 — Sprint 7.2B: 5-step onboarding wizard state.
//
// IMPORTANT: this table is ADDITIVE — it does NOT replace the
// existing `users.hasCompletedOnboarding / onboardingStep /
// onboardingCompletedAt` columns, which the old overlay-style
// OnboardingWizard (components/onboarding/wizard.tsx) still
// reads/writes via /api/onboarding/progress.
//
// The new wizard updates BOTH sources of truth:
//   - users.onboardingStep ← integer per the legacy contract
//     (0=not started, 1-4=in flight, 99=completed/skipped). The
//     dashboard layout already keys off `< 99` for the overlay
//     wizard, so flipping to 99 on first-content completion makes
//     the legacy overlay disappear for users who finished the new
//     wizard.
//   - onboarding_progress.{step}At ← granular timestamps for
//     funnel analytics (which steps users skip, how long each
//     takes). Lives on this table so users.* stays minimal.
//
// brandAnswers captures the onboarding inputs verbatim
// ({ niche, audience, tone, oneLiner }) so downstream flows can
// rehydrate the founder's original phrasing even after we merge
// them into the canonical BrandBible shape.
export const onboardingProgress = pgTable('onboarding_progress', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().unique(),

  // 'welcome' | 'project' | 'brand' | 'research' | 'first-content'
  // | 'completed'
  currentStep: text('current_step').default('welcome').notNull(),

  // Per-step completion timestamps. Column names match the wizard
  // step keys (with hyphen → camelCase: first-content → firstContent)
  // so the API can map step→column safely.
  welcomeAt: timestamp('welcome_at'),
  projectAt: timestamp('project_at'),
  brandAt: timestamp('brand_at'),
  researchAt: timestamp('research_at'),
  firstContentAt: timestamp('first_content_at'),
  completedAt: timestamp('completed_at'),

  // The project the founder created/picked during step 2. Soft
  // ref — if the project is deleted later, we keep the history
  // pointer null-ish rather than cascading the row away.
  primaryProjectId: uuid('primary_project_id'),
  firstDraftId: uuid('first_draft_id'),

  // Array of step keys the founder explicitly skipped (e.g.
  // ['brand', 'research']). Lets us nudge them later to fill
  // gaps without retraining the whole flow.
  skippedSteps: jsonb('skipped_steps').$type<string[]>().default([]),

  // Verbatim wizard answers — { niche?, audience?, tone?, oneLiner? }.
  // Captured here even when also merged into projects.brandContext
  // so the founder's original phrasing survives BrandBible edits.
  brandAnswers: jsonb('brand_answers'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// PR #72 — Sprint 7.2A hotfix: idempotency tracker for the
// /api/research/analyze-brand POST. The original endpoint kicked off
// Opus on every call — a re-click during the 30s window, a
// double-tap, or a tab reopened mid-flight all produced parallel
// Opus calls (billed, and prone to race writes on brand_analysis).
//
// This table is NOT the analysis cache — that's brand_analysis with
// its 30-day TTL. This is the running-job ledger: one row per
// active Opus pass, status flips to completed/failed/timeout when
// the call returns or stalls. The endpoint reads "is there a
// running job for (project, force)?" before paying Opus, and skips
// to a 409 response with the existing jobId when there is.
//
// Why per-project not per-user: a founder with two projects might
// legitimately analyze both in parallel — only same-project
// in-flight requests should collide.
//
// A "stale" job (still running but startedAt > 5 min ago) is
// treated as dead — Vercel maxDuration caps at 90s, so anything
// older than that is a crashed/abandoned run. The endpoint marks
// stale jobs as failed and proceeds.
export const brandAnalysisJobs = pgTable('brand_analysis_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull(),
  // 'running' | 'completed' | 'failed' | 'timeout'
  status: text('status').notNull().default('running'),
  // 'overloaded' | 'timeout' | 'json' | 'rate_limit' | 'unknown' —
  // set when status='failed' so the UI can show a categorized error.
  errorKind: text('error_kind'),
  errorMessage: text('error_message'),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
});

// PR #71 — Sprint 7.1E: Decision Log. Founders make big strategic
// moves and forget WHY 30 days later. This table captures pre-
// decision alignment scoring vs the brand North Star (so we don't
// rationalize after the fact) + outcome tracking + retrospective.
//
// Two passes through Opus:
//   1. /score — pre-commit alignment + reversibility + pattern match
//      against prior decisions. NOT persisted — the founder gets the
//      score and decides whether to commit.
//   2. /evaluate — after 30+ days, founder marks worked/didn't and
//      Opus generates an honest retro (was the original score
//      accurate? did execution fail or scoring fail?).
//
// The `aiRetrospective` jsonb captures the post-hoc Opus output so
// the UI can render "scoring accuracy" as a learning signal over
// time.
//
// Why not snapshot the inputs (like compass_blind_spots)? Decisions
// are usually about a specific moment that's already documented in
// the description + reasoning. The North Star is reloaded fresh on
// evaluate so retrospective uses current strategy, not stale state.
export const compassDecisions = pgTable('compass_decisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull(),

  // Decision content
  title: text('title').notNull(),
  description: text('description'),
  // 'product' | 'pricing' | 'positioning' | 'audience' | 'platform' | 'content' | 'other'
  category: text('category'),

  // Pre-decision alignment (filled by /score)
  alignmentScore: integer('alignment_score'), // 0-100 vs North Star
  alignmentReasoning: text('alignment_reasoning'),

  // Bezos two-way doors. 'easy' | 'medium' | 'hard' | 'irreversible'
  reversibility: text('reversibility'),
  reversalCostNotes: text('reversal_cost_notes'),

  // Self-reported founder confidence 0-100 — separate from AI score
  founderConfidence: integer('founder_confidence'),

  // 'decided' | 'executing' | 'reversed' | 'evaluated'
  status: text('status').default('decided').notNull(),
  decidedAt: timestamp('decided_at').notNull(),
  evaluatedAt: timestamp('evaluated_at'),

  // Outcome (filled by /evaluate)
  outcomeWorked: boolean('outcome_worked'),
  outcomeNotes: text('outcome_notes'),
  lessonsLearned: text('lessons_learned'),

  // AI retrospective: {alignmentRecheck, observedSignals,
  // patternInsight, scoringAccuracy}
  aiRetrospective: jsonb('ai_retrospective'),

  // Linked items (optional — soft refs, no FK so a deleted priority
  // item or task doesn't cascade the decision history away)
  linkedPriorityItemId: uuid('linked_priority_item_id'),
  linkedTimelineTaskId: uuid('linked_timeline_task_id'),

  modelUsed: text('model_used').default('claude-opus-4-7'),
  generationCostUsd: numeric('generation_cost_usd', {
    precision: 10,
    scale: 4,
  }),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ===== Adaptive Voice Engine =====
// PR Sprint 7.16 — Helm Adaptive Voice Engine MVP Phase 1.
//
// Faithful port of the Python data model in
// Helm SEO/helm-adaptive-voice-engine/. Architectural decisions
// preserved verbatim:
//
//   - Per-platform isolation: what works on TikTok doesn't bleed
//     into LinkedIn. Encoded by storing `platforms` as a map<
//     Platform, PlatformSlots> inside a single JSONB column —
//     same shape as the Pydantic ClientContext.platforms field.
//
//   - One context row per project (NOT per user). The brief said
//     "stored per client_id" — in Helm's data model the closest
//     equivalent is the project. A founder with multiple projects
//     gets isolated learning per project, which matches the
//     existing Brand Bible + Voice Fingerprint scoping.
//
//   - JSONB-heavy schema. Everything except the audit log is a
//     JSONB blob. The Pydantic model does `.model_dump_json()` /
//     `.model_validate_json()` for persistence; mirroring that in
//     Postgres keeps the port 1:1 and removes a class of migrate-
//     when-the-model-grows problems. Audit log is normalized
//     because operators query it (the only read pattern the
//     brief calls out explicitly).
//
//   - Reserved slots present even when unused in MVP. The brief
//     is explicit: cross_platform_voice, anti_samples,
//     performance_proxies are stored from day one so adding
//     Phase 1.5 features doesn't require migration.
export const clientContexts = pgTable(
  'client_contexts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // One context per project, enforced by the unique constraint.
    // If a founder ever switches a project to a different
    // brand-bible direction, rollback_override + a manual reset
    // is the path; a fresh project is the cleaner reset.
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    // BrandBible mirror — denormalized from projects.brandContext
    // at first-context-creation time, then maintained alongside
    // the platform-specific slots. This is the field the prompt
    // builder formats into the dynamic context block.
    brandBible: jsonb('brand_bible').notNull(),
    // Per-platform PlatformSlots map. Shape:
    //   { instagram: { voiceFingerprint: [...], winningPatterns: [...],
    //                  losingPatterns: [...], learnedOverrides: {...},
    //                  performanceProxies: [...], postCount: 0,
    //                  lastUpdatePostIndex: {...} }, ... }
    platforms: jsonb('platforms').default({}).notNull(),
    // Reserved for Phase 1.5+ (cross-platform voice fingerprint).
    crossPlatformVoice: jsonb('cross_platform_voice').default([]).notNull(),
    // Anti-samples tagged per dimension. dim → WeightedPost[].
    antiSamples: jsonb('anti_samples').default({}).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    uniqueProject: unique('client_contexts_project_uk').on(t.projectId),
  }),
);

// Audit log for the Adaptive Voice Engine. Normalized (not JSONB
// blob) because the only read pattern the brief specifies is
// operator debugging: filter by (action, dimension, time range).
// That query is awful against JSONB and fine against a real
// table with indexes.
export const voiceEngineAuditLog = pgTable('voice_engine_audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientContextId: uuid('client_context_id')
    .notNull()
    .references(() => clientContexts.id, { onDelete: 'cascade' }),
  // userId denormalized so an operator can grep by user without
  // joining through client_contexts. Same defense-in-depth
  // pattern used on most other Helm tables.
  userId: uuid('user_id').notNull(),
  // 'override_updated' | 'override_rolled_back' |
  // 'tiered_feedback_recorded' | 'context_initialized'
  action: text('action').notNull(),
  platform: text('platform'),
  dimension: text('dimension'),
  previousValue: jsonb('previous_value'),
  newValue: jsonb('new_value'),
  triggeringSignals: jsonb('triggering_signals'),
  operatorId: text('operator_id'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ===== Chat Conversations & Messages =====
// PR Sprint 7.19 — Helm Chat System (AI + Agent).
//
// REPLACES the Sprint 7.15 chat_messages table. The old shape
// (one flat row per message keyed only by userId) couldn't
// express "this conversation is currently in agent mode" or
// "the admin replied at 14:32" — both required for the
// AI/Agent toggle the founder requested. The migration script
// drops the old table + recreates the new schema.
//
// Lifecycle:
//   1. User opens the widget → POST /api/chat/conversation
//      returns the active conversation (or creates one).
//   2. User sends → /api/chat/message routes by mode:
//      ai     → Claude Haiku replies inline
//      agent  → message queued; Supabase Realtime ships the
//               admin's reply when one lands.
//   3. User toggles mode → PATCH /mode flips the column.
//
// One ACTIVE conversation per (user, project). Closing one is
// effectively "start a new thread" — we don't delete history.

export const chatConversations = pgTable(
  'chat_conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Optional — onboarding-stage founders may not have a
    // project yet. Same defensive nullability as Sprint 7.15.
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),
    // 'ai' = Claude responds; 'agent' = founder/admin responds
    // manually via /admin/inbox. Default 'ai' so first-touch
    // chats get an immediate reply.
    mode: text('mode').notNull().default('ai'),
    // 'active' | 'closed'. Only one active per (user, project).
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
);

export const chatMessages = pgTable('chat_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id')
    .notNull()
    .references(() => chatConversations.id, { onDelete: 'cascade' }),
  // 'user' (founder typing) | 'assistant' (Claude reply) |
  // 'agent' (Helm admin reply). Three distinct roles so the
  // widget can badge agent messages differently from AI.
  role: text('role').notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ===== Daily Metric Snapshots (Round 3a) =====
// PR Sprint 7.19 Round 3a — daily time-series storage that
// underpins the analytics insight engine.
//
// Why daily snapshots vs computing on read:
//   - Anomaly detection needs a 30-day baseline. Computing
//     COUNT(*) ranges on every dashboard load doesn't scale.
//   - The numbers from "X days ago" must be stable across
//     re-renders so the Claude insight generator sees the same
//     data the user saw.
//   - Cheap to keep — one row per (project, day, metric) tuple
//     stays well under 100k rows for a year of activity.
//
// Lifecycle:
//   1. cron at 03:00 UTC writes one row per metric per project
//      for "yesterday" (the just-closed day).
//   2. backfill script populates trailing 30 days once at first
//      install, so anomaly detection has something to compare.
//   3. insight generator queries the rolling window and writes
//      its conclusions to a separate `metric_insights` table
//      (Round 3b).
export const metricDailySnapshots = pgTable(
  'metric_daily_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Soft ref (no FK). Historical data outlives the project so
    // archive doesn't wipe insights.
    projectId: uuid('project_id').notNull(),
    snapshotDate: date('snapshot_date').notNull(),
    // Stable string identifier — see scripts/hotfix-...sql for
    // the canonical list. Round 3b reads this column.
    metricKey: text('metric_key').notNull(),
    // NUMERIC in pg → string in postgres-js by default; the
    // cron writer + insight reader normalize via Number().
    value: numeric('value').notNull(),
    // Optional slicing dimensions (platform, content_type).
    dimensions: jsonb('dimensions'),
    dimensionsHash: text('dimensions_hash'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    // Cron upsert key — matches the SQL unique index.
    uniqIdx: uniqueIndex('metric_daily_snapshots_uniq_idx').on(
      t.projectId,
      t.snapshotDate,
      t.metricKey,
      t.dimensionsHash,
    ),
  }),
);

// PR Sprint 7.20 — analytics insights cache.
//
// /api/analytics/insights calls Claude Haiku to summarize the
// founder's weekly metrics. Pre-cache, the call ran on every
// dashboard render (~9.5s wall-clock), so a tab-flip to
// /analytics rebuilt the insight from scratch every time. We
// cache by (userId, projectIdsHash) with a 24h TTL — long enough
// to stop burning calls on repeated visits, short enough that
// the insight reflects new daily snapshots within a day.
//
// Why (userId, hash) and not (userId, projectId): the insights
// endpoint aggregates across ALL the founder's projects, so the
// cache key has to encode the full set. We sort the IDs and
// hash them (sha256 → hex slice) so adding/removing projects
// invalidates the cache automatically.
//
// `insights` stores the rendered array [{type, text}, ...]
// verbatim — same shape the endpoint returns. No re-derivation
// on hit.
export const analyticsInsightsCache = pgTable(
  'analytics_insights_cache',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    // Hex digest of sha256(sortedProjectIds.join(',')). Stable
    // across reorderings; changes when the project set changes.
    projectsHash: text('projects_hash').notNull(),
    insights: jsonb('insights').notNull(),
    generatedAt: timestamp('generated_at').defaultNow().notNull(),
    expiresAt: timestamp('expires_at').notNull(),
  },
  (t) => ({
    // Upsert key — one cache row per (user, project set).
    uniqIdx: uniqueIndex('analytics_insights_cache_uniq_idx').on(
      t.userId,
      t.projectsHash,
    ),
  }),
);

// ===== Type exports =====
export type User = typeof users.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type MetricDailySnapshot = typeof metricDailySnapshots.$inferSelect;
export type NewMetricDailySnapshot = typeof metricDailySnapshots.$inferInsert;
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
export type LinkedinIntegration = typeof linkedinIntegrations.$inferSelect;
export type Competitor = typeof competitors.$inferSelect;
export type PositioningBenchmark = typeof positioningBenchmarks.$inferSelect;
export type PriorityMatrix = typeof priorityMatrices.$inferSelect;
export type PriorityItem = typeof priorityItems.$inferSelect;
export type CompassTask = typeof compassTasks.$inferSelect;
export type CompassBlindSpot = typeof compassBlindSpots.$inferSelect;
export type CompassDecision = typeof compassDecisions.$inferSelect;
export type BrandAnalysisJob = typeof brandAnalysisJobs.$inferSelect;
export type OnboardingProgressRow = typeof onboardingProgress.$inferSelect;
export type HeygenJob = typeof heygenJobs.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type ChatConversation = typeof chatConversations.$inferSelect;
export type ClientContextRow = typeof clientContexts.$inferSelect;
export type VoiceEngineAuditEntry = typeof voiceEngineAuditLog.$inferSelect;
export type AnalyticsInsightsCacheRow =
  typeof analyticsInsightsCache.$inferSelect;
export type NewAnalyticsInsightsCacheRow =
  typeof analyticsInsightsCache.$inferInsert;

// ===== User Integration Opt-Outs =====
// PR Sprint B-finish — per-user soft disconnect for integrations
// that use deploy-wide credentials (X / Twitter currently — its
// OAuth 1.0a creds live in env vars at the deploy level, not per
// user). Founders need a Disconnect button for consistency with
// Vercel / Supabase / LinkedIn (each of which DOES have per-user
// tokens we can drop from `integrations`), but we can't actually
// drop env vars on their behalf.
//
// The compromise: this table records that user X has chosen to
// not have Helm publish to X on their behalf. The publish
// dispatcher (lib/meta/publisher.ts) and the integration's
// status check (/api/integrations/x/test) both consult it before
// reporting "connected" / firing API calls. Reconnecting deletes
// the row.
//
// Unique on (userId, provider) so re-disconnect is idempotent
// and reconnect is unambiguous.
export const userIntegrationOptOuts = pgTable(
  'user_integration_opt_outs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // 'x' currently; more providers can be added as Helm gains
    // deploy-wide integrations. NOT a FK — providers are a
    // string vocabulary, not a table.
    provider: text('provider').notNull(),
    optedOutAt: timestamp('opted_out_at').defaultNow().notNull(),
  },
  (t) => ({
    uniqueUserProvider: unique().on(t.userId, t.provider),
  }),
);

export type UserIntegrationOptOutRow =
  typeof userIntegrationOptOuts.$inferSelect;
export type NewUserIntegrationOptOutRow =
  typeof userIntegrationOptOuts.$inferInsert;

// ===== HeyGen Agent Sessions =====
// PR Sprint D-2 — interactive Studio sessions backed by HeyGen
// V3 Video Agent.
//
// Each row is one chat-mode session: founder prompts the agent,
// agent drafts storyboard, founder iterates via messages, then
// approves → renders → final video. We mirror enough state
// locally that the /marketing/studio UI never has to round-trip
// to HeyGen on every page load (saves quota + keeps the list view
// fast).
//
// Lifecycle mirrors HeyGen's `status`:
//   thinking → reviewing → generating → completed (or failed)
//
// We poll the session on a 5s tick while it's "live" (anything
// before completed/failed). Messages + the `lastResources` jsonb
// are refreshed on every poll so the founder sees agent
// follow-ups + new storyboard renders without a manual refresh.
//
// finalVideoId joins back to the final-video poll endpoint
// (/v3/videos/{id}); when set + status='completed' we have a
// playable URL the founder can publish or save into the library.
export const heygenAgentSessions = pgTable('heygen_agent_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  // HeyGen's session_id (their primary key). Unique per row so
  // re-creating a session for the same project + prompt always
  // gets a new local row — no accidental cross-talk.
  heygenSessionId: text('heygen_session_id').notNull(),
  status: text('status').notNull().default('thinking'),
  // Founder's original prompt. Stored verbatim for re-use ("clone
  // this session" affordance) and for the Library card preview.
  prompt: text('prompt').notNull(),
  // Agent-chosen title (after a few seconds of "thinking" HeyGen
  // names the session). Falls back to prompt slice for the UI.
  title: text('title'),
  // Optional overrides the founder set at create time. Nullable —
  // when null, the agent picked autonomously.
  styleId: text('style_id'),
  avatarId: text('avatar_id'),
  voiceId: text('voice_id'),
  orientation: text('orientation'), // 'landscape' | 'portrait' | null
  // Latest snapshot of messages from HeyGen. Refreshed on every
  // poll. Truncated to the most recent ~40 entries server-side
  // (HeyGen caps this too).
  messages: jsonb('messages').$type<unknown[]>(),
  // Resource refs (storyboard PNGs, draft video URLs, picked
  // avatar / voice metadata). Cached so the UI can render
  // thumbnails without re-fetching each resource_id.
  lastResources: jsonb('last_resources').$type<unknown[]>(),
  // Once the storyboard is approved + render starts, HeyGen
  // assigns a video_id. We poll /v3/videos/{video_id} from here
  // until status='completed' / 'failed'.
  finalVideoId: text('final_video_id'),
  finalVideoUrl: text('final_video_url'),
  finalVideoThumbnailUrl: text('final_video_thumbnail_url'),
  finalVideoCaptionedUrl: text('final_video_captioned_url'),
  finalVideoSubtitleUrl: text('final_video_subtitle_url'),
  finalVideoDurationSec: numeric('final_video_duration_sec', {
    precision: 7,
    scale: 2,
  }),
  errorMessage: text('error_message'),
  // PR Sprint D-bugs (UGC fix) — server-side approval gate.
  //
  // HeyGen V3's Video Agent is auto-pilot in chat mode: even with
  // mode='chat' set, the agent fires a chain of messages
  // (storyboard → review → render) without pausing for our input.
  // The "Take a look at the blueprint and let me know" message is
  // followed by 'generating' status within ~5 seconds — well
  // before a human can read + decide.
  //
  // We add a Helm-side gate: when the GET poll detects the agent
  // is at an approval checkpoint, we set this flag + override the
  // serialized status to 'reviewing' until the founder explicitly
  // approves or sends feedback. The actual HeyGen state continues
  // to update locally (so the eventual render is captured), but
  // we don't surface it to the client until the founder acts.
  //
  // This is a UI-layer lock, not a HeyGen-side stop. We don't
  // claim to save HeyGen quota — the render likely happens
  // anyway. We DO claim to give the founder the explicit-approval
  // workflow they expect from chat mode.
  approvalGateActive: boolean('approval_gate_active')
    .notNull()
    .default(false),
  approvalGateAt: timestamp('approval_gate_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
});

export type HeygenAgentSessionRow =
  typeof heygenAgentSessions.$inferSelect;
export type NewHeygenAgentSessionRow =
  typeof heygenAgentSessions.$inferInsert;

// ===== HeyGen Lipsync Jobs =====
// PR Sprint D-4 — script-edit re-rendering via HeyGen V3 lipsync.
//
// When a founder wants to tweak a UGC's spoken text without
// re-rendering the entire avatar pass (5-10x cheaper, 2-3x
// faster), we:
//   1. TTS the new script via /v3/voices/speech using the
//      project's current voice_id.
//   2. Pass the original video URL + the new audio URL to
//      /v3/lipsyncs.
//   3. Poll until completion, then replace the visible video
//      on the Library card.
//
// Mode 'speed' is default — Avatar IV's diffusion path runs
// cheaper at this mode and the quality is good enough for UGC.
// 'precision' is available for high-stakes content.
//
// We keep the original heygen_jobs row intact + spawn this
// lipsync row alongside it (sourceJobId FK). Lets the founder
// see both the original render + the re-render in version
// history, and we don't lose the original Avatar IV cost if
// the lipsync fails.
export const heygenLipsyncJobs = pgTable('heygen_lipsync_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  // The original heygen_jobs render whose audio is being
  // replaced. Cascade-delete: the lipsync is meaningless without
  // the source video.
  sourceJobId: uuid('source_job_id')
    .notNull()
    .references(() => heygenJobs.id, { onDelete: 'cascade' }),
  // HeyGen's lipsync_id, returned from POST /v3/lipsyncs.
  heygenLipsyncId: text('heygen_lipsync_id').notNull(),
  // Mode: 'speed' (default) or 'precision'.
  mode: text('mode').notNull().default('speed'),
  // Edited script the founder submitted; we TTS this and
  // hand the resulting audio URL to HeyGen's lipsync.
  editedScript: text('edited_script').notNull(),
  // 'pending' | 'processing' | 'completed' | 'failed'
  status: text('status').notNull().default('pending'),
  // URL of the resulting re-rendered video. Same shape as
  // heygen_jobs.videoUrl so the library leftJoin can swap
  // them in if we ever want lipsyncs to BECOME the asset's
  // canonical render.
  resultVideoUrl: text('result_video_url'),
  resultCaptionUrl: text('result_caption_url'),
  durationSec: numeric('duration_sec', { precision: 7, scale: 2 }),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
});

export type HeygenLipsyncJobRow = typeof heygenLipsyncJobs.$inferSelect;
export type NewHeygenLipsyncJobRow =
  typeof heygenLipsyncJobs.$inferInsert;

// ===== HeyGen Translation Jobs =====
// PR Sprint D-5 — multi-language UGC video distribution via
// HeyGen V3 video translation.
//
// A single founder-driven translation request creates one row
// PER target language. HeyGen returns one translation_id per
// language; we poll each independently. When status='completed',
// resultVideoUrl is the dubbed + lip-synced video in that
// language — the founder can download it, share it, or
// (future) schedule it as a new generated_post for a locale-
// specific platform.
//
// Translation is voice-cloned: HeyGen clones the source video's
// voice into the target language, then re-renders lipsync. The
// avatar appears to speak the new language naturally. The same
// row therefore captures both the audio dub + the visual
// re-render in one artifact.
export const heygenTranslationJobs = pgTable('heygen_translation_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  // The original heygen_jobs render whose audio + visual is
  // being translated. Cascade-delete: a translation is
  // meaningless without the source.
  sourceJobId: uuid('source_job_id')
    .notNull()
    .references(() => heygenJobs.id, { onDelete: 'cascade' }),
  // HeyGen's video_translation_id.
  heygenTranslationId: text('heygen_translation_id').notNull(),
  // Target language NAME (HeyGen's vocabulary), e.g.
  // 'Spanish (Spain)', 'Portuguese (Brazil)'.
  targetLanguage: text('target_language').notNull(),
  mode: text('mode').notNull().default('speed'),
  status: text('status').notNull().default('pending'),
  resultVideoUrl: text('result_video_url'),
  resultCaptionUrl: text('result_caption_url'),
  durationSec: numeric('duration_sec', { precision: 7, scale: 2 }),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
});

export type HeygenTranslationJobRow =
  typeof heygenTranslationJobs.$inferSelect;
export type NewHeygenTranslationJobRow =
  typeof heygenTranslationJobs.$inferInsert;

// ===== Photo Studio agent sessions =====
// PR Sprint D-8 Phase 2 — chat-agent paradigm for photo / carousel
// creation.
//
// Mirrors heygen_agent_sessions in spirit but built entirely in-
// house (no external chat-mode API to delegate to). The agent
// uses Haiku for intent classification + concept refinement, Opus
// for per-platform copy generation. Visual generation goes
// through the existing lib/visuals/generate.ts pipeline (we pass
// `concept` as `postContent`; the IR prompt-builder owns the
// actual Flux prompt).
//
// CRITICAL design rule: the state machine NEVER auto-advances
// from an awaiting_* state. Each transition requires explicit
// user input — text, a quick-action button, or an Approve click.
// Same lesson learned the hard way from the HeyGen V3 chat-mode
// auto_proceed bug (Sprint D-7 fix 84b709d).
export const photoAgentSessions = pgTable('photo_agent_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  // Founder's original brief, stored verbatim for re-use ("clone
  // session" affordance) + session list previews.
  prompt: text('prompt').notNull(),
  // Optional pain-point seed if the session was started from a
  // Research → Photo Studio handoff. Stored as text (not FK)
  // because pain points live in jsonb today — see Sprint D-8
  // Phase 1 / migrate to a real table later.
  painPointId: text('pain_point_id'),
  // Brand bible snapshot at session start. Locked for the
  // lifetime of the session so mid-session brand edits don't
  // alter what the agent is producing (founder expectation: "this
  // session uses the brand voice I had when I opened it").
  brandSnapshot: jsonb('brand_snapshot'),
  // State machine. See lib/photo-agent/stateMachine.ts for the
  // full enum + valid transitions.
  //   understanding | awaiting_type_choice | generating_visual |
  //   awaiting_visual_feedback | awaiting_platform_choice |
  //   generating_copies | awaiting_copy_feedback | finalized |
  //   failed
  state: text('state').notNull().default('understanding'),
  // Asset type the founder picked: 'photo' | 'carousel' | 'upload'.
  assetType: text('asset_type'),
  // If assetType='upload', the URL of the user-uploaded reference
  // image (Supabase Storage). fal.ai uses this as a reference.
  uploadedAssetUrl: text('uploaded_asset_url'),
  // The visual concept the agent + founder converged on. Passed
  // to generateVisual() as postContent. Updated each time the
  // founder asks for visual changes.
  concept: text('concept'),
  // Generated visual result.
  visualUrl: text('visual_url'),
  visualWidth: integer('visual_width'),
  visualHeight: integer('visual_height'),
  // Platforms the founder confirmed for distribution. Stored as
  // text array because the platform vocab evolves and we don't
  // want a hard enum constraint.
  platforms: jsonb('platforms').$type<string[]>(),
  // Per-platform generated copies. Shape mirrors what the
  // copyGenerator returns; the Library save translates it into
  // content_assets + generated_posts rows.
  copies: jsonb('copies').$type<
    Array<{
      platform: string;
      text: string;
      hashtags: string[];
      ctaText: string | null;
    }>
  >(),
  // Full chat thread for this session. Truncated client-side for
  // display but stored verbatim so we can replay / debug.
  messages: jsonb('messages').$type<
    Array<{
      role: 'user' | 'agent';
      content: string;
      kind: 'text' | 'system' | 'visual' | 'platforms' | 'copies';
      createdAt: number;
    }>
  >(),
  // Linked content_asset id once the founder approves & saves.
  // ON DELETE SET NULL so deleting the library entry doesn't
  // cascade-delete the session history.
  contentAssetId: uuid('content_asset_id').references(
    () => contentAssets.id,
    { onDelete: 'set null' },
  ),
  errorMessage: text('error_message'),
  // PR Sprint UGC+Photo paridad — approval-gate parity with the
  // UGC Studio. Engaged when the agent has converged on a concept
  // it considers ready to render; the founder reviews the concept
  // (in chat) and explicitly approves before fal.ai burns a Flux
  // render. Mirror of heygen_agent_sessions.approval_gate_*.
  approvalGateActive: boolean('approval_gate_active')
    .notNull()
    .default(false),
  approvalGateAt: timestamp('approval_gate_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
});

export type PhotoAgentSessionRow = typeof photoAgentSessions.$inferSelect;
export type NewPhotoAgentSessionRow =
  typeof photoAgentSessions.$inferInsert;
