import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projects, researchConfig } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import {
  getDefaultSources,
  type SourcesConfig,
} from '@/lib/research/source-defaults';
import type { BrandBible } from '@/lib/types/brand';

interface DetectedStack {
  framework?: string;
  hasSupabase?: boolean;
  hasStripe?: boolean;
  hasMeta?: boolean;
}

function extractKeywordsFromStack(stack: DetectedStack | null | undefined): string[] {
  const keywords: string[] = [];
  if (!stack) return keywords;
  if (stack.framework && stack.framework !== 'unknown') keywords.push(stack.framework);
  if (stack.hasSupabase) keywords.push('supabase');
  if (stack.hasStripe) keywords.push('subscription pricing');
  return keywords.slice(0, 3);
}

const DEFAULT_SOURCES = {
  reddit: true,
  hackernews: true,
  indiehackers: true,
  googleTrends: true,
};

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('projectId');
  if (!projectId) {
    return NextResponse.json({ error: 'projectId required' }, { status: 400 });
  }

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const [existing] = await db
    .select()
    .from(researchConfig)
    .where(eq(researchConfig.projectId, projectId))
    .limit(1);

  if (existing) return NextResponse.json(existing);

  // Create with stack-derived keywords + audience-aware sources so the
  // user has something to scan with immediately rather than an empty form.
  // Audience-aware sources matter for non-tech projects: a travel app
  // shouldn't have Hacker News on by default, that just feeds it dev-tool
  // posts that have to be filtered out later.
  const defaultKeywords = extractKeywordsFromStack(
    project.detectedStack as DetectedStack | null
  );
  const defaultSources = getDefaultSources(
    project.brandContext as BrandBible | null
  );
  const [created] = await db
    .insert(researchConfig)
    .values({
      projectId,
      keywords: defaultKeywords,
      sources: defaultSources,
    })
    .returning();
  return NextResponse.json(created);
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { projectId, keywords, competitors, excludeWords, sources } = body as {
    projectId?: string;
    keywords?: string[];
    competitors?: string[];
    excludeWords?: string[];
    sources?: SourcesConfig;
  };

  if (!projectId) {
    return NextResponse.json({ error: 'projectId required' }, { status: 400 });
  }

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const updates: Record<string, unknown> = {};
  if (keywords !== undefined) updates.keywords = keywords;
  if (competitors !== undefined) updates.competitors = competitors;
  if (excludeWords !== undefined) updates.excludeWords = excludeWords;
  if (sources !== undefined) updates.sources = sources;

  const [existing] = await db
    .select()
    .from(researchConfig)
    .where(eq(researchConfig.projectId, projectId))
    .limit(1);

  let result;
  if (existing) {
    [result] = await db
      .update(researchConfig)
      .set(updates)
      .where(eq(researchConfig.projectId, projectId))
      .returning();
  } else {
    [result] = await db
      .insert(researchConfig)
      .values({ projectId, ...updates })
      .returning();
  }

  return NextResponse.json(result);
}
