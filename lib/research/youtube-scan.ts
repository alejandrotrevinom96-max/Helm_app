// PR Sprint B-finish-2 — per-project YouTube channel scanner.
//
// Mirrors the Reddit-RSS pattern (scan-rss): iterate every
// connected YouTube channel for the project, fetch recent
// videos + top comments, and insert each as a research_findings
// row that the downstream pain-point extractor can score.
//
// We deliberately leave matchScore null (same convention as
// Reddit RSS) — scoring every YouTube video at scan time would
// burn ~$0.005 per video × N videos × M channels every run.
// The Haiku pain-point extractor runs lazily over the joined
// research_findings + brand context and is the cheapest single
// place to apply intelligence.
//
// Cache: we use the same 24h staleness model as Reddit (via
// project_sources.lastScannedAt + the daily cron). The
// playlistItems API itself has a small Google-side cache so
// re-fetching within seconds is fine; we still gate on
// lastScannedAt to avoid burning the Postgres write budget.

import { db } from '@/lib/db';
import {
  projectSources,
  sourceDirectory,
  researchFindings,
} from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import {
  buildFindingSnippet,
  buildVideoUrl,
  fetchPlaylistItems,
  fetchVideoTopComments,
  getChannelUploadsPlaylistId,
  isYouTubeConfigured,
} from '@/lib/integrations/youtube';

// Per-channel limits. videos/channel: 10 keeps the per-scan
// research_findings volume sane (10 channels × 10 videos = 100
// rows worst case per project per day). comments/video: 5
// captures the top engagement signal without flooding the
// snippet column with noise.
const MAX_VIDEOS_PER_CHANNEL = 10;
const MAX_COMMENTS_PER_VIDEO = 5;

export interface YouTubeScanChannelResult {
  channelId: string;
  displayName: string;
  status: 'success' | 'no_videos' | 'channel_not_found' | 'error';
  videosFetched: number;
  newFindings: number;
  error?: string;
}

export interface YouTubeScanResult {
  configured: boolean;
  channelsScanned: number;
  findingsAdded: number;
  channels: YouTubeScanChannelResult[];
  hint?: string;
}

/**
 * Scan every connected YouTube channel for the given project.
 * Idempotent at the (projectId, video URL) level via the same
 * dedup-by-externalId pattern Reddit RSS uses.
 */
