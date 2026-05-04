import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { scheduledPosts } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';

const VALID_RATINGS = new Set(['worked', 'flopped']);

// Set or clear the founder feedback on a scheduled post. Passing
// rating=null (or omitting it) clears the rating + note. We only allow
// owner edits — never expose another user's feedback to API responses.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const { rating, note } = body as { rating?: unknown; note?: unknown };

  if (rating !== null && rating !== undefined) {
    if (typeof rating !== 'string' || !VALID_RATINGS.has(rating)) {
      return NextResponse.json({ error: 'Invalid rating' }, { status: 400 });
    }
  }

  const [post] = await db
    .select({ id: scheduledPosts.id })
    .from(scheduledPosts)
    .where(and(eq(scheduledPosts.id, id), eq(scheduledPosts.userId, user.id)))
    .limit(1);
  if (!post) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const safeRating =
    typeof rating === 'string' && VALID_RATINGS.has(rating) ? rating : null;
  const safeNote =
    typeof note === 'string' && note.trim().length > 0
      ? note.trim().slice(0, 500)
      : null;

  await db
    .update(scheduledPosts)
    .set({
      performanceRating: safeRating,
      performanceNote: safeRating ? safeNote : null,
      ratedAt: safeRating ? new Date() : null,
    })
    .where(eq(scheduledPosts.id, id));

  return NextResponse.json({ ok: true });
}
