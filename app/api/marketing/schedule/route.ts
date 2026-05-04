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

// Edit a still-scheduled post: change content and/or scheduledFor.
// Only allowed while status is 'scheduled' — once cron flipped it to
// 'notified' the user has presumably already used the content.
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const { content, scheduledFor } = body as {
    content?: unknown;
    scheduledFor?: unknown;
  };

  const [post] = await db
    .select({ id: scheduledPosts.id })
    .from(scheduledPosts)
    .where(
      and(
        eq(scheduledPosts.id, id),
        eq(scheduledPosts.userId, user.id),
        eq(scheduledPosts.status, 'scheduled')
      )
    )
    .limit(1);
  if (!post) {
    return NextResponse.json(
      { error: 'Not found or not editable' },
      { status: 404 }
    );
  }

  const updates: { content?: string; scheduledFor?: Date } = {};
  if (content !== undefined) {
    if (typeof content !== 'string' || !content.trim()) {
      return NextResponse.json({ error: 'Content cannot be empty' }, { status: 400 });
    }
    updates.content = content.trim();
  }
  if (scheduledFor !== undefined) {
    if (typeof scheduledFor !== 'string') {
      return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
    }
    const date = new Date(scheduledFor);
    if (isNaN(date.getTime()) || date.getTime() <= Date.now()) {
      return NextResponse.json(
        { error: 'scheduledFor must be in the future' },
        { status: 400 }
      );
    }
    updates.scheduledFor = date;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid updates' }, { status: 400 });
  }

  await db.update(scheduledPosts).set(updates).where(eq(scheduledPosts.id, id));
  return NextResponse.json({ ok: true });
}

// Soft-delete a scheduled post (sets status='cancelled' so we keep history).
// Only the owner can cancel; we double-check with eq(userId, user.id).
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const [post] = await db
    .select({ id: scheduledPosts.id })
    .from(scheduledPosts)
    .where(and(eq(scheduledPosts.id, id), eq(scheduledPosts.userId, user.id)))
    .limit(1);
  if (!post) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await db
    .update(scheduledPosts)
    .set({ status: 'cancelled' })
    .where(eq(scheduledPosts.id, id));

  return NextResponse.json({ ok: true });
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
