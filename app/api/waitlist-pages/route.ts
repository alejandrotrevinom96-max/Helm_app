import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projects, waitlistPages } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { projectId, title, subtitle, slug } = await request.json();

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    const [page] = await db
      .insert(waitlistPages)
      .values({ projectId, title, subtitle, slug })
      .returning();
    return NextResponse.json(page);
  } catch (err) {
    return NextResponse.json({ error: 'Slug taken or invalid' }, { status: 400 });
  }
}
