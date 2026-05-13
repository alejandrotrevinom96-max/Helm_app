// PR Sprint 7.16 — Feedback loop service port.
//
// 1:1 translation of
// Helm SEO/helm-adaptive-voice-engine/feedback_loop_service.py.
// Takes a ClientContext + a batch of Signals, applies maturity-
// stage gating, cool-down enforcement, magnitude caps; writes
// AuditEntry records via lib/voice-engine/loader.ts.
//
// MVP scope mirrors the Python source:
//   - Per-dimension threshold gating
//   - Cool-down enforcement
//   - Magnitude caps (numeric overrides only)
//   - Audit log on every state change
//   - Manual rollback
//   - Tiered feedback weighting
//
// Deferred to Phase 1.5+ (slots present, logic stubbed):
//   - Circuit breaker
//   - Auto-rollback on regression
//   - Stale override decay
//   - Shadow mode
//   - Performance reweighting of winning/losing patterns

import {
  DIMENSION_VOLATILITY,
  FEEDBACK_TIER_WEIGHTS,
  MAGNITUDE_CAP_MULTIPLIER,
  MATURITY_STAGE_CONFIG,
  getPlatformSlots,
  maturityStageFor,
  newAuditEntry,
  type AuditEntry,
  type ClientContext,
  type Dimension,
  type FeedbackTier,
  type MagnitudeCap,
  type Override,
  type Platform,
  type PlatformSlots,
  type Signal,
  type AllowedDimensions,
} from './types';

// ============================================================
// processSignals — main entry point. Mutates ctx in place,
// returns the same instance + the list of audit entries
// generated so the caller can persist them.
// ============================================================

export interface ProcessSignalsResult {
  ctx: ClientContext;
  auditEntries: AuditEntry[];
}

export function processSignals(
  ctx: ClientContext,
  signals: Signal[],
  operatorId: string | null = null,
): ProcessSignalsResult {
  const auditEntries: AuditEntry[] = [];
  if (signals.length === 0) {
    return { ctx, auditEntries };
  }

  // Group by (platform, dimension) so all signals affecting the
  // same override get aggregated in one pass.
  // Stash (platform, dimension) on the bucket alongside the
  // array. Avoids round-tripping through a string-split key —
  // dimensions like banned_vocab contain underscores, so any
  // delimiter we picked could collide with real data.
  const grouped = new Map<
    string,
    { platform: Platform; dimension: Dimension; signals: Signal[] }
  >();
  for (const s of signals) {
    const key = `${s.platform}::${s.dimension}`;
    const bucket = grouped.get(key);
    if (bucket) bucket.signals.push(s);
    else
      grouped.set(key, {
        platform: s.platform,
        dimension: s.dimension,
        signals: [s],
      });
  }

  for (const {
    platform,
    dimension,
    signals: dimSignals,
  } of grouped.values()) {
    const slots = getPlatformSlots(ctx, platform);
    const stage = maturityStageFor(slots);
    const config = MATURITY_STAGE_CONFIG[stage];

    // Gate 1: stage allows this dimension.
    if (!isDimensionAllowed(dimension, config.allowedDimensions)) {
      continue;
    }
    // Gate 2: cool-down expired.
    if (inCoolDown(slots, dimension, config.coolDownPosts)) {
      continue;
    }
    // Gate 3: enough weighted signal volume.
    const weightedCount = dimSignals.reduce(
      (sum, s) => sum + s.weight * s.confidence,
      0,
    );
    if (weightedCount < config.minSignalsForUpdate) {
      continue;
    }

    // Derive the new value from the aggregated signals.
    const previousOverride = slots.learnedOverrides[dimension] ?? null;
    const previousValue = previousOverride ? previousOverride.value : null;
    const newValue = deriveOverrideValue(
      dimension,
      dimSignals,
      previousOverride,
    );
    if (newValue === null || newValue === undefined) continue;

    // Magnitude cap (no-op for non-numeric dimensions).
    const cappedValue = applyMagnitudeCap(
      previousValue,
      newValue,
      config.magnitudeCap,
    );

    const nowIso = new Date().toISOString();
    const newOverride: Override = {
      dimension,
      platform,
      value: cappedValue,
      volatility: DIMENSION_VOLATILITY[dimension] ?? 'medium',
      confidence: Math.min(1.0, weightedCount / 10.0),
      sampleCount:
        (previousOverride ? previousOverride.sampleCount : 0) +
        dimSignals.length,
      lastValidated: nowIso,
      lastUpdated: nowIso,
      sourceSignalIds: dimSignals.map((s) => s.id),
    };

    slots.learnedOverrides[dimension] = newOverride;
    slots.lastUpdatePostIndex[dimension] = slots.postCount;

    auditEntries.push(
      newAuditEntry({
        action: 'override_updated',
        platform,
        dimension,
        previousValue,
        newValue: cappedValue,
        triggeringSignals: dimSignals.map((s) => s.id),
        operatorId,
        notes:
          `stage=${stage} signals=${dimSignals.length} ` +
          `weighted=${weightedCount.toFixed(2)} cap=${config.magnitudeCap}`,
      }),
    );
  }

  ctx.updatedAt = new Date().toISOString();
  return { ctx, auditEntries };
}

