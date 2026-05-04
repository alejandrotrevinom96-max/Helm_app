import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { brandQuotes } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const { content, source, context, tags } = body as {
    content?: string;
    source?: string;
    context?: string;
    tags?: unknown;
  };

  const [existing] = await db
    .select()
    .from(brandQuotes)
    .where(and(eq(brandQuotes.id, id), eq(brandQuotes.userId, user.id)))
    .limit(1);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (content !== undefined && content.length > MAX_CONTENT_LEN) {
    return NextResponse.json(
      { error: `Content too long (max ${MAX_CONTENT_LEN} chars)` },
      { status: 400 }
    );
  }

  await db
    .update(brandQuotes)
    .set({
      content: content?.trim() ?? existing.content,
      source: source !== undefined ? source.trim() || null : existing.source,
      context: context !== undefined ? context.trim() || null : existing.context,
      tags: tags !== undefined ? sanitizeTags(tags) : existing.tags,
      updatedAt: new Date(),
    })
    .where(eq(brandQuotes.id, id));

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const [existing] = await db
    .select({ id: brandQuotes.id })
    .from(brandQuotes)
    .where(and(eq(brandQuotes.id, id), eq(brandQuotes.userId, user.id)))
    .limit(1);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await db
    .delete(brandQuotes)
    .where(and(eq(brandQuotes.id, id), eq(brandQuotes.userId, user.id)));

  return NextResponse.json({ ok: true });
}
