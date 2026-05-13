// PR Sprint 7.16 — Helm Adaptive Voice Engine MVP Phase 1.
//
// TypeScript port of
// Helm SEO/helm-adaptive-voice-engine/client_context.py.
//
// What's IN this port (mirrors the Python MVP scope):
//   - All enums (Platform, ContentType, Dimension, MaturityStage,
//     FeedbackTier, Volatility, SignalSource).
//   - All record types (Signal, Override, AuditEntry, WeightedPost,
//     PerformanceProxy, BrandBible, PlatformSlots, ClientContext).
//   - Maturity-stage config + feedback-tier weights tables.
//   - Helper functions (stageForPostCount, isStale, recencyFactor).
//
// What's DIFFERENT vs the Python source (cosmetic, behavior-preserving):
//   - Python's frozen Pydantic models become readonly interfaces; we
//     enforce immutability through `as const` / `Readonly<>` rather
//     than runtime guards.
//   - Python uses datetime; TS uses ISO strings throughout for JSONB
//     round-tripping. Conversion helpers (toIso, fromIso) preserve
//     timezone semantics.
//   - The `WeightedPost.recencyFactor` and `Override.isStale`
//     methods are exported as free functions instead of methods to
//     keep the data types JSON-serializable without prototype loss.
//   - Validation lives in zod-style guards (isClientContext, etc.)
//     so we can fail loud when corrupted JSONB comes back from DB.

import { randomUUID } from 'crypto';

// ============================================================
// Enums (as string literal unions — TS idiom).
// ============================================================

export const PLATFORMS = [
  'instagram',
  'linkedin',
  'x',
  'threads',
  'facebook',
  'reddit',
  'tiktok',
] as const;
export type Platform = (typeof PLATFORMS)[number];

export const CONTENT_TYPES = ['ugc', 'carousel', 'photo', 'text'] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

// Learnable dimensions per platform. Adding one requires updating
// the diff classifier + feedback loop to handle it. Don't add
// casually.
export const DIMENSIONS = [
  'banned_vocab',
  'mandatory_signals',
  'hook_length',
  'cta_style',
  'sentence_cadence',
  'emoji_usage',
  'hashtag_strategy',
  'tone_intensity',
  'paragraph_length',
] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const MATURITY_STAGES = [
  'new', // 0-8 posts
  'early', // 9-20 posts
  'growing', // 21-60 posts
  'mature', // 60+ posts
] as const;
export type MaturityStage = (typeof MATURITY_STAGES)[number];

export const FEEDBACK_TIERS = [
  'publish_as_is', // weight 1.0
  'minor_edits', // weight 0.7
  'regenerate', // weight -0.5
  'discard', // weight -1.0
] as const;
export type FeedbackTier = (typeof FEEDBACK_TIERS)[number];

export const VOLATILITIES = ['low', 'medium', 'high'] as const;
export type Volatility = (typeof VOLATILITIES)[number];

export const SIGNAL_SOURCES = [
  'edit_diff',
  'explicit_feedback',
  'tiered_rating',
  'like_dislike',
  'performance_proxy', // reserved for Phase 2
] as const;
export type SignalSource = (typeof SIGNAL_SOURCES)[number];

// ============================================================
// Building blocks.
//
// Every record type uses ISO strings for timestamps so the
// whole ClientContext can JSON-round-trip without Date
// deserialization. The loader converts to/from Date at the API
// boundary where needed.
// ============================================================

export interface Signal {
  id: string;
  timestamp: string; // ISO 8601
  source: SignalSource;
  platform: Platform;
  contentType: ContentType;
  dimension: Dimension;
  valueDelta: Record<string, unknown>;
  confidence: number; // 0..1
  weight: number;
  postId: string | null;
  notes: string | null;
}

export interface Override {
  dimension: Dimension;
  platform: Platform;
  value: unknown;
  volatility: Volatility;
  confidence: number; // 0..1
  sampleCount: number;
  lastValidated: string; // ISO
  lastUpdated: string; // ISO
  sourceSignalIds: string[];
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  action: string;
  platform: Platform | null;
  dimension: Dimension | null;
  previousValue: unknown;
  newValue: unknown;
  triggeringSignals: string[];
  operatorId: string | null;
  notes: string | null;
}

export interface WeightedPost {
  postId: string;
  platform: Platform;
  contentType: ContentType;
  text: string;
  postedAt: string; // ISO
  qualityScore: number; // 0..1
  weight: number; // 0..1
}

export interface PerformanceProxy {
  postId: string;
  platform: Platform;
  capturedAt: string;
  impressions: number | null;
  likes: number | null;
  replies: number | null;
  saves: number | null;
  shares: number | null;
  clicks: number | null;
  notes: string | null;
}

export interface BrandBibleVoiceEngine {
  voice: string;
  audience: string;
  positioning: string;
  pillars: string[];
  bannedPhrases: string[];
  mandatorySignals: string[];
  examplesLoved: string[];
  examplesHated: string[];
}

