// PR #35 — Sprint 6.3: persistent usage logging for cached endpoints.
//
// Every cached call should pipe its usage object through trackUsage()
// so we can:
//   - Watch the cache hit rate trend per endpoint over time.
//   - Estimate monthly cost from real telemetry instead of guessing.
//   - Detect regressions (a code change that breaks the cache prefix
//     drops cache_read_input_tokens to zero — easy to spot).
//
// Failures are non-fatal: we never want a logging blip to break a
// user-facing AI call. A console.error is enough.
import { db } from '@/lib/db';
import { anthropicUsageLog } from '@/lib/db/schema';
import { MODEL_PRICING_PER_MTOK, readCacheStats } from './claude';
import type Anthropic from '@anthropic-ai/sdk';

interface TrackArgs {
  endpoint: string;
  model: string;
  usage: Anthropic.Usage | undefined;
  userId?: string | null;
  projectId?: string | null;
}

// Cost per call. Based on the snapshotted pricing in claude.ts —
// public preview endpoint uses this same fn so we can audit costs
// of anonymous usage too.
function estimateCostUsd(model: string, usage: Anthropic.Usage | undefined): number {
  const stats = readCacheStats(usage);
  const pricing =
    MODEL_PRICING_PER_MTOK[model] ?? MODEL_PRICING_PER_MTOK['claude-haiku-4-5-20251001'];
  const perMillion =
    stats.regularInput * pricing.input +
    stats.output * pricing.output +
    stats.cacheWrite * pricing.cacheWrite +
    stats.cacheRead * pricing.cacheRead;
  return perMillion / 1_000_000;
}

export async function trackUsage(args: TrackArgs): Promise<void> {
  const stats = readCacheStats(args.usage);
  if (
    stats.regularInput === 0 &&
    stats.output === 0 &&
    stats.cacheRead === 0 &&
    stats.cacheWrite === 0
  ) {
    // Nothing to log — this is the path where the SDK returned no
    // usage (rare; usually means the request errored before usage
    // was populated).
    return;
  }
  try {
    const cost = estimateCostUsd(args.model, args.usage);
    await db.insert(anthropicUsageLog).values({
      userId: args.userId ?? null,
      projectId: args.projectId ?? null,
      endpoint: args.endpoint,
      model: args.model,
      inputTokens: stats.regularInput,
      outputTokens: stats.output,
      cacheReadTokens: stats.cacheRead,
      cacheWriteTokens: stats.cacheWrite,
      // numeric() expects a string in drizzle.
      estimatedCostUsd: cost.toFixed(6),
    });
  } catch (e) {
    // Telemetry must never break the user-facing call.
    console.error(
      `[usage-tracker] insert failed for ${args.endpoint}:`,
      e instanceof Error ? e.message : e
    );
  }
}
