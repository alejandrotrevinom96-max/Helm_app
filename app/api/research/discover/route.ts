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
import { projects, sourceDirectory, projectSources } from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import type { BrandBible } from '@/lib/types/brand';

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

const REDDIT_UA =
  process.env.REDDIT_USER_AGENT ?? 'Helm/1.0 (indie hacker tool)';

async function searchSubreddits(
  term: string,
  limit = 10,
): Promise<SubredditSearchHit['data'][]> {
  const url = new URL('https://www.reddit.com/subreddits/search.json');
  url.searchParams.set('q', term);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('include_over_18', 'off');
  try {
    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': REDDIT_UA },
      // Reddit's response is fine to cache for a few minutes — same
      // founder hitting Discover twice in a row shouldn't re-bill us
      // (well, it's free, but it's polite).
      next: { revalidate: 300 },
    });
    if (!res.ok) {
      console.error(`[discover] Reddit search failed (${term}):`, res.status);
      return [];
    }
    const json: SubredditSearchResponse = await res.json();
    return json.data.children.map((c) => c.data);
  } catch (err) {
    console.error(`[discover] Reddit search error (${term}):`, err);
    return [];
  }
}

// Pull the most signal-dense seed terms out of the brand bible. We
// favor: identity.name fragments aren't useful, but archetype,
// pillars, and audience pain language ARE. We cap at 6 unique
// queries so a chatty bible doesn't trigger 30 Reddit hits.
function extractSeedTerms(bible: BrandBible | null): string[] {
  if (!bible) return [];
  const terms = new Set<string>();

  // Pillars are short noun phrases — perfect Reddit search seeds.
  for (const p of bible.pillars ?? []) {
    if (p?.name && typeof p.name === 'string') {
      terms.add(p.name.toLowerCase());
    }
  }

  // Audience pain points: each `pain` line is a candidate term.
  const primary = bible.audience?.primary;
  if (primary?.painPoints) {
    for (const pp of primary.painPoints) {
      if (pp?.pain && typeof pp.pain === 'string') {
        // Trim long pains to first 4 words — Reddit search prefers
        // 1-3 keyword queries over full sentences.
        const short = pp.pain.split(/\s+/).slice(0, 4).join(' ');
        if (short.length > 3) terms.add(short.toLowerCase());
      }
    }
  }

  // Watering holes can also seed (founder told us where audience hangs out).
  if (primary?.wateringHoles) {
    for (const wh of primary.wateringHoles) {
      if (typeof wh === 'string' && wh.length > 2) {
        terms.add(wh.toLowerCase());
      }
    }
  }

  return Array.from(terms).slice(0, 6);
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
  const seedTerms = extractSeedTerms(bible);

  if (seedTerms.length === 0) {
    return NextResponse.json(
      {
        error: 'Brand bible not rich enough to seed discovery',
        hint: 'Add pillars or audience pain points in /marketing first.',
      },
      { status: 400 },
    );
  }

  // Fan out to Reddit. Run sequentially — Reddit is touchy about
  // bursts from a single User-Agent. 6 seeds × 10 results = at most
  // 60 hits, well below the 100/min the public JSON API tolerates.
  const allHits: SubredditSearchHit['data'][] = [];
  for (const term of seedTerms) {
    const hits = await searchSubreddits(term, 10);
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
    seedTermsUsed: seedTerms,
    sources,
  });
}
