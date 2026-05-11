// PR #42 — Sprint 6.7: batch schedule.
//
// POST /api/marketing/posts/schedule-batch
// Body: { posts: [{ id, scheduledAt }, ...] }
//
// Schedules N draft IDs at the times provided. Used by the
// generate page's new "Schedule N liked" flow:
//   - Golden times mode: client distributes 1 per day starting
//     tomorrow at 09:00 local.
//   - Custom mode: client supplies a single ISO timestamp the
//     server applies to every draft.
//
// Each insert into scheduled_posts pulls the draft's content +
// platform from generated_posts so the client doesn't have to
// re-send (and can't tamper with) those fields. Ownership is
// enforced via project → user join, same pattern as the vote
// endpoint.
import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  generatedPosts,
  projects,
  scheduledPosts,
} from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';

const MAX_BATCH = 30;

interface BatchEntry {
  id: string;
  scheduledAt: string; // ISO
}

function isBatchEntry(x: unknown): x is BatchEntry {
  if (!x || typeof x !== 'object') return false;
  const e = x as Record<string, unknown>;
  return typeof e.id === 'string' && typeof e.scheduledAt === 'string';
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const posts = body?.posts;

  if (!Array.isArray(posts) || posts.length === 0) {
    return NextResponse.json(
      { error: 'posts array is required' },
      { status: 400 }
    );
  }
  if (posts.length > MAX_BATCH) {
    return NextResponse.json(
      { error: `Batch too large (max ${MAX_BATCH})` },
      { status: 400 }
    );
  }
  if (!posts.every(isBatchEntry)) {
    return NextResponse.json(
      { error: 'Each post must have id and scheduledAt' },
      { status: 400 }
    );
  }

  // Validate all timestamps parse + are in the future. We accept
  // "now-ish" (within the last 60s) to avoid clock skew errors at
  // submission time.
  const now = Date.now();
  const SKEW_MS = 60 * 1000;
  const parsedTimes: Date[] = [];
  for (const p of posts) {
    const t = new Date(p.scheduledAt);
    if (Number.isNaN(t.getTime())) {
      return NextResponse.json(
        { error: `Invalid scheduledAt: ${p.scheduledAt}` },
        { status: 400 }
      );
    }
    if (t.getTime() < now - SKEW_MS) {
      return NextResponse.json(
        { error: 'scheduledAt must be in the future' },
        { status: 400 }
      );
    }
    parsedTimes.push(t);
  }

  // Pull every requested draft scoped to the user via project
  // ownership. Anything missing means the user supplied a foreign
  // / fake / deleted id; refuse the whole batch (atomic UX
  // expectation: either all scheduled or none).
  const ids = posts.map((p) => p.id);
  const owned = await db
    .select({
      id: generatedPosts.id,
      projectId: generatedPosts.projectId,
      platform: generatedPosts.platform,
      content: generatedPosts.content,
      isStory: generatedPosts.isStory,
      isReel: generatedPosts.isReel,
      videoUrl: generatedPosts.videoUrl,
      // PR #63 — Sprint 7.0.6: propagate the structured-draft
      // metadata so Library/Calendar badges + the future
      // Sprint-7.0.7 publisher dispatch all read the same source.
      contentType: generatedPosts.contentType,
      structuredContent: generatedPosts.structuredContent,
      // PR #65 — Sprint 7.0.8: carry carousel slide images.
      visualUrls: generatedPosts.visualUrls,
    })
    .from(generatedPosts)
    .innerJoin(projects, eq(projects.id, generatedPosts.projectId))
    .where(
      and(inArray(generatedPosts.id, ids), eq(projects.userId, user.id))
    );

  if (owned.length !== ids.length) {
    return NextResponse.json(
      { error: 'One or more drafts not found or not owned' },
      { status: 404 }
    );
  }

  const byId = new Map(owned.map((d) => [d.id, d]));
  const inserts = posts.map((p, idx) => {
    const d = byId.get(p.id)!;
    return {
      userId: user.id,
      projectId: d.projectId,
      platform: d.platform,
      content: d.content,
      scheduledFor: parsedTimes[idx],
      // Carry the Story / Reel flags forward so the publisher
      // (when Meta App Review eventually unblocks) gets the
      // intent the user originally chose at generate time.
      isStory: d.isStory,
      isReel: d.isReel,
      videoUrl: d.videoUrl,
      // PR #63 — Sprint 7.0.6: copy contentType + structuredContent
      // so the badge/format work from Sprint 7.0.5 has data on the
      // scheduled side. Null for legacy pillar-variant drafts.
      contentType: d.contentType,
      structuredContent: d.structuredContent ?? null,
      // PR #65 — Sprint 7.0.8: carry slide image URLs for carousels.
      visualUrls: (d.visualUrls as string[] | null) ?? null,
    };
  });

  await db.insert(scheduledPosts).values(inserts);

  // PR #43 — Sprint 6.7.1: flip the source draft's status to
  // 'scheduled' so it stops appearing in the Library Drafts tab
  // and the Calendar drafts pool. Pre-PR-43 we left status='draft'
  // and the row showed up in BOTH "Drafts" and "Scheduled" — the
  // founder reported this as duplicate posts in Library. The
  // scheduled_post itself is the authoritative copy from now on
  // (it carries the scheduledFor + auto-publish lifecycle); the
  // generated_post sticks around for analytics + clone-and-remix.
  await db
    .update(generatedPosts)
    .set({ status: 'scheduled' })
    .where(inArray(generatedPosts.id, ids));

  // PR #46 — Sprint 6.7.4: invalidate Library + Calendar caches.
  // Library Drafts tab loses N rows; Calendar gains N posts on
  // their respective scheduled days; Calendar drafts pool loses
  // N entries. All three paths need a cache bust.
  revalidatePath('/marketing/library');
  revalidatePath('/marketing/calendar');

  return NextResponse.json({ success: true, count: inserts.length });
}
