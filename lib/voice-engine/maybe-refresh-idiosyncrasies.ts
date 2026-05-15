// PR Sprint 7.22 Sprint E.2 — voice idiosyncrasies cache refresh.
//
// Run-on-request helper that decides whether the cached
// VoiceIdiosyncrasies for a (project, platform) is fresh enough to
// use as-is, stale and needing a background refresh, or missing
// entirely (in which case we extract synchronously the first time).
//
// Data source: scheduled_posts.content WHERE status='posted' for
// the project + platform, ordered newest-first. The extractor caps
// at 30 posts and trims outliers internally.
//
// Caching: lives at brandContext.voiceIdiosyncrasies[platform].
// 7-day staleness window — after that we re-extract to capture
// voice drift (founder changing tone over time).
//
// Three states per call:
//   - cached + fresh → return cached as-is, no work
//   - cached + stale → return cached, kick off background refresh
//   - missing       → run extraction synchronously, save, return
//
// The synchronous-on-cold-start path adds ~100-500ms to the first
// generation request after a project hits the 10-post threshold.
// Subsequent requests are cached so it's a one-time cost.

import { db } from '@/lib/db';
import { projects, scheduledPosts } from '@/lib/db/schema';
import type {
  BrandBible,
  VoiceIdiosyncrasies,
} from '@/lib/types/brand';
import { and, desc, eq } from 'drizzle-orm';
import {
  MIN_POSTS_FOR_EXTRACTION,
  extractVoiceIdiosyncrasies,
  isIdiosyncrasiesStale,
} from './voice-idiosyncrasy-extractor';
import { logAudit } from './loader';
import type { Platform as VoiceEnginePlatform } from './types';

const FETCH_LIMIT = 30;

/**
 * Return the active VoiceIdiosyncrasies for a (project, platform),
 * refreshing the cache when stale or missing.
 *
 * Returns null when there aren't enough posts to extract reliably
 * (the project has shipped < 10 posts on this platform).
 *
 * Errors are swallowed and logged — voice profile is a nice-to-have
 * enhancement, not a blocker. A failed fetch returns whatever was
 * cached (or null if nothing was cached).
 */
export async function getOrRefreshIdiosyncrasies(args: {
  projectId: string;
  userId: string;
  platform: string;
  bible: BrandBible | null;
}): Promise<VoiceIdiosyncrasies | null> {
  const { projectId, userId, platform, bible } = args;
  const cached = bible?.voiceIdiosyncrasies?.[platform] ?? null;

  // Fresh cache → use as-is, no DB touch.
  if (cached && !isIdiosyncrasiesStale(cached)) {
    return cached;
  }

  // Stale cache → return immediately; kick off background refresh.
  if (cached && isIdiosyncrasiesStale(cached)) {
    void refreshAndPersist({ projectId, userId, platform, bible }).catch(
      (err: unknown) => {
        console.warn(
          '[voice-idiosyncrasies] background refresh failed:',
          err instanceof Error ? err.message : err,
        );
      },
    );
    return cached;
  }

  // Cold: nothing cached yet. Extract synchronously so the very
  // first generation after the 10-post threshold gets the voice
  // profile injected without a one-request delay.
  try {
    return await refreshAndPersist({ projectId, userId, platform, bible });
  } catch (err) {
    console.warn(
      '[voice-idiosyncrasies] synchronous extraction failed (non-fatal):',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

async function refreshAndPersist(args: {
  projectId: string;
  userId: string;
  platform: string;
  bible: BrandBible | null;
}): Promise<VoiceIdiosyncrasies | null> {
  const { projectId, userId, platform, bible } = args;

  const rows = await db
    .select({ content: scheduledPosts.content })
    .from(scheduledPosts)
    .where(
      and(
        eq(scheduledPosts.projectId, projectId),
        eq(scheduledPosts.platform, platform),
        eq(scheduledPosts.status, 'posted'),
      ),
    )
    .orderBy(desc(scheduledPosts.postedAt))
    .limit(FETCH_LIMIT);

  if (rows.length < MIN_POSTS_FOR_EXTRACTION) {
    // Not enough material to extract reliably. Don't clobber the
    // cached entry (if any) — the next request will retry.
    return bible?.voiceIdiosyncrasies?.[platform] ?? null;
  }

  const idio = extractVoiceIdiosyncrasies(
    rows
      .filter((r): r is { content: string } => typeof r.content === 'string')
      .map((r) => ({ text: r.content })),
  );
  if (!idio) {
    return bible?.voiceIdiosyncrasies?.[platform] ?? null;
  }

  // Persist back to brandContext.voiceIdiosyncrasies[platform].
  // We re-read brandContext before merging to avoid clobbering a
  // concurrent write — the JSON merge approach can race with
  // recentArchetypes / painToProductBridges updates, so we always
  // read-modify-write the fresh row.
  try {
    const [latest] = await db
      .select({ brandContext: projects.brandContext })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    const fresh = (latest?.brandContext as BrandBible | null) ?? bible;
    if (!fresh) return idio;

    const nextBible: BrandBible = {
      ...fresh,
      voiceIdiosyncrasies: {
        ...(fresh.voiceIdiosyncrasies ?? {}),
        [platform]: idio,
      },
    };
    await db
      .update(projects)
      .set({ brandContext: nextBible })
      .where(eq(projects.id, projectId));

    void logAudit({
      userId,
      projectId,
      action: 'voice_idiosyncrasies_extracted',
      platform: platform as VoiceEnginePlatform,
      notes: `sample_size=${idio.sampleSize}`,
    }).catch(() => {
      /* non-fatal */
    });
  } catch (err) {
    console.warn(
      '[voice-idiosyncrasies] persist failed (returning fresh idio anyway):',
      err instanceof Error ? err.message : err,
    );
  }

  return idio;
}
