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
} from 'drizzle-orm/pg-core';

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
    // Brand context (for the marketing tab)
    brandUrl: text('brand_url'),
    brandContext: jsonb('brand_context').$type<{
      voice?: string;
      tone?: string[];
      audience?: string;
      keyPhrases?: string[];
      productFocus?: string;
      extractedAt?: string;
    }>(),
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
  platform: text('platform').notNull(), // 'instagram' | 'facebook' | 'linkedin' | 'threads'
  content: text('content').notNull(),
  prompt: text('prompt'), // What the user asked for
  status: text('status').notNull().default('draft'), // 'draft' | 'copied' | 'published'
  createdAt: timestamp('created_at').defaultNow().notNull(),
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
  config: jsonb('config').$type<{
    primaryColor?: string;
    showCount?: boolean;
    [key: string]: unknown;
  }>(),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
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

// ===== Helm waitlist =====
// People signing up to the Helm landing page itself
export const helmWaitlist = pgTable('helm_waitlist', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  source: text('source'), // 'reddit', 'twitter', 'direct', etc
  createdAt: timestamp('created_at').defaultNow().notNull(),
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
});

// ===== Type exports =====
export type User = typeof users.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Integration = typeof integrations.$inferSelect;
export type MetricSnapshot = typeof metricSnapshots.$inferSelect;
export type GeneratedPost = typeof generatedPosts.$inferSelect;
export type ResearchFinding = typeof researchFindings.$inferSelect;
export type WaitlistPage = typeof waitlistPages.$inferSelect;
export type ScheduledPost = typeof scheduledPosts.$inferSelect;
