// PR #26 — Sprint 3: Auto-Generate Brand Bible.
//
// DELETE /api/brand-bible/sources/[id]
//
// Removes a connected source. Used by the UI's "remove" button when
// the user wants to drop a website / channel from the analysis pool.
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { brandBibleSources } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await db
    .delete(brandBibleSources)
    .where(
      and(
        eq(brandBibleSources.id, id),
        eq(brandBibleSources.userId, user.id)
      )
    )
    .returning({ id: brandBibleSources.id });

  if (result.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
