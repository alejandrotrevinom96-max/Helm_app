import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { waitlistPages, projects } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import type { TemplateConfig } from '@/lib/validate/defaults';
import { NextResponse } from 'next/server';

const SLUG_LIMIT = 50; // upper bound on -copy-N attempts; defends against runaway loops

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  // Authorize via project ownership and pull the columns we need to copy.
  // Using db.select({...}) with explicit columns avoids the
  // {waitlist_pages: ..., projects: ...} nested shape from innerJoin.
  const [original] = await db
    .select({
      projectId: waitlistPages.projectId,
      slug: waitlistPages.slug,
      title: waitlistPages.title,
      subtitle: waitlistPages.subtitle,
      ctaText: waitlistPages.ctaText,
      template: waitlistPages.template,
      templateConfig: waitlistPages.templateConfig,
    })
    .from(waitlistPages)
    .innerJoin(projects, eq(projects.id, waitlistPages.projectId))
    .where(and(eq(waitlistPages.id, id), eq(projects.userId, user.id)))
    .limit(1);
  if (!original) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Find a free slug: original-slug-copy, -copy-2, -copy-3, ...
  // The slug column is globally unique so we have to query each candidate.
  const baseSlug = `${original.slug}-copy`;
  let newSlug = baseSlug;
  for (let n = 2; n <= SLUG_LIMIT; n++) {
    const exists = await db
      .select({ id: waitlistPages.id })
      .from(waitlistPages)
      .where(eq(waitlistPages.slug, newSlug))
      .limit(1);
    if (exists.length === 0) break;
    newSlug = `${baseSlug}-${n}`;
    if (n === SLUG_LIMIT) {
      return NextResponse.json(
        { error: 'Too many copies of this page' },
        { status: 400 }
      );
    }
  }

  const [created] = await db
    .insert(waitlistPages)
    .values({
      projectId: original.projectId,
      slug: newSlug,
      title: `${original.title} (copy)`,
      subtitle: original.subtitle,
      ctaText: original.ctaText,
      template: original.template,
      templateConfig: original.templateConfig as TemplateConfig | null,
      isActive: true,
    })
    .returning();

  return NextResponse.json(created);
}
