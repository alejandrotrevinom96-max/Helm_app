import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projects, researchFindings, researchConfig } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { searchReddit } from '@/lib/integrations/reddit';
import { searchHackerNews } from '@/lib/integrations/hackernews';
import {
  fetchIndieHackersFeed,
  filterByKeywords,
} from '@/lib/integrations/indiehackers';
import { scoreResearchMatch } from '@/lib/ai/claude';
import { NextResponse } from 'next/server';

interface DetectedStack {
  framework?: string;
  hasSupabase?: boolean;
  hasStripe?: boolean;
  hasMeta?: boolean;
}

interface NormalizedFinding {
  source: 'reddit' | 'hackernews' | 'indiehackers';
  externalId: string;
  title: string;
  url: string;
  snippet: string;
  upvotes?: number;
  comments?: number;
  postedAt?: Date;
}

const DEFAULT_SOURCES = {
  reddit: true,
  hackernews: true,
  indiehackers: true,
  googleTrends: true,
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { projectId } = await request.json();
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Load (or auto-create) the research config
  let [config] = await db
    .select()
    .from(researchConfig)
    .where(eq(researchConfig.projectId, projectId))
    .limit(1);
  if (!config) {
    [config] = await db
      .insert(researchConfig)
      .values({ projectId })
      .returning();
  }

  const keywords = (config.keywords as string[] | null) ?? [];
  const sources = (config.sources as typeof DEFAULT_SOURCES | null) ?? DEFAULT_SOURCES;
  const excludeWords = ((config.excludeWords as string[] | null) ?? []).map((w) =>
    w.toLowerCase()
  );
  const competitors = (config.competitors as string[] | null) ?? [];

  if (keywords.length === 0) {
    return NextResponse.json(
      {
        error: 'No keywords configured',
        hint: 'Add keywords in the Configuration card before scanning.',
        scanned: 0,
        inserted: 0,
      },
      { status: 400 }
    );
  }

  // Reddit needs a single query string — join with a space so all keywords
  // contribute. HN needs one call per keyword (Algolia matches strings).
  // IH has no search; we filter client-side.
  const tasks: Array<Promise<NormalizedFinding[]>> = [];

  if (sources.reddit) {
    // Use OR with quoted keywords. Joining with spaces is implicit AND on
    // Reddit search and tends to return zero results once you have 3+ words.
    // Cap to 5 to keep the query short — Reddit rejects over-complex queries.
    const redditQuery = keywords
      .slice(0, 5)
      .map((k) => `"${k}"`)
      .join(' OR ');
    tasks.push(
      searchReddit(redditQuery, { limit: 25, timeRange: 'week' }).then((posts) =>
        posts.map((p) => ({
          source: 'reddit' as const,
          externalId: p.id,
          title: p.title,
          url: `https://reddit.com${p.permalink}`,
          snippet: p.selftext.slice(0, 300),
          upvotes: p.ups,
          comments: p.num_comments,
          postedAt: new Date(p.created_utc * 1000),
        }))
      )
    );
  }

  if (sources.hackernews) {
    tasks.push(
      Promise.all(
        keywords.map((kw) => searchHackerNews(kw, { limit: 10, daysBack: 7 }))
      ).then((arr) =>
        arr.flat().map((h) => ({
          source: 'hackernews' as const,
          externalId: h.id,
          title: h.title,
          url: h.url,
          snippet:
            h.snippet || `${h.score} points · ${h.numComments} comments`,
          upvotes: h.score,
          comments: h.numComments,
          postedAt: h.date,
        }))
      )
    );
  }

  if (sources.indiehackers) {
    tasks.push(
      fetchIndieHackersFeed().then((items) =>
        filterByKeywords(items, keywords).map((i) => ({
          source: 'indiehackers' as const,
          externalId: i.id,
          title: i.title,
          url: i.url,
          snippet: i.snippet,
          postedAt: i.date,
        }))
      )
    );
  }

  const settled = await Promise.allSettled(tasks);
  const all: NormalizedFinding[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') all.push(...r.value);
  }

  // Apply user's excludeWords filter pre-scoring (cheaper than scoring noise)
  const filtered =
    excludeWords.length > 0
      ? all.filter((f) => {
          const text = (f.title + ' ' + f.snippet).toLowerCase();
          return !excludeWords.some((w) => text.includes(w));
        })
      : all;

  // Project description for the per-finding scoring step. Pre-PR-16 this
  // hardcoded "a SaaS using Next.js" which biased scoring against non-tech
  // projects. Now we lead with the brand bible (tagline + industry +
  // audience) and only fall back to detectedStack when the bible is empty.
  const stack = (project.detectedStack as DetectedStack | null) ?? {};
  const bible = project.brandContext as
    | { identity?: { tagline?: string; industry?: string }; audience?: { primary?: { description?: string } } }
    | null;
  const tagline = bible?.identity?.tagline;
  const industry = bible?.identity?.industry;
  const audienceDesc = bible?.audience?.primary?.description;
  const descriptionParts: string[] = [`${project.name}`];
  if (tagline) descriptionParts.push(`— ${tagline}`);
  if (industry) descriptionParts.push(`(${industry})`);
  if (audienceDesc) descriptionParts.push(`for ${audienceDesc}`);
  if (!tagline && !industry && !audienceDesc) {
    // No bible: lean on detected stack, but stop calling it a "SaaS" by
    // default — that biases scoring toward generic indie-hacker findings.
    descriptionParts.push(
      `built with ${stack.framework || 'Next.js'}${stack.hasSupabase ? ' + Supabase' : ''}${stack.hasStripe ? ' + Stripe' : ''}`
    );
  }
  descriptionParts.push(`Keywords: ${keywords.join(', ')}.`);
  const description = descriptionParts.join(' ');

  // Dedup: skip findings that are already in the DB before paying for scoring.
  let inserted = 0;
  let scanned = filtered.length;
  let scored = 0;
  for (const f of filtered) {
    try {
      const [existing] = await db
        .select({ id: researchFindings.id })
        .from(researchFindings)
        .where(
          and(
            eq(researchFindings.projectId, project.id),
            eq(researchFindings.externalId, f.externalId)
          )
        )
        .limit(1);
      if (existing) continue;

      const { matchScore, competitor } = await scoreResearchMatch({
        projectDescription: description,
        postTitle: f.title,
        postContent: f.snippet,
        competitors,
      });
      scored++;
      if (matchScore < 30) continue;

      await db
        .insert(researchFindings)
        .values({
          projectId: project.id,
          source: f.source,
          externalId: f.externalId,
          title: f.title,
          url: f.url,
          snippet: f.snippet,
          matchScore,
          upvotes: f.upvotes ?? null,
          comments: f.comments ?? null,
          postedAt: f.postedAt ?? null,
          competitor,
        });
      inserted++;
    } catch (e) {
      console.error('[RESEARCH SCAN] item failed', e);
      continue;
    }
  }

  // Mark sync time so the UI can show "last scanned X ago"
  await db
    .update(researchConfig)
    .set({ lastSyncedAt: new Date() })
    .where(eq(researchConfig.projectId, projectId));

  const enabledSources = (Object.keys(sources) as Array<keyof typeof sources>).filter(
    (k) => sources[k]
  );

  return NextResponse.json({
    scanned,
    scored,
    inserted,
    sources: enabledSources,
  });
}
