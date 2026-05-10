// PR #23 — Sprint 2.2: Library funcional.
//
// GET /api/marketing/library?projectId=…&status=…&platform=…&search=…
//
// Returns a unified `LibraryPost` shape collapsing two source tables:
//   - generated_posts (status='draft' rows that haven't been scheduled)
//   - scheduled_posts (status='scheduled' | 'posted' | 'cancelled')
//
// We can't UNION at the SQL level cleanly because the two tables have
// different columns (scheduled has visual + metrics + rating, drafts
// don't), so we issue both queries in parallel and merge in JS.
//
// CRITICAL: every query is double-scoped — by user.id (auth) AND
// project.id (current active project). Cross-project leakage is the
// bug the user reported wanting to never see again.
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  projects,
  generatedPosts,
  scheduledPosts,
} from '@/lib/db/schema';
import { eq, and, ilike, desc, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export type LibraryStatus = 'draft' | 'scheduled' | 'published' | 'cancelled';

export interface LibraryPost {
  id: string;
  // Discriminator: which source table this row came from. Front-end uses
  // it to decide whether the rating/metrics fields are editable.
  source: 'generated' | 'scheduled';
  projectId: string;
  status: LibraryStatus;
  platform: string;
  content: string;
  prompt: string | null;
  scheduledFor: string | null; // ISO; null for drafts
  publishedAt: string | null; // ISO; null unless status='published'
  visualUrl: string | null;
  performanceRating: string | null; // 'worked' | 'flopped' | 'not_sure' | null
  performanceNote: string | null;
  metricsImpressions: number | null;
  metricsLikes: number | null;
  metricsComments: number | null;
  metricsShares: number | null;
  consistencyScore: number | null;
  createdAt: string; // ISO
  // PR #29 — Sprint 5.1 publish lifecycle fields. Always null for
  // source='generated' (drafts don't publish). For source='scheduled'
  // these reflect Meta auto-publishing state from the cron worker.
  publishStatus: string | null; // null | 'pending' | 'publishing' | 'published' | 'failed'
  publishFailureReason: string | null;
  publishRetryCount: number;
  metaPermalink: string | null; // public URL on FB/IG once published
  metaPostId: string | null;
  // PR #30 — Sprint 5.2: Stories. isStory carries from generated_posts
  // for drafts and from scheduled_posts for everything else; the UI
  // uses it to badge cards and filter the "Stories" tab. storyExpiresAt
  // is null on drafts (set only when the publisher actually fires).
  isStory: boolean;
  storyExpiresAt: string | null;
  // PR #32 — Sprint 5.3: Reels. videoUrl is the public Supabase URL
  // (drafts AND scheduled). Other reel fields are scheduled-only.
  isReel: boolean;
  videoUrl: string | null;
  videoDurationSeconds: number | null;
  videoSizeBytes: number | null;
  reelProcessingStatus: string | null;
  reelProcessingError: string | null;
  // PR #48 — Sprint 6.7.6: surface vote state so the client can
  // verify a Like persisted server-side without an extra
  // round-trip. Always null for source='scheduled' (votes apply
  // to drafts only). Returned for source='generated' even when
  // null (unvoted) so the type is consistent.
  userVote: string | null;
  // PR #53 — Sprint 6.8.4: surface the vote timestamp too.
  // generated_posts.voted_at has existed since Sprint 6.7 and
  // the vote endpoint persists it on every Like/Hide, but the
  // Library route never mapped it — the founder's QA reported
  // "votedAt missing from DB" because they were inspecting the
  // API response, not the column directly. Always null for
  // scheduled rows (votes are draft-only).
  votedAt: string | null;
}

const VALID_STATUSES: LibraryStatus[] = [
  'draft',
  'scheduled',
  'published',
  'cancelled',
];

// Map our public Library status to the underlying scheduledPosts.status
// values. (We use 'published' externally; the table uses 'posted'.)
function scheduledStatusFor(s: LibraryStatus): string | null {
  if (s === 'scheduled') return 'scheduled';
  if (s === 'published') return 'posted';
  if (s === 'cancelled') return 'cancelled';
  return null; // 'draft' doesn't live in scheduled_posts
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('projectId');
  const statusRaw = (searchParams.get('status') ?? 'all') as
    | LibraryStatus
    | 'all';
  const platform = searchParams.get('platform') ?? '';
  const search = searchParams.get('search') ?? '';
  // PR #30 — Sprint 5.2: filter by post type. 'story' isolates the
  // is_story=true rows; 'post' excludes them; '' / undefined returns
  // both (the default the Library tab uses).
  const typeRaw = searchParams.get('type') ?? '';
  // PR #32 — Sprint 5.3: 'reel' joins 'story' and 'post'. 'post' now
  // means "neither story nor reel" — the catchall regular feed type.
  const typeFilter: 'story' | 'post' | 'reel' | null =
    typeRaw === 'story'
      ? 'story'
      : typeRaw === 'reel'
        ? 'reel'
        : typeRaw === 'post'
          ? 'post'
          : null;
  // PR #43 — Sprint 6.7.1: opt-in filter for drafts the user has
  // explicitly liked (userVote='liked'). The Calendar drafts pool
  // uses likedOnly=true so it surfaces only the "schedulable"
  // queue; the Library page leaves it false so unvoted drafts
  // are still browsable.
  const likedOnly = searchParams.get('likedOnly') === 'true';

  if (!projectId) {
    return NextResponse.json(
      { error: 'projectId required' },
      { status: 400 }
    );
  }

  // Strict scope: confirm the project belongs to this user before
  // returning anything. This is the gate that prevents cross-project
  // leakage even if the front-end accidentally sends someone else's
  // projectId.
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const wantStatus: LibraryStatus | 'all' =
    statusRaw === 'all' ||
    (VALID_STATUSES as string[]).includes(statusRaw)
      ? statusRaw
      : 'all';

  // ---- DRAFTS (generated_posts) -------------------------------------
  // Only included when status='all' or 'draft'. Drafts have no
  // scheduledFor / publishedAt / metrics — we fill those with null.
  let drafts: LibraryPost[] = [];
  if (wantStatus === 'all' || wantStatus === 'draft') {
    const draftFilters = [
      eq(generatedPosts.projectId, projectId),
      eq(generatedPosts.status, 'draft'),
      // PR #42 — Sprint 6.7: hide soft-deleted (disliked) drafts.
      // visibleInLibrary defaults true for legacy rows + new
      // unvoted drafts; flips to false when the user dislikes a
      // draft from the generate page voting UI.
      eq(generatedPosts.visibleInLibrary, true),
    ];
    if (likedOnly) {
      draftFilters.push(eq(generatedPosts.userVote, 'liked'));
    }
    if (platform) {
      draftFilters.push(eq(generatedPosts.platform, platform));
    }
    if (search) {
      draftFilters.push(ilike(generatedPosts.content, `%${search}%`));
    }
    if (typeFilter === 'story') {
      draftFilters.push(eq(generatedPosts.isStory, true));
    } else if (typeFilter === 'reel') {
      draftFilters.push(eq(generatedPosts.isReel, true));
    } else if (typeFilter === 'post') {
      draftFilters.push(eq(generatedPosts.isStory, false));
      draftFilters.push(eq(generatedPosts.isReel, false));
    }
    const draftRows = await db
      .select()
      .from(generatedPosts)
      .where(and(...draftFilters))
      .orderBy(desc(generatedPosts.createdAt));

    drafts = draftRows.map((r) => ({
      id: r.id,
      source: 'generated' as const,
      projectId: r.projectId,
      status: 'draft' as const,
      platform: r.platform,
      content: r.content,
      prompt: r.prompt,
      scheduledFor: null,
      publishedAt: null,
      // PR #43 — Sprint 6.7.1: drafts now persist their visual
      // (PR #42 only persisted the row; pre-PR-43 the visualUrl
      // column on generated_posts didn't exist and we hardcoded
      // null here). Surfacing the column lets refreshed Library
      // rows + Drafts pool chips keep their image.
      visualUrl: r.imageUrl ?? null,
      performanceRating: null,
      performanceNote: null,
      metricsImpressions: null,
      metricsLikes: null,
      metricsComments: null,
      metricsShares: null,
      consistencyScore: null,
      createdAt: r.createdAt.toISOString(),
      publishStatus: null,
      publishFailureReason: null,
      publishRetryCount: 0,
      metaPermalink: null,
      metaPostId: null,
      isStory: r.isStory ?? false,
      storyExpiresAt: null,
      isReel: r.isReel ?? false,
      videoUrl: r.videoUrl ?? null,
      videoDurationSeconds: null,
      videoSizeBytes: null,
      reelProcessingStatus: null,
      reelProcessingError: null,
      // PR #48 — Sprint 6.7.6: surface vote state.
      userVote: r.userVote ?? null,
      // PR #53 — Sprint 6.8.4: surface vote timestamp.
      votedAt: r.votedAt?.toISOString() ?? null,
    }));
  }

  // ---- SCHEDULED / PUBLISHED / CANCELLED (scheduled_posts) ----------
  let scheduled: LibraryPost[] = [];
  if (wantStatus !== 'draft') {
    const schedFilters = [
      eq(scheduledPosts.userId, user.id),
      eq(scheduledPosts.projectId, projectId),
    ];
    if (wantStatus === 'all') {
      // Show all 3 lifecycle stages from scheduled_posts; we discard
      // 'notified' here since the user thinks of it as either still
      // scheduled or already posted depending on how we follow up.
      schedFilters.push(
        sql`${scheduledPosts.status} IN ('scheduled', 'notified', 'posted', 'cancelled')`
      );
    } else {
      const mapped = scheduledStatusFor(wantStatus);
      if (mapped) schedFilters.push(eq(scheduledPosts.status, mapped));
    }
    if (platform) {
      schedFilters.push(eq(scheduledPosts.platform, platform));
    }
    if (search) {
      schedFilters.push(ilike(scheduledPosts.content, `%${search}%`));
    }
    if (typeFilter === 'story') {
      schedFilters.push(eq(scheduledPosts.isStory, true));
    } else if (typeFilter === 'reel') {
      schedFilters.push(eq(scheduledPosts.isReel, true));
    } else if (typeFilter === 'post') {
      schedFilters.push(eq(scheduledPosts.isStory, false));
      schedFilters.push(eq(scheduledPosts.isReel, false));
    }

    const schedRows = await db
      .select()
      .from(scheduledPosts)
      .where(and(...schedFilters))
      .orderBy(desc(scheduledPosts.createdAt));

    scheduled = schedRows.map((r): LibraryPost => {
      const status: LibraryStatus =
        r.status === 'posted' || r.status === 'notified'
          ? 'published'
          : r.status === 'cancelled'
            ? 'cancelled'
            : 'scheduled';
      return {
        id: r.id,
        source: 'scheduled',
        projectId: r.projectId,
        status,
        platform: r.platform,
        content: r.content,
        prompt: null,
        scheduledFor: r.scheduledFor.toISOString(),
        publishedAt:
          r.publishedAt?.toISOString() ??
          r.postedAt?.toISOString() ??
          null,
        visualUrl: r.visualUrl ?? null,
        performanceRating: r.performanceRating ?? null,
        performanceNote: r.performanceNote ?? null,
        metricsImpressions: r.metricsImpressions ?? null,
        metricsLikes: r.metricsLikes ?? null,
        metricsComments: r.metricsComments ?? null,
        metricsShares: r.metricsShares ?? null,
        consistencyScore: r.consistencyScore ?? null,
        createdAt: r.createdAt.toISOString(),
        publishStatus: r.publishStatus ?? null,
        publishFailureReason: r.publishFailureReason ?? null,
        publishRetryCount: r.publishRetryCount ?? 0,
        metaPermalink: r.metaPermalink ?? null,
        metaPostId: r.metaPostId ?? null,
        isStory: r.isStory ?? false,
        storyExpiresAt: r.storyExpiresAt?.toISOString() ?? null,
        isReel: r.isReel ?? false,
        videoUrl: r.videoUrl ?? null,
        videoDurationSeconds: r.videoDurationSeconds ?? null,
        videoSizeBytes: r.videoSizeBytes ?? null,
        reelProcessingStatus: r.reelProcessingStatus ?? null,
        reelProcessingError: r.reelProcessingError ?? null,
        // PR #48 — votes are draft-only; scheduled rows always
        // null here. Including the field keeps the LibraryPost
        // shape consistent across both source branches.
        userVote: null,
        votedAt: null,
      };
    });
  }

  // Merge + sort by createdAt desc. We don't paginate yet — typical
  // usage is dozens of posts, not thousands.
  const merged = [...drafts, ...scheduled].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0
  );

  return NextResponse.json({ posts: merged });
}
