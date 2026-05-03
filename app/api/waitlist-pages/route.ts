import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projects, waitlistPages } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getDefaultConfig } from '@/lib/validate/defaults';
import { NextResponse } from 'next/server';

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
