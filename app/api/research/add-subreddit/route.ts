// PR #59 — Sprint 7.0.3: founder manually adds a subreddit to monitor.
//
// We treat this as the "I know what I want" companion to /discover.
// Opt-in is required (the cron/scan would otherwise email about
// posts the founder never explicitly approved Reddit for).
//
// Source identifier convention: `r/<lowercase>` so the same string
// matches whether the founder typed "r/SoloFemaleTravelers" or
// "/r/solofemaletravelers" or just "solofemaletravelers".
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  projects,
  projectSources,
  sourceDirectory,
  researchConfig,
} from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sanitizeSubreddit(input: string): string {
  return input
    .replace(/^https?:\/\/(www\.)?reddit\.com\//i, '')
    .replace(/^\/?r\//i, '')
    .replace(/\/.*$/, '') // strip any trailing path
    .replace(/[^a-z0-9_]/gi, '')
    .toLowerCase()
    .trim();
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { projectId?: string; subreddit?: string };
  try {
    body = (await request.json()) as {
      projectId?: string;
      subreddit?: string;
    };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { projectId, subreddit } = body;
  if (!projectId || !UUID_RE.test(projectId)) {
    return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 });
  }
  if (!subreddit || typeof subreddit !== 'string') {
    return NextResponse.json(
      { error: 'Subreddit name required' },
      { status: 400 },
    );
  }

  const cleaned = sanitizeSubreddit(subreddit);
  if (!cleaned || cleaned.length < 2 || cleaned.length > 50) {
    return NextResponse.json(
      {
        error:
          'Invalid subreddit name. Use letters, numbers, underscores (2-50 chars).',
      },
      { status: 400 },
    );
  }

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) {
    return NextResponse.json(
      { error: 'Project not found or forbidden' },
      { status: 403 },
    );
  }

  const [config] = await db
    .select({ optin: researchConfig.redditRssOptin })
    .from(researchConfig)
    .where(eq(researchConfig.projectId, projectId))
    .limit(1);

  if (!config?.optin) {
    return NextResponse.json(
      {
        error: 'Reddit RSS opt-in required first',
        action: 'opt-in',
      },
      { status: 400 },
    );
  }

  // Identifier shape matches what fetchSubredditRSS expects (just the
  // raw name) but we display the r/ prefix.
  const identifier = cleaned;
  const displayName = `r/${cleaned}`;

  let [source] = await db
    .select()
    .from(sourceDirectory)
    .where(
      and(
        eq(sourceDirectory.platform, 'reddit'),
        eq(sourceDirectory.identifier, identifier),
      ),
    )
    .limit(1);

  if (!source) {
    const inserted = await db
      .insert(sourceDirectory)
      .values({
        platform: 'reddit',
        identifier,
        displayName,
        url: `https://www.reddit.com/r/${cleaned}/`,
        memberCount: null,
        activityLevel: null,
        language: null,
        description: null,
        metadata: { manuallyAdded: true },
        lastVerified: new Date(),
      })
      .onConflictDoNothing({
        target: [sourceDirectory.platform, sourceDirectory.identifier],
      })
      .returning();
    if (inserted.length > 0) {
      source = inserted[0];
    } else {
      // Conflict — fetch it.
      const [refetched] = await db
        .select()
        .from(sourceDirectory)
        .where(
          and(
            eq(sourceDirectory.platform, 'reddit'),
            eq(sourceDirectory.identifier, identifier),
          ),
        )
        .limit(1);
      if (!refetched) {
        return NextResponse.json(
          { error: 'Failed to create source row' },
          { status: 500 },
        );
      }
      source = refetched;
    }
  }

  // Idempotent: if already connected, surface that fact; otherwise
  // flip to connected (including reviving a previously-skipped row).
  const [existing] = await db
    .select()
    .from(projectSources)
    .where(
      and(
        eq(projectSources.projectId, projectId),
        eq(projectSources.sourceId, source.id),
      ),
    )
    .limit(1);

  if (existing) {
    if (existing.status === 'connected') {
      return NextResponse.json({
        success: true,
        alreadyConnected: true,
        source: { id: source.id, displayName: source.displayName },
      });
    }
    await db
      .update(projectSources)
      .set({ status: 'connected', connectedAt: new Date() })
      .where(eq(projectSources.id, existing.id));
  } else {
    await db.insert(projectSources).values({
      projectId,
      userId: user.id,
      sourceId: source.id,
      status: 'connected',
      connectedAt: new Date(),
      signalScore: 50,
    });
  }

  return NextResponse.json({
    success: true,
    source: {
      id: source.id,
      identifier: source.identifier,
      displayName: source.displayName,
      url: source.url,
    },
  });
}
