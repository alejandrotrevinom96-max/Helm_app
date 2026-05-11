// PR #56 — Sprint 7.0: Research Auto-Discovery (Reddit-only v1).
//
// Founders don't want to think "which subreddits should I monitor."
// They want a list of candidates ranked by signal/noise for their
// niche. This endpoint takes the brand bible's keywords + audience
// pain points, hits Reddit's public subreddit search, dedupes against
// the global source_directory, and persists every fresh candidate
// row.
//
// What this endpoint does NOT do:
//  - Rank — ranking lives in /api/research/suggest-sources (Haiku 4.5)
//    so the discovery step stays cheap and replay-safe.
//  - YouTube — deferred until we wire YOUTUBE_API_KEY env var.
//  - Reddit OAuth — public search returns 25 results without auth and
//    the 60 rpm budget is more than enough for the founder workflow.
//
// Isolation: project ownership join + we never look at another user's
// projectSources rows. The source_directory itself is global (multi-
// tenant catalog) — every founder benefits from someone else
// discovering r/SaaS once.
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  projects,
  sourceDirectory,
  projectSources,
  researchConfig,
} from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import type { BrandBible } from '@/lib/types/brand';
import {
  getRedditAccessToken,
  getUserAgent,
} from '@/lib/integrations/reddit-oauth';

export const maxDuration = 30;

interface SubredditSearchHit {
  data: {
    display_name: string; // 'SaaS'
    display_name_prefixed: string; // 'r/SaaS'
    title: string;
    public_description: string;
    description: string;
    subscribers: number;
    url: string; // '/r/SaaS/'
    lang?: string;
    over18?: boolean;
    subreddit_type?: string; // 'public' | 'private' | 'restricted'
  };
}

interface SubredditSearchResponse {
  data: { children: SubredditSearchHit[] };
}

// PR #58 — Sprint 7.0.2: prefer the authenticated `oauth.reddit.com`
// endpoint when the founder has connected Reddit. The public JSON
// API at `www.reddit.com` silently returns empty listings when the
// caller IP belongs to a cloud provider (Vercel/AWS), which is why
// Sprint 7.0.1 saw `discovered: 0` even with valid keywords.
async function searchSubreddits(
  term: string,
  limit = 10,
  accessToken: string | null,
): Promise<SubredditSearchHit['data'][]> {
  const ua = getUserAgent();
  const path = `/subreddits/search.json?q=${encodeURIComponent(term)}&limit=${limit}&include_over_18=off`;
  const url = accessToken
    ? `https://oauth.reddit.com${path}`
    : `https://www.reddit.com${path}`;
  const headers: Record<string, string> = { 'User-Agent': ua };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  try {
    const res = await fetch(url, {
      headers,
      next: { revalidate: 300 },
    });
    if (!res.ok) {
      console.error(
        `[discover] Reddit search failed (${term}, auth=${Boolean(accessToken)}):`,
        res.status,
      );
      return [];
    }
    const json: SubredditSearchResponse = await res.json();
    return json.data.children.map((c) => c.data);
  } catch (err) {
    console.error(`[discover] Reddit search error (${term}):`, err);
    return [];
  }
}

// PR #57 — Sprint 7.0.1 (BUG #21 fix): the original implementation
// seeded from bible.pillars + bible.audience.painPoints, but pillars
// are conceptual ("playfulness", "frictionless") — terrible Reddit
// search queries. The Voya project has 10 curated research_config
// keywords ("AI travel planner", "viajar sola mujer", "morritas
// viajeras") that are *exactly* what Reddit search expects.
//
// Order of precedence:
//   1. research_config.keywords (top 5 — founder-curated, highest signal)
//   2. Brand-bible watering holes (2 — already a "where they hang out" signal)
//   3. Brand-bible audience pain language as a fallback (3 short phrases)
//
// Total capped at 6 unique terms so we don't blow Reddit's UA budget.
function extractSeedTerms(
  configKeywords: string[],
  bible: BrandBible | null,
): string[] {
  const terms = new Set<string>();

  // 1. Founder-curated keywords — strongest signal we have.
  for (const k of configKeywords.slice(0, 5)) {
    if (typeof k === 'string' && k.trim().length > 2) {
      terms.add(k.toLowerCase().trim());
    }
  }

  // 2. Watering holes — the founder told us "this is where my audience
  // hangs out", which often *is* a subreddit name or close to one.
  const primary = bible?.audience?.primary;
  if (primary?.wateringHoles) {
    for (const wh of primary.wateringHoles.slice(0, 2)) {
      if (typeof wh === 'string' && wh.length > 2) {
        terms.add(wh.toLowerCase().trim());
      }
    }
  }

  // 3. Fallback only when the founder hasn't configured keywords:
  // pull the first few audience pain points as short phrases.
  if (terms.size === 0 && primary?.painPoints) {
    for (const pp of primary.painPoints.slice(0, 3)) {
      if (pp?.pain && typeof pp.pain === 'string') {
        const short = pp.pain.split(/\s+/).slice(0, 4).join(' ');
        if (short.length > 3) terms.add(short.toLowerCase());
      }
    }
  }

  return Array.from(terms).slice(0, 6);
}

