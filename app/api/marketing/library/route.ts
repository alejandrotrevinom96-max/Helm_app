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
    ];
    if (platform) {
      draftFilters.push(eq(generatedPosts.platform, platform));
    }
    if (search) {
      draftFilters.push(ilike(generatedPosts.content, `%${search}%`));
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
      visualUrl: null,
      performanceRating: null,
      performanceNote: null,
      metricsImpressions: null,
      metricsLikes: null,
      metricsComments: null,
      metricsShares: null,
      consistencyScore: null,
      createdAt: r.createdAt.toISOString(),
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
        publishedAt: r.postedAt?.toISOString() ?? null,
        visualUrl: r.visualUrl ?? null,
        performanceRating: r.performanceRating ?? null,
        performanceNote: r.performanceNote ?? null,
        metricsImpressions: r.metricsImpressions ?? null,
        metricsLikes: r.metricsLikes ?? null,
        metricsComments: r.metricsComments ?? null,
        metricsShares: r.metricsShares ?? null,
        consistencyScore: r.consistencyScore ?? null,
        createdAt: r.createdAt.toISOString(),
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
