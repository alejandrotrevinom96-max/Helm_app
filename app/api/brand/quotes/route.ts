import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { brandQuotes, projects } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { NextResponse } from 'next/server';

const MAX_CONTENT_LEN = 1000;
const MAX_TAGS = 10;

function sanitizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    .map((t) => t.trim().toLowerCase().slice(0, 40))
    .slice(0, MAX_TAGS);
}

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
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const quotes = await db
    .select()
    .from(brandQuotes)
    .where(eq(brandQuotes.projectId, projectId))
    .orderBy(desc(brandQuotes.createdAt));

  return NextResponse.json({ quotes });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { projectId, content, source, context, tags } = body as {
    projectId?: string;
    content?: string;
    source?: string;
    context?: string;
    tags?: unknown;
  };

  if (!projectId || !content || !content.trim()) {
    return NextResponse.json(
      { error: 'projectId and content required' },
      { status: 400 }
    );
  }
  if (content.length > MAX_CONTENT_LEN) {
    return NextResponse.json(
      { error: `Content too long (max ${MAX_CONTENT_LEN} chars)` },
      { status: 400 }
    );
  }

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const [created] = await db
    .insert(brandQuotes)
    .values({
      projectId,
      userId: user.id,
      content: content.trim(),
      source: source?.trim() || null,
      context: context?.trim() || null,
      tags: sanitizeTags(tags),
    })
    .returning();

  return NextResponse.json({ ok: true, quote: created });
}