// YouTube Data API v3 — channel search. Returns at most 5 channels
// per term. We hit /search?type=channel which costs 100 quota units
// per call; with 6 seeds × 100 = 600 units, the 10k/day free tier is
// plenty (~16 founder discovery runs per day).
interface YouTubeChannelHit {
  channelId: string;
  title: string;
  description: string;
  customUrl: string | null;
}

async function searchYouTubeChannels(
  term: string,
  apiKey: string,
): Promise<YouTubeChannelHit[]> {
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('q', term);
  url.searchParams.set('type', 'channel');
  url.searchParams.set('maxResults', '5');
  url.searchParams.set('key', apiKey);
  try {
    const res = await fetch(url.toString(), {
      next: { revalidate: 300 },
    });
    if (!res.ok) {
      console.error(`[discover] YouTube search failed (${term}):`, res.status);
      return [];
    }
    type YouTubeSearchResponse = {
      items?: Array<{
        snippet?: {
          channelId?: string;
          title?: string;
          description?: string;
          customUrl?: string | null;
        };
      }>;
    };
    const json = (await res.json()) as YouTubeSearchResponse;
    return (json.items ?? [])
      .map((it) => ({
        channelId: it.snippet?.channelId ?? '',
        title: it.snippet?.title ?? '',
        description: it.snippet?.description ?? '',
        customUrl: it.snippet?.customUrl ?? null,
      }))
      .filter((h) => h.channelId);
  } catch (err) {
    console.error(`[discover] YouTube search error (${term}):`, err);
    return [];
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 5 discoveries per hour is generous — most founders will run this
  // once when they first land on the Sources tab. Cap protects us
  // against the curious user who hits the button repeatedly.
  const limit = checkRateLimit(`research-discover:${user.id}`, 5, 60 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
        hint: `Try again in ${Math.ceil(limit.resetMs / 60000)} minutes.`,
      },
      { status: 429 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const { projectId } = body as { projectId?: string };
  if (!projectId) {
    return NextResponse.json({ error: 'projectId required' }, { status: 400 });
  }

  // Isolation: project must belong to caller.
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const bible = (project.brandContext as BrandBible | null) ?? null;

  // Pull research_config keywords first — these are founder-curated
  // search terms and far more useful than the brand bible's conceptual
  // pillars (BUG #21).
  const [config] = await db
    .select({ keywords: researchConfig.keywords })
    .from(researchConfig)
    .where(eq(researchConfig.projectId, projectId))
    .limit(1);

  const configKeywords = (config?.keywords as string[] | null) ?? [];
  const seedTerms = extractSeedTerms(configKeywords, bible);

  const warnings: string[] = [];

  if (seedTerms.length === 0) {
    return NextResponse.json(
      {
        error: 'No keywords configured',
        hint: 'Add keywords in Research → Configuration first, or fill out audience pain points in /marketing.',
      },
      { status: 400 },
    );
  }

  // PR #58 — Sprint 7.0.2: pull the founder's Reddit OAuth token if
  // they've connected the account. When present we hit
  // oauth.reddit.com (works from cloud IPs); when absent we fall
  // back to www.reddit.com which is frequently rate-limited or
  // blocked for cloud IPs.
  const redditToken = await getRedditAccessToken(user.id);
  if (!redditToken) {
    warnings.push(
      'Reddit not connected: using public API which often returns 0 results from cloud IPs. Connect Reddit in /integrations for reliable discovery.',
    );
  }

  // Fan out to Reddit. Run sequentially — Reddit is touchy about
  // bursts from a single User-Agent. 6 seeds × 10 results = at most
  // 60 hits, well below the 100/min the API tolerates.
  const allHits: SubredditSearchHit['data'][] = [];
  for (const term of seedTerms) {
    const hits = await searchSubreddits(term, 10, redditToken);
    allHits.push(...hits);
  }

  // Dedupe by display_name (case-insensitive — Reddit is
  // case-preserving but case-insensitive for routing).
  const seen = new Set<string>();
  const uniqueHits = allHits.filter((h) => {
    const key = h.display_name.toLowerCase();
    if (seen.has(key)) return false;
    if (h.over18) return false; // safety filter
    if (h.subreddit_type && h.subreddit_type !== 'public') return false;
    seen.add(key);
    return true;
  });

  // PR #57 — Sprint 7.0.1: YouTube channel discovery. Surface a
  // warning if YOUTUBE_API_KEY isn't set so the founder knows half
  // the workflow is silently disabled (BUG #23).
  const youtubeKey = process.env.YOUTUBE_API_KEY;
  const youtubeHits: YouTubeChannelHit[] = [];
  if (!youtubeKey) {
    warnings.push(
      'YouTube discovery skipped: YOUTUBE_API_KEY not configured.',
    );
    console.warn('[discover] YOUTUBE_API_KEY missing — Reddit-only run');
  } else {
    for (const term of seedTerms) {
      const hits = await searchYouTubeChannels(term, youtubeKey);
      youtubeHits.push(...hits);
    }
  }

  // Dedupe YouTube channels by channelId.
  const seenYt = new Set<string>();
  const uniqueYt = youtubeHits.filter((h) => {
    if (seenYt.has(h.channelId)) return false;
    seenYt.add(h.channelId);
    return true;
  });

  // Skip the founder's already-decided rows. Pull every projectSource
  // for this project, regardless of status, so we don't re-surface a
  // skipped subreddit.
  const existingRows = await db
    .select({
      sourceId: projectSources.sourceId,
    })
    .from(projectSources)
    .where(eq(projectSources.projectId, projectId));
  const existingSourceIds = new Set(existingRows.map((r) => r.sourceId));

  // Upsert into the global directory. Drizzle's onConflictDoNothing
  // + RETURNING gives us the row whether we inserted or matched.
  // We do one round-trip per hit to keep the code obvious — at 60
  // hits max this is fine.
  const directoryRows: { id: string; identifier: string }[] = [];
  for (const hit of uniqueHits) {
    const inserted = await db
      .insert(sourceDirectory)
      .values({
        platform: 'reddit',
        identifier: hit.display_name,
        displayName: hit.display_name_prefixed,
        url: `https://www.reddit.com${hit.url}`,
        memberCount: hit.subscribers ?? 0,
        activityLevel: null, // filled in later by suggest-sources
        language: hit.lang ?? null,
        description:
          hit.public_description || hit.description?.slice(0, 500) || null,
        metadata: {
          title: hit.title,
          subscribers: hit.subscribers,
          subreddit_type: hit.subreddit_type,
        },
        lastVerified: new Date(),
      })
      .onConflictDoNothing({
        target: [sourceDirectory.platform, sourceDirectory.identifier],
      })
      .returning({ id: sourceDirectory.id });

    if (inserted.length > 0) {
      directoryRows.push({ id: inserted[0].id, identifier: hit.display_name });
      continue;
    }
    // Conflict — look up the existing row.
    const [existing] = await db
      .select({ id: sourceDirectory.id })
      .from(sourceDirectory)
      .where(
        and(
          eq(sourceDirectory.platform, 'reddit'),
          eq(sourceDirectory.identifier, hit.display_name),
        ),
      )
      .limit(1);
    if (existing) {
      directoryRows.push({ id: existing.id, identifier: hit.display_name });
    }
  }

  // Upsert YouTube channels into the same global directory. Same
  // onConflictDoNothing dance — identifier is the channelId.
  for (const yt of uniqueYt) {
    const inserted = await db
      .insert(sourceDirectory)
      .values({
        platform: 'youtube',
        identifier: yt.channelId,
        displayName: yt.title,
        url: yt.customUrl
          ? `https://www.youtube.com/${yt.customUrl}`
          : `https://www.youtube.com/channel/${yt.channelId}`,
        memberCount: null, // would need a separate channels.list call
        activityLevel: null,
        language: null,
        description: yt.description?.slice(0, 500) || null,
        metadata: { customUrl: yt.customUrl },
        lastVerified: new Date(),
      })
      .onConflictDoNothing({
        target: [sourceDirectory.platform, sourceDirectory.identifier],
      })
      .returning({ id: sourceDirectory.id });

    if (inserted.length > 0) {
      directoryRows.push({ id: inserted[0].id, identifier: yt.channelId });
      continue;
    }
    const [existing] = await db
      .select({ id: sourceDirectory.id })
      .from(sourceDirectory)
      .where(
        and(
          eq(sourceDirectory.platform, 'youtube'),
          eq(sourceDirectory.identifier, yt.channelId),
        ),
      )
      .limit(1);
    if (existing) {
      directoryRows.push({ id: existing.id, identifier: yt.channelId });
    }
  }

  // Filter out the founder's already-decided rows.
  const candidates = directoryRows.filter(
    (r) => !existingSourceIds.has(r.id),
  );

  // Hydrate full directory rows for the UI.
  const candidateIds = candidates.map((c) => c.id);
  const sources = candidateIds.length
    ? await db
        .select()
        .from(sourceDirectory)
        .where(inArray(sourceDirectory.id, candidateIds))
    : [];

  return NextResponse.json({
    discovered: sources.length,
    // Both keys for back-compat with the existing client + the new
    // 7.0.1 client which expects `searchTermsUsed`.
    seedTermsUsed: seedTerms,
    searchTermsUsed: seedTerms,
    warnings,
    sources,
  });
}
