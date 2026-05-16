// PR Sprint B-finish-2 — YouTube Data API v3 client for the
// research scanner.
//
// Why this file exists: the discovery flow (PR #57) shipped
// YouTube CHANNEL search a year ago, but the actual content
// scanner (lib/research/scan.ts + scan-rss) never read from
// those channels. Founders connected a channel, the channel sat
// in source_directory, and zero findings ever appeared. This
// client closes the gap by exposing the three Data API calls
// the scanner needs.
//
// Quota math (free tier = 10k units/day per Google Cloud
// project):
//   - channels.list         → 1 unit
//   - playlistItems.list    → 1 unit (returns up to 50 items)
//   - videos.list           → 1 unit (batch up to 50 ids)
//   - commentThreads.list   → 1 unit (returns up to 100 comments)
//   - search.list           → 100 units (NOT used here; discovery
//                              uses it sparingly)
//
// One scan pass per channel = ~3 units (uploads + items + 1
// comment fetch). 100 connected channels × daily scan = 300
// units/day. Free tier handles tens of founders comfortably.
//
// All endpoints require an API key (no OAuth) since the data we
// read is public. The key is YOUTUBE_API_KEY in env vars —
// missing key → all calls return empty arrays + a console
// warning so the scanner degrades gracefully.

const API_BASE = 'https://www.googleapis.com/youtube/v3';
const FETCH_TIMEOUT_MS = 10_000;

export function isYouTubeConfigured(): boolean {
  return Boolean(process.env.YOUTUBE_API_KEY?.trim());
}

function apiKey(): string | null {
  const key = process.env.YOUTUBE_API_KEY?.trim();
  return key && key.length > 0 ? key : null;
}

async function timedFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─── channels.list — resolve uploads playlist ─────────────────
//
// Every YouTube channel has a "uploads" playlist that contains
// every video the channel has published, ordered by upload time
// (newest first). Reading that playlist via playlistItems.list
// is 1 quota unit per page vs. search.list at 100 units per
// page, so we pay this one-time lookup per channel and reuse the
// playlistId on every subsequent scan.

interface ChannelListResponse {
  items?: Array<{
    contentDetails?: {
      relatedPlaylists?: {
        uploads?: string;
      };
    };
  }>;
}

export async function getChannelUploadsPlaylistId(
  channelId: string,
): Promise<string | null> {
  const key = apiKey();
  if (!key) {
    console.warn(
      '[youtube] getChannelUploadsPlaylistId: YOUTUBE_API_KEY missing',
    );
    return null;
  }
  const url = new URL(`${API_BASE}/channels`);
  url.searchParams.set('part', 'contentDetails');
  url.searchParams.set('id', channelId);
  url.searchParams.set('key', key);
  try {
    const res = await timedFetch(url.toString());
    if (!res.ok) {
      console.error(
        `[youtube] channels.list failed (${channelId}):`,
        res.status,
      );
      return null;
    }
    const data = (await res.json()) as ChannelListResponse;
    const playlist =
      data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    return playlist ?? null;
  } catch (err) {
    console.error('[youtube] channels.list error:', err);
    return null;
  }
}

// ─── playlistItems.list — recent videos from uploads ──────────

export interface YouTubePlaylistItem {
  videoId: string;
  title: string;
  description: string;
  channelTitle: string;
  publishedAt: string; // ISO
}

interface PlaylistItemsResponse {
  items?: Array<{
    snippet?: {
      title?: string;
      description?: string;
      channelTitle?: string;
      publishedAt?: string;
      resourceId?: { videoId?: string };
    };
  }>;
}

