// PR Sprint 7.25 Phase 11.5 — shared research scan helper.
//
// Extracted from app/api/research/scan/route.ts so the new
// /api/cron/research-scan cron can run the same logic against
// many projects in one tick without duplicating the multi-source
// fetch + scoring + insert pipeline.
//
// `scanProjectResearch(project, config)` is pure of req/res: it
// takes already-fetched rows and returns counters. Callers own:
//   - Auth + ownership (manual route) or CRON_SECRET (cron).
//   - Loading + lazy-creating the researchConfig row.
//   - Shaping the HTTP response.
//
// Cost note: each found item triggers a Haiku call via
// scoreResearchMatch (~$0.005). The cron caller caps batch size
// to keep daily spend bounded; the manual route runs unbounded
// because it's already gated by a human click.

import { db } from '@/lib/db';
import { researchConfig, researchFindings, projects } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { searchReddit } from '@/lib/integrations/reddit';
import { searchHackerNews } from '@/lib/integrations/hackernews';
import {
  fetchIndieHackersFeed,
  filterByKeywords,
} from '@/lib/integrations/indiehackers';
import { scoreResearchMatch } from '@/lib/ai/claude';

type Project = typeof projects.$inferSelect;
type ResearchConfig = typeof researchConfig.$inferSelect;

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

interface Sources {
  reddit: boolean;
  hackernews: boolean;
  indiehackers: boolean;
  googleTrends: boolean;
}

const DEFAULT_SOURCES: Sources = {
  reddit: true,
  hackernews: true,
  indiehackers: true,
  googleTrends: true,
};

export interface ScanProjectResult {
  scanned: number;
  scored: number;
  inserted: number;
  /** True when the config had no keywords (caller should skip / hint UI). */
  noKeywords?: boolean;
  /** Source ids actually queried this run. */
  sources: Array<keyof Sources>;
  /** Soft errors (per-item failures); never blocks the cron. */
  errors: string[];
}

/**
 * Run the multi-source research scan for one project. Returns
 * counters. Updates `researchConfig.lastSyncedAt` on success.
 */
export async function scanProjectResearch(
  project: Project,
  config: ResearchConfig,
): Promise<ScanProjectResult> {
  const keywords = (config.keywords as string[] | null) ?? [];
  const sources = (config.sources as Sources | null) ?? DEFAULT_SOURCES;
  const excludeWords = ((config.excludeWords as string[] | null) ?? []).map(
    (w) => w.toLowerCase(),
  );
  const competitors = (config.competitors as string[] | null) ?? [];

  if (keywords.length === 0) {
    return {
      scanned: 0,
      scored: 0,
      inserted: 0,
      noKeywords: true,
      sources: [],
      errors: [],
    };
  }

  const tasks: Array<Promise<NormalizedFinding[]>> = [];

  if (sources.reddit) {
    // Cap to 5 keywords + OR-join with quotes — Reddit rejects
    // over-complex queries; AND-joining returns ~0 results past 3+
    // words.
    const redditQuery = keywords
      .slice(0, 5)
      .map((k) => `"${k}"`)
      .join(' OR ');
    tasks.push(
      searchReddit(redditQuery, { limit: 25, timeRange: 'week' }).then(
        (posts) =>
          posts.map((p) => ({
            source: 'reddit' as const,
            externalId: p.id,
            title: p.title,
            url: `https://reddit.com${p.permalink}`,
            snippet: p.selftext.slice(0, 300),
            upvotes: p.ups,
            comments: p.num_comments,
            postedAt: new Date(p.created_utc * 1000),
          })),
      ),
    );
  }

  if (sources.hackernews) {
    tasks.push(
      Promise.all(
        keywords.map((kw) => searchHackerNews(kw, { limit: 10, daysBack: 7 })),
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
        })),
      ),
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
        })),
      ),
    );
  }

  const settled = await Promise.allSettled(tasks);
  const all: NormalizedFinding[] = [];
  const errors: string[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') {
      all.push(...r.value);
    } else {
      errors.push(
        r.reason instanceof Error ? r.reason.message : String(r.reason),
      );
    }
  }

  const filtered =
    excludeWords.length > 0
      ? all.filter((f) => {
          const text = (f.title + ' ' + f.snippet).toLowerCase();
          return !excludeWords.some((w) => text.includes(w));
        })
      : all;

  // Build the project description (brand bible first, detected stack
  // as a fallback). Matches the legacy scan route line-for-line.
  const stack = (project.detectedStack as DetectedStack | null) ?? {};
  const bible = project.brandContext as
    | {
        identity?: { tagline?: string; industry?: string };
        audience?: { primary?: { description?: string } };
      }
    | null;
  const tagline = bible?.identity?.tagline;
  const industry = bible?.identity?.industry;
  const audienceDesc = bible?.audience?.primary?.description;
  const descriptionParts: string[] = [`${project.name}`];
  if (tagline) descriptionParts.push(`— ${tagline}`);
  if (industry) descriptionParts.push(`(${industry})`);
  if (audienceDesc) descriptionParts.push(`for ${audienceDesc}`);
  if (!tagline && !industry && !audienceDesc) {
    descriptionParts.push(
      `built with ${stack.framework || 'Next.js'}${stack.hasSupabase ? ' + Supabase' : ''}${stack.hasStripe ? ' + Stripe' : ''}`,
    );
  }
  descriptionParts.push(`Keywords: ${keywords.join(', ')}.`);
  const description = descriptionParts.join(' ');

  let inserted = 0;
  let scored = 0;
  const scanned = filtered.length;
  for (const f of filtered) {
    try {
      const [existing] = await db
        .select({ id: researchFindings.id })
        .from(researchFindings)
        .where(
          and(
            eq(researchFindings.projectId, project.id),
            eq(researchFindings.externalId, f.externalId),
          ),
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

      await db.insert(researchFindings).values({
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
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  await db
    .update(researchConfig)
    .set({ lastSyncedAt: new Date() })
    .where(eq(researchConfig.projectId, project.id));

  const enabledSources = (Object.keys(sources) as Array<keyof Sources>).filter(
    (k) => sources[k],
  );

  return {
    scanned,
    scored,
    inserted,
    sources: enabledSources,
    errors,
  };
}
