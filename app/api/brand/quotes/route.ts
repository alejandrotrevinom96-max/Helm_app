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

  // PR #49 — Sprint 6.8: kick a background voice-fingerprint
  // refresh after the quote lands. Best-effort: we don't await
  // the response, the cookie is forwarded so the analyze
  // endpoint authenticates as the same user, and any failure
  // is logged + non-fatal. If Vercel terminates the function
  // before the analyze completes, the founder can still
  // trigger it manually via `Re-analyze voice` (or just from
  // the next quote insert that fires this same path).
  triggerFingerprintRefresh(request, projectId);

  return NextResponse.json({ ok: true, quote: created });
}

function triggerFingerprintRefresh(request: Request, projectId: string) {
  const cookie = request.headers.get('cookie') ?? '';
  if (!cookie) return; // no auth context to forward — bail.
  const host = request.headers.get('host');
  // VERCEL_URL is set in production; fall back to the request
  // host so this works locally too.
  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ??
    (host ? `https://${host}` : null);
  if (!base) return;
  // Fire and forget. NOT awaited.
  fetch(`${base}/api/marketing/voice/analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify({ projectId }),
  }).catch((e) => {
    console.error(
      '[QUOTES] background fingerprint refresh failed (non-fatal):',
      e
    );
  });
}