export async function scanProjectYouTube(
  projectId: string,
): Promise<YouTubeScanResult> {
  if (!isYouTubeConfigured()) {
    return {
      configured: false,
      channelsScanned: 0,
      findingsAdded: 0,
      channels: [],
      hint:
        'YouTube scanning skipped: YOUTUBE_API_KEY not configured. ' +
        'Set it in Vercel env vars to enable channel-based findings.',
    };
  }

  // Pull every project_sources row that points at a
  // platform='youtube' source_directory entry. Same join shape
  // scan-rss uses for Reddit so the bookkeeping columns
  // (lastScannedAt + scanCount + findingsCount) stay maintained.
  const connected = await db
    .select({
      psId: projectSources.id,
      psScanCount: projectSources.scanCount,
      psFindingsCount: projectSources.findingsCount,
      sourceId: sourceDirectory.id,
      channelId: sourceDirectory.identifier,
      displayName: sourceDirectory.displayName,
    })
    .from(projectSources)
    .innerJoin(
      sourceDirectory,
      eq(projectSources.sourceId, sourceDirectory.id),
    )
    .where(
      and(
        eq(projectSources.projectId, projectId),
        eq(projectSources.status, 'connected'),
        eq(sourceDirectory.platform, 'youtube'),
      ),
    );

  if (connected.length === 0) {
    return {
      configured: true,
      channelsScanned: 0,
      findingsAdded: 0,
      channels: [],
      hint:
        'No YouTube channels connected for this project. ' +
        'Run Discovery + connect channels in /research/sources first.',
    };
  }

  const channels: YouTubeScanChannelResult[] = [];
  let totalFindingsAdded = 0;

  for (const row of connected) {
    // Step 1 — resolve the channel's uploads playlist. 1 quota
    // unit per channel; could be cached on source_directory in
    // a follow-up but the cost is bounded by the channel count.
    const playlistId = await getChannelUploadsPlaylistId(row.channelId);
    if (!playlistId) {
      channels.push({
        channelId: row.channelId,
        displayName: row.displayName,
        status: 'channel_not_found',
        videosFetched: 0,
        newFindings: 0,
      });
      // Still bump scanCount so we know we tried — same as the
      // Reddit RSS "no_posts" case.
      await db
        .update(projectSources)
        .set({
          lastScannedAt: new Date(),
          scanCount: (row.psScanCount ?? 0) + 1,
        })
        .where(eq(projectSources.id, row.psId));
      continue;
    }

    // Step 2 — pull recent videos.
    const videos = await fetchPlaylistItems(
      playlistId,
      MAX_VIDEOS_PER_CHANNEL,
    );
    if (videos.length === 0) {
      channels.push({
        channelId: row.channelId,
        displayName: row.displayName,
        status: 'no_videos',
        videosFetched: 0,
        newFindings: 0,
      });
      await db
        .update(projectSources)
        .set({
          lastScannedAt: new Date(),
          scanCount: (row.psScanCount ?? 0) + 1,
        })
        .where(eq(projectSources.id, row.psId));
      continue;
    }

    // Step 3 — for each video, fetch top comments + insert a
    // findings row. Sequential (not Promise.all) to keep the
    // per-channel YouTube quota burst predictable + so the
    // dedup SELECT below catches duplicates emitted within the
    // same batch.
    let added = 0;
    let fetched = 0;
    for (const video of videos) {
      fetched += 1;
      const url = buildVideoUrl(video.videoId);

      // Dedup by (projectId, externalId=video URL). Same SELECT
      // -first pattern Reddit RSS uses. Volume is bounded
      // (MAX_VIDEOS_PER_CHANNEL × N channels) so we don't need
      // the bulk-insert ON CONFLICT path here.
      const existing = await db
        .select({ id: researchFindings.id })
        .from(researchFindings)
        .where(
          and(
            eq(researchFindings.projectId, projectId),
            eq(researchFindings.externalId, url),
          ),
        )
        .limit(1);
      if (existing.length > 0) continue;

      // Top comments — extra signal for the pain-point
      // extractor. Failures fall back to an empty array so we
      // still ingest the video.
      const comments = await fetchVideoTopComments(
        video.videoId,
        MAX_COMMENTS_PER_VIDEO,
      );

      const snippet = buildFindingSnippet({
        description: video.description,
        comments,
      });
      const postedAt = video.publishedAt
        ? new Date(video.publishedAt)
        : null;

      try {
        await db.insert(researchFindings).values({
          projectId,
          // The research_findings.source column is plain text;
          // 'youtube' is a new value, no enum / constraint to
          // update.
          source: 'youtube',
          externalId: url,
          title: video.title.slice(0, 500),
          url,
          snippet,
          matchScore: null,
          upvotes: null,
          comments: null,
          postedAt,
          sourceId: row.sourceId,
        });
        added += 1;
      } catch (err) {
        console.error('[youtube-scan] insert failed:', err);
      }
    }

    channels.push({
      channelId: row.channelId,
      displayName: row.displayName,
      status: 'success',
      videosFetched: fetched,
      newFindings: added,
    });
    totalFindingsAdded += added;

    await db
      .update(projectSources)
      .set({
        lastScannedAt: new Date(),
        scanCount: (row.psScanCount ?? 0) + 1,
        findingsCount: (row.psFindingsCount ?? 0) + added,
      })
      .where(eq(projectSources.id, row.psId));
  }

  return {
    configured: true,
    channelsScanned: connected.length,
    findingsAdded: totalFindingsAdded,
    channels,
  };
}
