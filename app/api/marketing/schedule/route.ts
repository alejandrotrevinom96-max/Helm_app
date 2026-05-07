import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projects, scheduledPosts } from '@/lib/db/schema';
import { eq, and, asc, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';

const VALID_PLATFORMS = new Set([
  'instagram',
  'facebook',
  'linkedin',
  'threads',
  'reddit',
]);

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const {
    projectId,
    platform,
    content,
    templateId,
    scheduledFor,
    consistencyScore,
    scoreBreakdown,
    visualUrl,
    visualPrompt,
    isStory,
    // PR #32 — Sprint 5.3: Reel fields. videoUrl is the public Supabase
    // Storage URL the browser uploaded to; the metadata fields are
    // captured at upload time so the server can re-validate.
    isReel,
    videoUrl,
    videoDurationSeconds,
    videoSizeBytes,
    videoAspectRatio,
  } = await request.json();

  if (!projectId || !platform || !content || !scheduledFor) {
    return NextResponse.json(
      { error: 'projectId, platform, content, scheduledFor are required' },
      { status: 400 }
    );
  }
  if (!VALID_PLATFORMS.has(platform)) {
    return NextResponse.json({ error: 'Invalid platform' }, { status: 400 });
  }

  // PR #30 — Sprint 5.2: Stories validation. Server-side fail-safe;
  // the StoryToggle UI also enforces these but we never trust the
  // client. Image-dimension check stays client-only — that needs the
  // bytes, the schedule API doesn't have them.
  const wantsStory = isStory === true;
  const wantsReel = isReel === true;
  if (wantsStory) {
    if (platform !== 'instagram') {
      return NextResponse.json(
        {
          error:
            'Stories are only supported on Instagram. Uncheck "Post as Story" or change the platform.',
        },
        { status: 400 }
      );
    }
    if (!visualUrl || typeof visualUrl !== 'string') {
      return NextResponse.json(
        { error: 'Stories require an image. Add a visual before scheduling.' },
        { status: 400 }
      );
    }
  }

  // PR #32 — Sprint 5.3: Reels validation. Mutually exclusive with
  // Stories (a single post can't be both). videoUrl must be the
  // public Supabase URL Meta will fetch — duration / size / aspect
  // are stored as metadata for display + future filtering.
  const REELS_MAX_BYTES = 100 * 1024 * 1024;
  if (wantsReel) {
    if (wantsStory) {
      return NextResponse.json(
        { error: 'A post cannot be both a Story and a Reel.' },
        { status: 400 }
      );
    }
    if (platform !== 'instagram') {
      return NextResponse.json(
        {
          error:
            'Reels are only supported on Instagram. Uncheck "Post as Reel" or change the platform.',
        },
        { status: 400 }
      );
    }
    if (!videoUrl || typeof videoUrl !== 'string') {
      return NextResponse.json(
        { error: 'Reels require a video. Upload one before scheduling.' },
        { status: 400 }
      );
    }
    if (
      typeof videoDurationSeconds === 'number' &&
      (videoDurationSeconds < 3 || videoDurationSeconds > 90)
    ) {
      return NextResponse.json(
        { error: 'Reels must be between 3 and 90 seconds.' },
        { status: 400 }
      );
    }
    if (
      typeof videoSizeBytes === 'number' &&
      videoSizeBytes > REELS_MAX_BYTES
    ) {
      return NextResponse.json(
        { error: 'Reel video exceeds 100 MB limit.' },
        { status: 400 }
      );
    }
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

  // Score is stamped here from values the client computed at generate time.
  // Trusting the client is fine for telemetry — worst case the user inflates
  // their own score and the drift detector under-warns them.
  const safeScore =
    typeof consistencyScore === 'number' &&
    consistencyScore >= 0 &&
    consistencyScore <= 100
      ? Math.round(consistencyScore)
      : null;
  const safeBreakdown =
    scoreBreakdown && typeof scoreBreakdown === 'object'
      ? (scoreBreakdown as Record<string, number>)
      : null;

  const safeVisualUrl =
    typeof visualUrl === 'string' && visualUrl.length > 0 ? visualUrl : null;
  const safeVisualPrompt =
    typeof visualPrompt === 'string' && visualPrompt.length > 0
      ? visualPrompt
      : null;

  const [scheduled] = await db
    .insert(scheduledPosts)
    .values({
      userId: user.id,
      projectId,
      platform,
      content,
      templateUsed: templateId || null,
      scheduledFor: date,
      consistencyScore: safeScore,
      scoreBreakdown: safeBreakdown as never,
      visualUrl: safeVisualUrl,
      visualPrompt: safeVisualPrompt,
      visualType: safeVisualUrl ? 'image' : null,
      isStory: wantsStory,
      // PR #32 — Sprint 5.3: Reel persistence. reelProcessingStatus
      // starts as 'uploaded' (the file is in Supabase Storage and
      // ready) and the publisher will flip it to 'meta_processing'
      // when it creates the IG container.
      isReel: wantsReel,
      videoUrl: wantsReel && typeof videoUrl === 'string' ? videoUrl : null,
      videoDurationSeconds:
        wantsReel && typeof videoDurationSeconds === 'number'
          ? Math.round(videoDurationSeconds)
          : null,
      videoSizeBytes:
        wantsReel && typeof videoSizeBytes === 'number'
          ? videoSizeBytes
          : null,
      videoAspectRatio:
        wantsReel && typeof videoAspectRatio === 'number'
          ? videoAspectRatio.toFixed(4)
          : null,
      reelProcessingStatus: wantsReel ? 'uploaded' : null,
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
  const { content, scheduledFor, platform } = body as {
    content?: unknown;
    scheduledFor?: unknown;
    platform?: unknown;
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

  const updates: { content?: string; scheduledFor?: Date; platform?: string } = {};
  if (content !== undefined) {
    if (typeof content !== 'string' || !content.trim()) {
      return NextResponse.json({ error: 'Content cannot be empty' }, { status: 400 });
    }
    updates.content = content.trim();
  }
  if (platform !== undefined) {
    if (typeof platform !== 'string' || !VALID_PLATFORMS.has(platform)) {
      return NextResponse.json({ error: 'Invalid platform' }, { status: 400 });
    }
    updates.platform = platform;
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

// Soft-delete one or many scheduled posts (sets status='cancelled' so we
// keep history). Single mode: ?id=...  ·  Bulk mode: body { ids: [...] }.
// Both are owner-scoped; bulk is also gated to status='scheduled' so we
// don't accidentally cancel a post the cron already notified on.
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (id) {
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

  // Bulk mode: parse body for ids array.
  const body = await request.json().catch(() => ({}));
  const { ids } = body as { ids?: unknown };
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'ids array required' }, { status: 400 });
  }
  if (ids.length > 100) {
    return NextResponse.json({ error: 'Max 100 ids per request' }, { status: 400 });
  }
  const safeIds = ids.filter((x): x is string => typeof x === 'string');
  if (safeIds.length === 0) {
    return NextResponse.json({ error: 'No valid ids' }, { status: 400 });
  }

  await db
    .update(scheduledPosts)
    .set({ status: 'cancelled' })
    .where(
      and(
        inArray(scheduledPosts.id, safeIds),
        eq(scheduledPosts.userId, user.id),
        eq(scheduledPosts.status, 'scheduled')
      )
    );

  return NextResponse.json({ ok: true, count: safeIds.length });
}

// Bulk reschedule: PUT { ids: [...], scheduledFor: ISO }. Single edits keep
// using PATCH above. We only move posts that are still 'scheduled'.
export async function PUT(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { ids, scheduledFor } = body as {
    ids?: unknown;
    scheduledFor?: unknown;
  };

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'ids array required' }, { status: 400 });
  }
  if (ids.length > 100) {
    return NextResponse.json({ error: 'Max 100 ids per request' }, { status: 400 });
  }
  if (typeof scheduledFor !== 'string') {
    return NextResponse.json({ error: 'scheduledFor required' }, { status: 400 });
  }
  const date = new Date(scheduledFor);
  if (isNaN(date.getTime()) || date.getTime() <= Date.now()) {
    return NextResponse.json(
      { error: 'scheduledFor must be a valid future date' },
      { status: 400 }
    );
  }
  const safeIds = ids.filter((x): x is string => typeof x === 'string');
  if (safeIds.length === 0) {
    return NextResponse.json({ error: 'No valid ids' }, { status: 400 });
  }

  await db
    .update(scheduledPosts)
    .set({ scheduledFor: date })
    .where(
      and(
        inArray(scheduledPosts.id, safeIds),
        eq(scheduledPosts.userId, user.id),
        eq(scheduledPosts.status, 'scheduled')
      )
    );

  return NextResponse.json({ ok: true, count: safeIds.length });
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
