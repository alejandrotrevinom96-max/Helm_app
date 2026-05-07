// PR #26 — Sprint 3: Auto-Generate Brand Bible.
//
// GET  /api/brand-bible/sources?projectId=…
// POST /api/brand-bible/sources
//
// GET returns every source connected for the active project.
// POST registers a new source row (status='pending'). For source
// types that need OAuth (everything except 'website') we return 501
// — the OAuth flow ships in Sprint 5 along with Meta integration.
//
// Strict scope: every query is double-gated by user_id (auth) AND
// the project's user_id (anti-tampering).
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { brandBibleSources, projects } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { NextResponse } from 'next/server';

const VALID_SOURCE_TYPES = new Set([
  'website',
  'facebook_page',
  'instagram_business',
  'linkedin',
  'twitter',
]);

// Only 'website' is wired up server-side today. Everything else
// returns 501 from POST until OAuth ships (Sprint 5).
const WEBSITE_ONLY = new Set(['website']);

async function requireProjectOwnership(
  userId: string,
  projectId: string
): Promise<boolean> {
  const [proj] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  return !!proj;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('projectId');
  if (!projectId) {
    return NextResponse.json(
      { error: 'projectId required' },
      { status: 400 }
    );
  }

  if (!(await requireProjectOwnership(user.id, projectId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const rows = await db
    .select()
    .from(brandBibleSources)
    .where(
      and(
        eq(brandBibleSources.userId, user.id),
        eq(brandBibleSources.projectId, projectId)
      )
    )
    .orderBy(desc(brandBibleSources.createdAt));

  // Strip access_token from the response — never expose it to the
  // client even though we own the row. The token is server-only.
  const sources = rows.map(({ accessToken: _, ...rest }) => rest);
  return NextResponse.json({ sources });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const {
    projectId,
    sourceType,
    sourceUrl,
    sourceHandle,
    sourceExternalId,
  } = body as {
    projectId?: string;
    sourceType?: string;
    sourceUrl?: string;
    sourceHandle?: string;
    sourceExternalId?: string;
  };

  if (!projectId || !sourceType) {
    return NextResponse.json(
      { error: 'projectId and sourceType required' },
      { status: 400 }
    );
  }

  if (!VALID_SOURCE_TYPES.has(sourceType)) {
    return NextResponse.json({ error: 'Invalid sourceType' }, { status: 400 });
  }

  if (!(await requireProjectOwnership(user.id, projectId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Non-website sources need OAuth (Sprint 5). Return 501 with a
  // helpful message rather than letting an unwired POST silently
  // succeed.
  if (!WEBSITE_ONLY.has(sourceType)) {
    return NextResponse.json(
      {
        error:
          'OAuth flow for this platform is not available yet — only "website" is wired up today.',
        comingSoon: true,
      },
      { status: 501 }
    );
  }

  // Website-specific validation.
  if (!sourceUrl || sourceUrl.trim().length === 0) {
    return NextResponse.json(
      { error: 'sourceUrl required for website sources' },
      { status: 400 }
    );
  }

  // Light URL validation — the scraper does the heavy lifting later.
  try {
    const candidate = sourceUrl.startsWith('http')
      ? sourceUrl
      : `https://${sourceUrl}`;
    new URL(candidate);
  } catch {
    return NextResponse.json(
      { error: 'sourceUrl is not a valid URL' },
      { status: 400 }
    );
  }

  const [created] = await db
    .insert(brandBibleSources)
    .values({
      userId: user.id,
      projectId,
      sourceType,
      sourceUrl: sourceUrl ?? null,
      sourceHandle: sourceHandle ?? null,
      sourceExternalId: sourceExternalId ?? null,
      status: 'pending',
    })
    .returning();

  // Don't echo the token (always null at create time).
  const { accessToken: _, ...safe } = created;
  return NextResponse.json({ success: true, source: safe });
}
