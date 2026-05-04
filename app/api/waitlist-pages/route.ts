import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projects, waitlistPages } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getDefaultConfig } from '@/lib/validate/defaults';
import { NextResponse } from 'next/server';

// Authorize a waitlist page id by joining through projects.userId. Returns
// the page row if the caller owns it, null otherwise.
async function findOwnedPage(pageId: string, userId: string) {
  const [row] = await db
    .select({
      id: waitlistPages.id,
      projectId: waitlistPages.projectId,
      slug: waitlistPages.slug,
      title: waitlistPages.title,
      subtitle: waitlistPages.subtitle,
      template: waitlistPages.template,
      templateConfig: waitlistPages.templateConfig,
    })
    .from(waitlistPages)
    .innerJoin(projects, eq(projects.id, waitlistPages.projectId))
    .where(and(eq(waitlistPages.id, pageId), eq(projects.userId, userId)))
    .limit(1);
  return row ?? null;
}

const VALID_TEMPLATES = new Set([
  'minimal',
  'beta-tester',
  'feature-vote',
  'pricing-test',
  'survey-5q',
]);

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { projectId, title, subtitle, slug, template, templateConfig } = body as {
    projectId?: string;
    title?: string;
    subtitle?: string;
    slug?: string;
    template?: string;
    templateConfig?: Record<string, unknown>;
  };

  if (!projectId || !title || !slug) {
    return NextResponse.json(
      { error: 'projectId, title, slug required' },
      { status: 400 }
    );
  }

  // Anti-tampering: project must belong to user
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const finalTemplate = template && VALID_TEMPLATES.has(template) ? template : 'minimal';
  // If the caller didn't include a templateConfig (or sent {}), seed from
  // the template's defaults so the public page renders with sensible content
  // out of the box.
  const finalConfig =
    templateConfig && Object.keys(templateConfig).length > 0
      ? templateConfig
      : getDefaultConfig(finalTemplate);

  try {
    const [page] = await db
      .insert(waitlistPages)
      .values({
        projectId,
        title,
        subtitle: subtitle || null,
        slug,
        template: finalTemplate,
        templateConfig: finalConfig,
      })
      .returning();
    return NextResponse.json(page);
  } catch (e) {
    console.error('[WAITLIST CREATE] failed', e);
    return NextResponse.json(
      { error: 'Slug taken or invalid' },
      { status: 400 }
    );
  }
}

// Edit a waitlist page (title / templateConfig / isActive). Slug is
// intentionally immutable so existing public URLs keep working.
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const owned = await findOwnedPage(id, user.id);
  if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await request.json();
  const { title, templateConfig, isActive } = body as {
    title?: unknown;
    templateConfig?: unknown;
    isActive?: unknown;
  };

  const updates: Record<string, unknown> = {};
  if (title !== undefined) {
    if (typeof title !== 'string' || !title.trim()) {
      return NextResponse.json({ error: 'title must be non-empty string' }, { status: 400 });
    }
    updates.title = title.trim();
  }
  if (templateConfig !== undefined) {
    if (typeof templateConfig !== 'object' || templateConfig === null) {
      return NextResponse.json({ error: 'templateConfig must be object' }, { status: 400 });
    }
    updates.templateConfig = templateConfig;
  }
  if (isActive !== undefined) {
    updates.isActive = !!isActive;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid updates' }, { status: 400 });
  }

  await db.update(waitlistPages).set(updates).where(eq(waitlistPages.id, id));
  return NextResponse.json({ ok: true });
}

// Soft-delete: flip isActive=false. Public page returns 404, dashboard list
// hides it. Keeps responses + signups intact for retrospective analysis.
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const owned = await findOwnedPage(id, user.id);
  if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await db
    .update(waitlistPages)
    .set({ isActive: false })
    .where(eq(waitlistPages.id, id));
  return NextResponse.json({ ok: true });
}
