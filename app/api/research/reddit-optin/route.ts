// PR #59 — Sprint 7.0.3: Reddit RSS opt-in.
//
// Founder explicitly accepts the rate-limit / caching contract before
// any subreddit can be added. We upsert into research_config; the
// timestamp captures consent for traceability.
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projects, researchConfig } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { projectId?: string; optin?: unknown };
  try {
    body = (await request.json()) as { projectId?: string; optin?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { projectId } = body;
  if (!projectId || !UUID_RE.test(projectId)) {
    return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 });
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

  const optin = Boolean(body.optin);
  const [existing] = await db
    .select({ id: researchConfig.id })
    .from(researchConfig)
    .where(eq(researchConfig.projectId, projectId))
    .limit(1);

  if (existing) {
    await db
      .update(researchConfig)
      .set({
        redditRssOptin: optin,
        redditRssOptinAt: optin ? new Date() : null,
      })
      .where(eq(researchConfig.id, existing.id));
  } else {
    await db.insert(researchConfig).values({
      projectId,
      redditRssOptin: optin,
      redditRssOptinAt: optin ? new Date() : null,
    });
  }

  return NextResponse.json({ success: true, optin });
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId');
  if (!projectId || !UUID_RE.test(projectId)) {
    return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 });
  }

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [row] = await db
    .select({
      optin: researchConfig.redditRssOptin,
      optinAt: researchConfig.redditRssOptinAt,
    })
    .from(researchConfig)
    .where(eq(researchConfig.projectId, projectId))
    .limit(1);

  return NextResponse.json({
    optin: row?.optin ?? false,
    optinAt: row?.optinAt ?? null,
  });
}
