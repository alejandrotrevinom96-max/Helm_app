// PR #24 — Sprint 2.3: Calendar funcional.
//
// GET /api/marketing/calendar?projectId=…&startDate=…&endDate=…&platform=…
//
// Returns scheduled_posts whose `scheduled_for` falls inside the given
// window. Drafts (generated_posts) are intentionally excluded — they
// have no date so they can't appear on a calendar grid. The Library
// view is where founders see drafts.
//
// Strict scoping: `userId` (auth) AND `projectId` (active project)
// must both match. Even with a forged URL the founder can never read
// another user's posts.
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projects, scheduledPosts } from '@/lib/db/schema';
import { eq, and, gte, lte, asc } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export interface CalendarPost {
  id: string;
  source: 'scheduled';
  projectId: string;
  status: string; // 'scheduled' | 'notified' | 'posted' | 'cancelled'
  platform: string;
  content: string;
  scheduledFor: string; // ISO
  visualUrl: string | null;
  consistencyScore: number | null;
  // PR #29 — Sprint 5.1 publish lifecycle. Calendar chips show a
  // small ✓ on success and ⚠ on failure so the user spots problems
  // at a glance without opening each post.
  publishStatus: string | null;
  // PR #30 — Sprint 5.2: Stories. Calendar chips render a 📸 marker
  // when isStory is true so the user spots them on the grid.
  isStory: boolean;
  storyExpiresAt: string | null;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('projectId');
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');
  const platform = searchParams.get('platform') ?? '';

  if (!projectId) {
    return NextResponse.json(
      { error: 'projectId required' },
      { status: 400 }
    );
  }
  if (!startDate || !endDate) {
    return NextResponse.json(
      { error: 'startDate and endDate required' },
      { status: 400 }
    );
  }
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return NextResponse.json(
      { error: 'startDate / endDate must be valid ISO timestamps' },
      { status: 400 }
    );
  }

  // Confirm the project belongs to this user before returning data.
  // Same gate the Library endpoint uses — don't leak post counts to
  // a forged projectId.
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const filters = [
    eq(scheduledPosts.userId, user.id),
    eq(scheduledPosts.projectId, projectId),
    gte(scheduledPosts.scheduledFor, start),
    lte(scheduledPosts.scheduledFor, end),
  ];
  if (platform) {
    filters.push(eq(scheduledPosts.platform, platform));
  }

  const rows = await db
    .select()
    .from(scheduledPosts)
    .where(and(...filters))
    .orderBy(asc(scheduledPosts.scheduledFor));

  const posts: CalendarPost[] = rows.map((r) => ({
    id: r.id,
    source: 'scheduled' as const,
    projectId: r.projectId,
    status: r.status,
    platform: r.platform,
    content: r.content,
    scheduledFor: r.scheduledFor.toISOString(),
    visualUrl: r.visualUrl ?? null,
    consistencyScore: r.consistencyScore ?? null,
    publishStatus: r.publishStatus ?? null,
    isStory: r.isStory ?? false,
    storyExpiresAt: r.storyExpiresAt?.toISOString() ?? null,
  }));

  return NextResponse.json({ posts });
}
