import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projects, scheduledPosts } from '@/lib/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { NextResponse } from 'next/server';

const VALID_PLATFORMS = new Set(['instagram', 'facebook', 'linkedin', 'threads']);

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { projectId, platform, content, templateId, scheduledFor } =
    await request.json();

  if (!projectId || !platform || !content || !scheduledFor) {
    return NextResponse.json(
      { error: 'projectId, platform, content, scheduledFor are required' },
      { status: 400 }
    );
  }
  if (!VALID_PLATFORMS.has(platform)) {
    return NextResponse.json({ error: 'Invalid platform' }, { status: 400 });
  }

  // Anti-tampering: verify the project belongs to this user.
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const date = new Date(scheduledFor);
  if (isNaN(date.getTime())) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
  }
  if (date.getTime() <= Date.now()) {
    return NextResponse.json(
      { error: 'scheduledFor must be in the future' },
      { status: 400 }
    );
  }

  const [scheduled] = await db
    .insert(scheduledPosts)
    .values({
      userId: user.id,
      projectId,
      platform,
      content,
      templateUsed: templateId || null,
      scheduledFor: date,
    })
    .returning();

  return NextResponse.json(scheduled);
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('projectId');

  const where = projectId
    ? and(
        eq(scheduledPosts.userId, user.id),
        eq(scheduledPosts.projectId, projectId)
      )
    : eq(scheduledPosts.userId, user.id);

  const posts = await db
    .select()
    .from(scheduledPosts)
    .where(where)
    .orderBy(asc(scheduledPosts.scheduledFor));

  return NextResponse.json(posts);
}