// ============================================================
// Manual operator rollback. Removes the current override and
// emits an audit entry. Used when an operator notices an
// override producing bad output and wants to revert without
// waiting for the auto-rollback infra (Phase 2+).
// ============================================================

export interface RollbackResult {
  ctx: ClientContext;
  auditEntry: AuditEntry;
}

export function rollbackOverride(opts: {
  ctx: ClientContext;
  platform: Platform;
  dimension: Dimension;
  operatorId: string;
  reason?: string | null;
}): RollbackResult {
  const slots = getPlatformSlots(opts.ctx, opts.platform);
  const previous = slots.learnedOverrides[opts.dimension] ?? null;
  if (previous) {
    delete slots.learnedOverrides[opts.dimension];
  }
  const auditEntry = newAuditEntry({
    action: 'override_rolled_back',
    platform: opts.platform,
    dimension: opts.dimension,
    previousValue: previous ? previous.value : null,
    newValue: null,
    operatorId: opts.operatorId,
    notes: opts.reason ?? null,
  });
  opts.ctx.updatedAt = new Date().toISOString();
  return { ctx: opts.ctx, auditEntry };
}

// ============================================================
// Tiered feedback. Returns the weight that should be applied
// to any signals derived from this post.
// ============================================================

export interface TieredFeedbackResult {
  weight: number;
  auditEntry: AuditEntry;
}

export function recordTieredFeedback(opts: {
  platform: Platform;
  postId: string;
  tier: FeedbackTier;
}): TieredFeedbackResult {
  const weight = FEEDBACK_TIER_WEIGHTS[opts.tier];
  const auditEntry = newAuditEntry({
    action: 'tiered_feedback_recorded',
    platform: opts.platform,
    notes: `post_id=${opts.postId} tier=${opts.tier} weight=${weight}`,
  });
  return { weight, auditEntry };
}

// ============================================================
// incrementPostCount — drives maturity stage. Caller must invoke
// exactly once per published post.
// ============================================================

export function incrementPostCount(
  ctx: ClientContext,
  platform: Platform,
): void {
  const slots = getPlatformSlots(ctx, platform);
  slots.postCount += 1;
  ctx.updatedAt = new Date().toISOString();
}

// ============================================================
// Internal helpers
// ============================================================

function isDimensionAllowed(
  dimension: Dimension,
  allowed: AllowedDimensions,
): boolean {
  if (allowed === 'all' || allowed === 'all_individual') return true;
  return (allowed as readonly Dimension[]).includes(dimension);
}