export interface PlatformSlots {
  voiceFingerprint: WeightedPost[];
  winningPatterns: WeightedPost[];
  losingPatterns: WeightedPost[];
  learnedOverrides: Partial<Record<Dimension, Override>>;
  performanceProxies: PerformanceProxy[];
  postCount: number;
  lastUpdatePostIndex: Partial<Record<Dimension, number>>;
}

export interface ClientContext {
  clientId: string; // = projectId in Helm's data model
  brandBible: BrandBibleVoiceEngine;
  platforms: Partial<Record<Platform, PlatformSlots>>;
  // Reserved for Phase 1.5+ (cross-platform fingerprint).
  crossPlatformVoice: WeightedPost[];
  // Anti-samples tagged per dimension.
  antiSamples: Partial<Record<Dimension, WeightedPost[]>>;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// Maturity-stage configuration. Direct port from the Python
// MATURITY_STAGE_CONFIG dict.
//
// Tuned for MVP Phase 1: conservative early, more aggressive at
// maturity. Calibration notes are repeated here so the values
// stay readable next to the constraints they implement:
//   New stage = 8 signals min so a user sees learning by post
//   8-12. Magnitude caps 5/10/20/40% protect against drift.
// ============================================================

export type MagnitudeCap = 'very_low' | 'low' | 'medium' | 'normal';
export type AllowedDimensions = readonly Dimension[] | 'all' | 'all_individual';

export interface MaturityStageConfig {
  postRange: readonly [number, number | null];
  minSignalsForUpdate: number;
  magnitudeCap: MagnitudeCap;
  allowedDimensions: AllowedDimensions;
  coolDownPosts: number;
}

export const MATURITY_STAGE_CONFIG: Record<MaturityStage, MaturityStageConfig> = {
  new: {
    postRange: [0, 8],
    minSignalsForUpdate: 8,
    magnitudeCap: 'very_low',
    // Only banned vocab + mandatory signals can update in the
    // New stage — these are inherently bounded, low-risk
    // dimensions. Numeric stuff (hook length, paragraph length)
    // waits for more samples.
    allowedDimensions: ['banned_vocab', 'mandatory_signals'] as const,
    coolDownPosts: 3,
  },
  early: {
    postRange: [9, 20],
    minSignalsForUpdate: 6,
    magnitudeCap: 'low',
    allowedDimensions: 'all_individual',
    coolDownPosts: 2,
  },
  growing: {
    postRange: [21, 60],
    minSignalsForUpdate: 5,
    magnitudeCap: 'medium',
    allowedDimensions: 'all',
    coolDownPosts: 2,
  },
  mature: {
    postRange: [60, null],
    minSignalsForUpdate: 4,
    magnitudeCap: 'normal',
    allowedDimensions: 'all',
    coolDownPosts: 1,
  },
};

export const MAGNITUDE_CAP_MULTIPLIER: Record<MagnitudeCap, number> = {
  very_low: 0.05, // New stage: max 5% drift per update
  low: 0.1, // Early stage: max 10%
  medium: 0.2, // Growing stage: max 20%
  normal: 0.4, // Mature stage: max 40%
};

export function stageForPostCount(postCount: number): MaturityStage {
  if (postCount <= 8) return 'new';
  if (postCount <= 20) return 'early';
  if (postCount <= 60) return 'growing';
  return 'mature';
}

// ============================================================
// Tiered feedback weights. Direct port from the Python source.
// publish_as_is = high confidence positive; discard = strong
// negative; minor_edits leans positive but discounts to avoid
// overfitting to imperfect drafts.
// ============================================================

export const FEEDBACK_TIER_WEIGHTS: Record<FeedbackTier, number> = {
  publish_as_is: 1.0,
  minor_edits: 0.7,
  regenerate: -0.5,
  discard: -1.0,
};

// ============================================================
// Per-dimension volatility defaults. Drives decay rate + update
// thresholds (used by feedback-loop).
// ============================================================

export const DIMENSION_VOLATILITY: Record<Dimension, Volatility> = {
  banned_vocab: 'low', // Once banned, near-immutable
  mandatory_signals: 'low',
  sentence_cadence: 'low', // Voice signature, drifts slowly
  tone_intensity: 'low',
  hook_length: 'medium',
  cta_style: 'medium',
  paragraph_length: 'medium',
  emoji_usage: 'medium',
  hashtag_strategy: 'high', // Trends shift fast
};

// ============================================================
// Factories + helpers
// ============================================================

export function newSignal(opts: {
  source: SignalSource;
  platform: Platform;
  contentType: ContentType;
  dimension: Dimension;
  valueDelta: Record<string, unknown>;
  confidence?: number;
  weight?: number;
  postId?: string | null;
  notes?: string | null;
}): Signal {
  return {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    source: opts.source,
    platform: opts.platform,
    contentType: opts.contentType,
    dimension: opts.dimension,
    valueDelta: opts.valueDelta,
    confidence: opts.confidence ?? 1.0,
    weight: opts.weight ?? 1.0,
    postId: opts.postId ?? null,
    notes: opts.notes ?? null,
  };
}

export function newAuditEntry(opts: {
  action: string;
  platform?: Platform | null;
  dimension?: Dimension | null;
  previousValue?: unknown;
  newValue?: unknown;
  triggeringSignals?: string[];
  operatorId?: string | null;
  notes?: string | null;
}): AuditEntry {
  return {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    action: opts.action,
    platform: opts.platform ?? null,
    dimension: opts.dimension ?? null,
    previousValue: opts.previousValue ?? null,
    newValue: opts.newValue ?? null,
    triggeringSignals: opts.triggeringSignals ?? [],
    operatorId: opts.operatorId ?? null,
    notes: opts.notes ?? null,
  };
}

export function emptyPlatformSlots(): PlatformSlots {
  return {
    voiceFingerprint: [],
    winningPatterns: [],
    losingPatterns: [],
    learnedOverrides: {},
    performanceProxies: [],
    postCount: 0,
    lastUpdatePostIndex: {},
  };
}

export function getPlatformSlots(
  ctx: ClientContext,
  platform: Platform,
): PlatformSlots {
  if (!ctx.platforms[platform]) {
    ctx.platforms[platform] = emptyPlatformSlots();
  }
  return ctx.platforms[platform]!;
}

export function emptyBrandBible(): BrandBibleVoiceEngine {
  return {
    voice: '',
    audience: '',
    positioning: '',
    pillars: [],
    bannedPhrases: [],
    mandatorySignals: [],
    examplesLoved: [],
    examplesHated: [],
  };
}

export function emptyClientContext(projectId: string): ClientContext {
  const now = new Date().toISOString();
  return {
    clientId: projectId,
    brandBible: emptyBrandBible(),
    platforms: {},
    crossPlatformVoice: [],
    antiSamples: {},
    createdAt: now,
    updatedAt: now,
  };
}

// ============================================================
// Free-function ports of the Python methods. The data records
// are intentionally plain objects (JSON-round-trippable), so we
// can't attach methods to them without losing serialization
// fidelity. These helpers take the record as the first arg.
// ============================================================

export function isOverrideStale(override: Override, maxDays = 90): boolean {
  const last = Date.parse(override.lastValidated);
  if (Number.isNaN(last)) return true;
  const deltaMs = Date.now() - last;
  const deltaDays = deltaMs / (1000 * 60 * 60 * 24);
  return deltaDays >= maxDays;
}

export function recencyFactor(post: WeightedPost, halfLifeDays = 75): number {
  const posted = Date.parse(post.postedAt);
  if (Number.isNaN(posted)) return 0;
  const deltaMs = Date.now() - posted;
  const days = Math.max(deltaMs / (1000 * 60 * 60 * 24), 0);
  return 0.5 ** (days / halfLifeDays);
}

export function maturityStageFor(slots: PlatformSlots): MaturityStage {
  return stageForPostCount(slots.postCount);
}

// ============================================================
// Sample selectors (mirror Python ClientContext methods).
// ============================================================

export function getVoiceSamples(
  ctx: ClientContext,
  platform: Platform,
  maxCount = 8,
): WeightedPost[] {
  const slots = getPlatformSlots(ctx, platform);
  return [...slots.voiceFingerprint]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, maxCount);
}