export async function fetchPlaylistItems(
  playlistId: string,
  maxResults = 10,
): Promise<YouTubePlaylistItem[]> {
  const key = apiKey();
  if (!key) {
    console.warn('[youtube] fetchPlaylistItems: YOUTUBE_API_KEY missing');
    return [];
  }
  // Cap at 50 per the API contract; default 10 keeps the
  // per-channel write volume in research_findings reasonable.
  const limited = Math.min(Math.max(maxResults, 1), 50);
  const url = new URL(`${API_BASE}/playlistItems`);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('playlistId', playlistId);
  url.searchParams.set('maxResults', String(limited));
  url.searchParams.set('key', key);
  try {
    const res = await timedFetch(url.toString());
    if (!res.ok) {
      console.error(
        `[youtube] playlistItems.list failed (${playlistId}):`,
        res.status,
      );
      return [];
    }
    const data = (await res.json()) as PlaylistItemsResponse;
    return (data.items ?? [])
      .map((it) => {
        const videoId = it.snippet?.resourceId?.videoId ?? '';
        const title = it.snippet?.title ?? '';
        const description = it.snippet?.description ?? '';
        const channelTitle = it.snippet?.channelTitle ?? '';
        const publishedAt = it.snippet?.publishedAt ?? '';
        if (!videoId || !title) return null;
        return {
          videoId,
          title,
          description,
          channelTitle,
          publishedAt,
        };
      })
      .filter((v): v is YouTubePlaylistItem => v !== null);
  } catch (err) {
    console.error('[youtube] playlistItems.list error:', err);
    return [];
  }
}

// ─── commentThreads.list — top comments on a video ────────────
//
// Comments are where pain points actually live ("I tried X but
// it doesn't do Y", "Why is Z so hard?"). The Haiku-based
// pain-point extractor downstream is what surfaces them; here
// we just join the top N comment texts onto the video's snippet
// so the extractor has signal to work with.

export interface YouTubeComment {
  text: string;
  likeCount: number;
  author: string;
}

interface CommentThreadsResponse {
  items?: Array<{
    snippet?: {
      topLevelComment?: {
        snippet?: {
          textDisplay?: string;
          textOriginal?: string;
          likeCount?: number;
          authorDisplayName?: string;
        };
      };
    };
  }>;
  error?: { message?: string };
}

export async function fetchVideoTopComments(
  videoId: string,
  maxResults = 5,
): Promise<YouTubeComment[]> {
  const key = apiKey();
  if (!key) {
    console.warn('[youtube] fetchVideoTopComments: YOUTUBE_API_KEY missing');
    return [];
  }
  const limited = Math.min(Math.max(maxResults, 1), 100);
  const url = new URL(`${API_BASE}/commentThreads`);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('videoId', videoId);
  url.searchParams.set('order', 'relevance');
  url.searchParams.set('maxResults', String(limited));
  url.searchParams.set('key', key);
  try {
    const res = await timedFetch(url.toString());
    if (!res.ok) {
      // Comments disabled on the video is a common 403. Don't
      // log every one — bubble up empty so the caller skips this
      // video cleanly.
      if (res.status === 403) return [];
      console.error(
        `[youtube] commentThreads.list failed (${videoId}):`,
        res.status,
      );
      return [];
    }
    const data = (await res.json()) as CommentThreadsResponse;
    return (data.items ?? [])
      .map((it) => {
        const c = it.snippet?.topLevelComment?.snippet;
        if (!c) return null;
        const text =
          (c.textOriginal && c.textOriginal.trim()) ||
          (c.textDisplay && c.textDisplay.trim()) ||
          '';
        if (!text) return null;
        return {
          text,
          likeCount: c.likeCount ?? 0,
          author: c.authorDisplayName ?? '',
        };
      })
      .filter((c): c is YouTubeComment => c !== null);
  } catch (err) {
    console.error('[youtube] commentThreads.list error:', err);
    return [];
  }
}

// ─── Helpers ──────────────────────────────────────────────────

/** Build the canonical watch URL we persist on research_findings.url. */
export function buildVideoUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * Compose video title + description + top comments into a single
 * snippet string for the pain-point extractor. We cap at 2000
 * chars to match research_findings.snippet's column shape
 * convention (set across reddit / hn / ih).
 */
export function buildFindingSnippet(args: {
  description: string;
  comments: YouTubeComment[];
}): string {
  const parts: string[] = [];
  if (args.description.trim()) {
    parts.push(args.description.trim());
  }
  if (args.comments.length > 0) {
    parts.push('---');
    parts.push('TOP COMMENTS:');
    for (const c of args.comments) {
      const author = c.author ? `${c.author}: ` : '';
      parts.push(`${author}${c.text.replace(/\s+/g, ' ').slice(0, 400)}`);
    }
  }
  return parts.join('\n').slice(0, 2000);
}