function inCoolDown(
  slots: PlatformSlots,
  dimension: Dimension,
  coolDownPosts: number,
): boolean {
  const lastUpdate = slots.lastUpdatePostIndex[dimension];
  if (lastUpdate === undefined) return false;
  return slots.postCount - lastUpdate < coolDownPosts;
}

function deriveOverrideValue(
  dimension: Dimension,
  signals: Signal[],
  current: Override | null,
): unknown | null {
  // Banned vocab: union the removed words/phrases (set behavior).
  if (dimension === 'banned_vocab') {
    const existing = new Set<string>();
    if (current && Array.isArray(current.value)) {
      for (const item of current.value as unknown[]) {
        if (typeof item === 'string') existing.add(item);
      }
    }
    for (const s of signals) {
      const word = s.valueDelta.removed_word;
      const phrase = s.valueDelta.removed_phrase;
      if (typeof word === 'string') existing.add(word);
      if (typeof phrase === 'string') existing.add(phrase);
    }
    return Array.from(existing).sort();
  }

  // Hook length: weighted average of edited_hook_words.
  if (dimension === 'hook_length') {
    return weightedAverageInt(signals, 'edited_hook_words');
  }

  // CTA style: majority vote on preferred_style.
  if (dimension === 'cta_style') {
    let questionVotes = 0;
    let statementVotes = 0;
    for (const s of signals) {
      const style = s.valueDelta.preferred_style;
      if (style === 'question') questionVotes += s.weight;
      else if (style === 'statement') statementVotes += s.weight;
    }
    return questionVotes > statementVotes ? 'question' : 'statement';
  }

  if (dimension === 'emoji_usage') {
    return weightedAverageInt(signals, 'edited_emoji_count');
  }

  if (dimension === 'hashtag_strategy') {
    return weightedAverageInt(signals, 'edited_hashtag_count');
  }

  if (dimension === 'paragraph_length') {
    return weightedAverageFloat(signals, 'edited_avg_words');
  }

  // mandatory_signals / sentence_cadence / tone_intensity have
  // no aggregator in MVP. Phase 1.5 will wire them up.
  return null;
}

function weightedAverageInt(
  signals: Signal[],
  key: string,
): number | null {
  let totalWeight = 0;
  let weightedSum = 0;
  for (const s of signals) {
    const v = s.valueDelta[key];
    if (typeof v !== 'number') continue;
    totalWeight += s.weight;
    weightedSum += v * s.weight;
  }
  if (totalWeight === 0) return null;
  return Math.round(weightedSum / totalWeight);
}

function weightedAverageFloat(
  signals: Signal[],
  key: string,
): number | null {
  let totalWeight = 0;
  let weightedSum = 0;
  for (const s of signals) {
    const v = s.valueDelta[key];
    if (typeof v !== 'number') continue;
    totalWeight += s.weight;
    weightedSum += v * s.weight;
  }
  if (totalWeight === 0) return null;
  return Math.round((weightedSum / totalWeight) * 10) / 10;
}

function applyMagnitudeCap(
  previousValue: unknown,
  newValue: unknown,
  capLabel: MagnitudeCap,
): unknown {
  const multiplier = MAGNITUDE_CAP_MULTIPLIER[capLabel] ?? 0.2;
  if (
    typeof previousValue !== 'number' ||
    typeof newValue !== 'number'
  ) {
    // Non-numeric: cap is inherent to the type (sets, enums).
    return newValue;
  }
  if (previousValue === 0) return newValue; // No baseline.
  const maxDelta = Math.abs(previousValue) * multiplier;
  const actualDelta = newValue - previousValue;
  if (Math.abs(actualDelta) <= maxDelta) return newValue;
  const direction = actualDelta > 0 ? 1 : -1;
  const capped = previousValue + maxDelta * direction;
  // Preserve int-ness when the inputs were ints.
  if (Number.isInteger(previousValue) && Number.isInteger(newValue)) {
    return Math.round(capped);
  }
  return Math.round(capped * 10) / 10;
}
