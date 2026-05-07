// PR #26 — Sprint 3: Auto-Generate Brand Bible.
//
// POST /api/brand-bible/sources/[id]/analyze
//
// Runs the per-source analysis: for 'website' that's the cheerio
// scrape from lib/brand-bible/web-scraper.ts. The result is persisted
// to brand_bible_sources.analysis_result and the row's status moves
// to 'analyzed' (or 'failed' on error).
//
// We mark the row 'analyzing' BEFORE the long-running scrape so
// concurrent UI polls show the spinner. On error we both bubble up
// the message and persist it in error_message for follow-up.
//
// Other source types (Meta / LinkedIn / Twitter) return 501 — Sprint
// 5 territory.
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { brandBibleSources } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { scrapeWebsite } from '@/lib/brand-bible/web-scraper';

// Cheerio + a 15s scrape can push past Vercel's default 10s on hobby;
// matching the visuals endpoint's 90s ceiling buys us margin.
export const maxDuration = 90;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Confirm ownership + read source. user_id is on the row directly,
  // no project join needed.
  const [source] = await db
    .select()
    .from(brandBibleSources)
    .where(
      and(
        eq(brandBibleSources.id, id),
        eq(brandBibleSources.userId, user.id)
      )
    )
    .limit(1);
  if (!source) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (source.sourceType !== 'website') {
    return NextResponse.json(
      {
        error:
          'Analysis for this platform is not available yet — Sprint 5 ships OAuth + per-platform analyzers.',
      },
      { status: 501 }
    );
  }
  if (!source.sourceUrl) {
    return NextResponse.json(
      { error: 'Source has no URL to analyze' },
      { status: 400 }
    );
  }

  // Mark analyzing.
  await db
    .update(brandBibleSources)
    .set({ status: 'analyzing', updatedAt: new Date() })
    .where(eq(brandBibleSources.id, id));

  let result;
  try {
    result = await scrapeWebsite(source.sourceUrl);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Scrape failed';
    await db
      .update(brandBibleSources)
      .set({
        status: 'failed',
        errorMessage: message,
        updatedAt: new Date(),
      })
      .where(eq(brandBibleSources.id, id));
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }

  // The scraper itself never throws; it stuffs errors into
  // result.error. We treat that the same as a thrown error from the
  // caller's perspective.
  if (result.error) {
    await db
      .update(brandBibleSources)
      .set({
        status: 'failed',
        errorMessage: result.error,
        updatedAt: new Date(),
      })
      .where(eq(brandBibleSources.id, id));
    return NextResponse.json(
      { success: false, error: result.error },
      { status: 400 }
    );
  }

  await db
    .update(brandBibleSources)
    .set({
      status: 'analyzed',
      analysisResult: result,
      lastAnalyzedAt: new Date(),
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(brandBibleSources.id, id));

  return NextResponse.json({ success: true, result });
}
