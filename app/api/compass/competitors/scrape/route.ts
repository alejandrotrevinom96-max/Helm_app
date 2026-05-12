// PR #67 — Sprint 7.1A: scrape every approved + pending competitor
// for a project. We process at most 5 in parallel per call to stay
// well inside Vercel Hobby's 60s ceiling — at ~10-20s per scrape
// (fetch + Haiku call), 5 parallel = ~25s p99.
//
// Rows that fail get scrapeStatus='failed' + a short error message
// so the UI can show "retry" without re-scanning the world. Rows
// that succeed get the full positioning snapshot persisted in one
// UPDATE.
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { competitors, projects } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { scrapeCompetitor, ScrapeError } from '@/lib/compass/scraper';

export const maxDuration = 60;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BATCH_SIZE = 5;

interface ScrapeResult {
  name: string;
  url: string;
  status: 'success' | 'failed';
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

  // 6/hr — the founder typically runs this once after detect +
  // approve, then occasionally to retry failed sites.
  const limit = checkRateLimit(
    `compass-scrape:${user.id}`,
    6,
    60 * 60 * 1000,
  );
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
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Pull approved + pending OR previously-failed rows up to the
  // batch cap. Failed rows are eligible because the founder may
  // have fixed the URL OR the site recovered.
  const toScrape = await db
    .select({
      id: competitors.id,
      name: competitors.name,
      url: competitors.url,
      scrapeStatus: competitors.scrapeStatus,
    })
    .from(competitors)
    .where(
      and(
        eq(competitors.projectId, projectId),
        eq(competitors.approvedByUser, true),
      ),
    )
    .limit(50);

  const eligible = toScrape.filter(
    (c) => c.scrapeStatus !== 'success',
  );
  const batch = eligible.slice(0, BATCH_SIZE);

  if (batch.length === 0) {
    return NextResponse.json({
      success: true,
      scraped: 0,
      failed: 0,
      remaining: 0,
      hint: 'Nothing to scrape — approve more competitors or run /detect-competitors first.',
    });
  }

  const settled = await Promise.allSettled(
    batch.map(async (c): Promise<ScrapeResult> => {
      try {
        const data = await scrapeCompetitor(c.url);
        await db
          .update(competitors)
          .set({
            scrapeStatus: 'success',
            scrapeError: null,
            scrapedAt: new Date(),
            headline: data.headline,
            valueProp: data.valueProp,
            targetAudience: data.targetAudience,
            pricingVisible: data.pricingVisible,
            platformPresence: data.platformPresence,
            contentAngles: data.contentAngles,
            updatedAt: new Date(),
          })
          .where(eq(competitors.id, c.id));
        return { name: c.name, url: c.url, status: 'success' };
      } catch (e) {
        const reason =
          e instanceof ScrapeError
            ? e.reason
            : e instanceof Error
              ? e.message
              : 'Unknown error';
        await db
          .update(competitors)
          .set({
            scrapeStatus: 'failed',
            scrapeError: reason.slice(0, 500),
            updatedAt: new Date(),
          })
          .where(eq(competitors.id, c.id));
        return { name: c.name, url: c.url, status: 'failed', error: reason };
      }
    }),
  );

  const results: ScrapeResult[] = settled.map((s) =>
    s.status === 'fulfilled'
      ? s.value
      : {
          name: 'unknown',
          url: 'unknown',
          status: 'failed',
          error: 'promise rejected',
        },
  );
  const successCount = results.filter((r) => r.status === 'success').length;
  const failCount = results.length - successCount;
  const remaining = eligible.length - batch.length;

  return NextResponse.json({
    success: true,
    scraped: successCount,
    failed: failCount,
    attempted: batch.length,
    remaining,
    results,
    hint:
      remaining > 0
        ? `${remaining} more approved competitors pending — re-run to keep scraping.`
        : undefined,
  });
}
