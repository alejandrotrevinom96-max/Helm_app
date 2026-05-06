// PR #23 — Sprint 2.2.
//
// POST /api/marketing/library/[id]/clone
//
// "Clone & remix" — duplicates a Library post into a fresh draft so the
// founder can riff on what worked. The clone is always a draft (no
// scheduling carries over) and lives in generated_posts. We track the
// original via cloned_from_id (no FK because the source can be either
// generated_posts OR scheduled_posts).
//
// Body:    { sourceTable?: 'generated' | 'scheduled' }  (defaults to 'scheduled')
// Returns: { success: true, post: { id, content, platform, ... } }
//
// The front-end then redirects to /marketing/generate and pre-fills the
// composer with the cloned content via the response payload.
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  projects,
  generatedPosts,
  scheduledPosts,
} from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const sourceTable: 'generated' | 'scheduled' =
    body?.sourceTable === 'generated' ? 'generated' : 'scheduled';

  // Pull the original. Each branch enforces ownership: scheduled_posts
  // has user_id directly, generated_posts goes through projects.
  let originalContent: string;
  let originalPlatform: string;
  let originalProjectId: string;

  if (sourceTable === 'scheduled') {
    const [orig] = await db
      .select({
        content: scheduledPosts.content,
        platform: scheduledPosts.platform,
        projectId: scheduledPosts.projectId,
      })
      .from(scheduledPosts)
      .where(
        and(eq(scheduledPosts.id, id), eq(scheduledPosts.userId, user.id))
      )
      .limit(1);
    if (!orig) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    originalContent = orig.content;
    originalPlatform = orig.platform;
    originalProjectId = orig.projectId;
  } else {
    // generated_posts has no user_id — we verify via the parent project.
    const [orig] = await db
      .select({
        content: generatedPosts.content,
        platform: generatedPosts.platform,
        projectId: generatedPosts.projectId,
      })
      .from(generatedPosts)
      .innerJoin(projects, eq(projects.id, generatedPosts.projectId))
      .where(
        and(eq(generatedPosts.id, id), eq(projects.userId, user.id))
      )
      .limit(1);
    if (!orig) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    originalContent = orig.content;
    originalPlatform = orig.platform;
    originalProjectId = orig.projectId;
  }

  const [cloned] = await db
    .insert(generatedPosts)
    .values({
      projectId: originalProjectId,
      platform: originalPlatform,
      content: originalContent,
      prompt: '(clone)',
      status: 'draft',
      clonedFromId: id,
    })
    .returning();

  return NextResponse.json({
    success: true,
    post: {
      id: cloned.id,
      content: cloned.content,
      platform: cloned.platform,
      projectId: cloned.projectId,
    },
  });
}