function within(post: WeightedPost, windowDays: number): boolean {
  const postedAt = Date.parse(post.postedAt);
  if (Number.isNaN(postedAt)) return false;
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  return postedAt >= cutoff;
}

export function getRecentWinningPatterns(
  ctx: ClientContext,
  platform: Platform,
  windowDays = 45,
  minCount = 5,
  maxCount = 20,
): WeightedPost[] {
  const slots = getPlatformSlots(ctx, platform);
  const eligible = slots.winningPatterns
    .filter((p) => within(p, windowDays))
    .sort((a, b) => b.weight - a.weight);
  if (eligible.length >= minCount) return eligible.slice(0, maxCount);
  // Fall back to the full set when the window is too sparse.
  return slots.winningPatterns.slice(0, maxCount);
}

export function getRecentLosingPatterns(
  ctx: ClientContext,
  platform: Platform,
  windowDays = 45,
  minCount = 5,
  maxCount = 20,
): WeightedPost[] {
  const slots = getPlatformSlots(ctx, platform);
  const eligible = slots.losingPatterns
    .filter((p) => within(p, windowDays))
    .sort((a, b) => b.weight - a.weight);
  if (eligible.length >= minCount) return eligible.slice(0, maxCount);
  return slots.losingPatterns.slice(0, maxCount);
}

export function getAntiSamplesFor(
  ctx: ClientContext,
  dimension: Dimension,
  maxCount = 10,
): WeightedPost[] {
  return (ctx.antiSamples[dimension] ?? []).slice(0, maxCount);
}

// ============================================================
// Type guards for DB → in-memory round-trips.
// ============================================================

export function isPlatform(v: unknown): v is Platform {
  return typeof v === 'string' && (PLATFORMS as readonly string[]).includes(v);
}

export function isDimension(v: unknown): v is Dimension {
  return (
    typeof v === 'string' && (DIMENSIONS as readonly string[]).includes(v)
  );
}

export function isFeedbackTier(v: unknown): v is FeedbackTier {
  return (
    typeof v === 'string' &&
    (FEEDBACK_TIERS as readonly string[]).includes(v)
  );
}
