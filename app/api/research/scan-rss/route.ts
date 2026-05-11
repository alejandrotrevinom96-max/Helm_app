// PR #59 — Sprint 7.0.3: scan every connected Reddit source via RSS.
//
// This is a NEW endpoint, separate from /api/research/scan (legacy
// keyword-search across reddit/HN/IH). Reasons to keep them separate:
//   - The legacy endpoint also scores findings with Claude — scoring
//     every RSS post would balloon costs (each RSS pull = 25 posts ×
//     N subreddits). For RSS we deliberately leave matchScore null
//     and let the pain-point extractor do the filtering for free.
//   - This endpoint requires opt-in + connected sources, while the
//     legacy one only requires keywords. Different contracts.
//
// Findings persist into the same `researchFindings` table — that's
// what makes them usable by /extract-pain-points downstream. We use
// the REAL columns (source, snippet, postedAt, foundAt) — not the
// names the Sprint 7.0.3 plan assumed.
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  projects,
  projectSources,
  sourceDirectory,
  researchFindings,
  researchConfig,
} from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  fetchSubredditRSS,
  getRedditHealth,
} from '@/lib/research/reddit-rss';

export const maxDuration = 60;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ScanResult {
  subreddit: string;
  status: 'success' | 'no_posts' | 'cached';
  postsFetched: number;
  newFindings: number;
  error?: string;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 6/hr cap — RSS cache already prevents re-hitting Reddit, but a
  // tight loop here would still burn DB write budget.
  const limit = checkRateLimit(`research-scan-rss:${user.id}`, 6, 60 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
        hint: `Try again in ${Math.ceil(limit.resetMs / 60000)} minutes.`,
      },
      { status: 429 },
    );
  }

  let body: { projectId?: string };
  try {
    body = (await request.json()) as { projectId?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { projectId } = body;
  if (!projectId || !UUID_RE.test(projectId)) {
    return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 });
  }

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) {
    return NextResponse.json(
      { error: 'Project not found or forbidden' },
      { status: 403 },
    );
  }

  const [config] = await db
    .select({ optin: researchConfig.redditRssOptin })
    .from(researchConfig)
    .where(eq(researchConfig.projectId, projectId))
    .limit(1);

  if (!config?.optin) {
    return NextResponse.json(
      {
        error: 'Reddit RSS opt-in required',
        hint: 'Enable Reddit RSS in /research/sources first.',
      },
      { status: 400 },
    );
  }

  const health = await getRedditHealth();

  const connected = await db
    .select({
      psId: projectSources.id,
      psScanCount: projectSources.scanCount,
      psFindingsCount: projectSources.findingsCount,
      sourceId: sourceDirectory.id,
      identifier: sourceDirectory.identifier,
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
        eq(sourceDirectory.platform, 'reddit'),
      ),
    );

  if (connected.length === 0) {
    return NextResponse.json({
      success: true,
      findingsAdded: 0,
      sourcesScanned: 0,
      redditHealth: health,
      hint: 'No Reddit sources connected. Add subreddits at /research/sources.',
    });
  }

  const results: ScanResult[] = [];
  let totalFindingsAdded = 0;

  for (const row of connected) {
    const posts = await fetchSubredditRSS(row.identifier);
    if (posts.length === 0) {
      results.push({
        subreddit: row.identifier,
        status: 'no_posts',
        postsFetched: 0,
        newFindings: 0,
      });
      // Still bump scanCount so we know we tried.
      await db
        .update(projectSources)
        .set({
          lastScannedAt: new Date(),
          scanCount: (row.psScanCount ?? 0) + 1,
        })
        .where(eq(projectSources.id, row.psId));
      continue;
    }

    // Map RSS posts to researchFindings rows using the REAL schema
    // (source, snippet, postedAt — not the plan's text/publishedAt).
    const values = posts.map((p) => ({
      projectId,
      source: 'reddit' as const,
      externalId: p.link, // permalink is the natural unique key
      title: p.title.slice(0, 500),
      url: p.link,
      snippet: (p.contentSnippet ?? '').slice(0, 2000),
      matchScore: null, // intentionally unscored — pain extractor handles filtering
      upvotes: null, // RSS doesn't carry vote counts
      comments: null,
      postedAt: p.pubDate ? new Date(p.pubDate) : null,
      sourceId: row.sourceId,
    }));

    // Try a bulk insert with ON CONFLICT DO NOTHING. Drizzle needs a
    // single target column for the conflict — externalId is not
    // unique-indexed yet, so we fall back to per-row insert with the
    // same dedup behaviour via a SELECT-first pattern. The volume
    // (max ~25 per call × N sources) keeps this fine.
    let added = 0;
    for (const v of values) {
      const existing = await db
        .select({ id: researchFindings.id })
        .from(researchFindings)
        .where(
          and(
            eq(researchFindings.projectId, projectId),
            eq(researchFindings.externalId, v.externalId),
          ),
        )
        .limit(1);
      if (existing.length > 0) continue;
      try {
        await db.insert(researchFindings).values(v);
        added++;
      } catch (e) {
        console.error('[scan-rss] insert failed:', e);
      }
    }

    totalFindingsAdded += added;
    results.push({
      subreddit: row.identifier,
      status: 'success',
      postsFetched: posts.length,
      newFindings: added,
    });

    await db
      .update(projectSources)
      .set({
        lastScannedAt: new Date(),
        scanCount: (row.psScanCount ?? 0) + 1,
        findingsCount: (row.psFindingsCount ?? 0) + added,
      })
      .where(eq(projectSources.id, row.psId));
  }

  // Stamp the config so the existing /research UI's "Last scan"
  // indicator stays accurate.
  await db
    .update(researchConfig)
    .set({ lastSyncedAt: new Date() })
    .where(eq(researchConfig.projectId, projectId));

  return NextResponse.json({
    success: true,
    findingsAdded: totalFindingsAdded,
    sourcesScanned: connected.length,
    redditHealth: health,
    results,
  });
}
