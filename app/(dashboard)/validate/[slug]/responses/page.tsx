import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  waitlistPages,
  waitlistResponses,
  projects,
} from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { redirect, notFound } from 'next/navigation';
import type { TemplateConfig } from '@/lib/validate/defaults';
import type { SurveyAnalysis } from '../survey-analysis-panel';
import { ResponsesClient } from './client';

export default async function ResponsesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Authorize: page must belong to a project owned by the user
  const [page] = await db
    .select({
      id: waitlistPages.id,
      slug: waitlistPages.slug,
      title: waitlistPages.title,
      template: waitlistPages.template,
      templateConfig: waitlistPages.templateConfig,
      surveyAnalysis: waitlistPages.surveyAnalysis,
      projectUserId: projects.userId,
    })
    .from(waitlistPages)
    .innerJoin(projects, eq(projects.id, waitlistPages.projectId))
    .where(eq(waitlistPages.slug, slug))
    .limit(1);

  if (!page) notFound();
  if (page.projectUserId !== user.id) notFound();

  const responses = await db
    .select()
    .from(waitlistResponses)
    .where(eq(waitlistResponses.waitlistPageId, page.id))
    .orderBy(desc(waitlistResponses.createdAt));

  return (
    <ResponsesClient
      slug={page.slug}
      title={page.title}
      template={page.template ?? 'minimal'}
      templateConfig={(page.templateConfig as TemplateConfig | null) ?? null}
      surveyAnalysis={
        (page.surveyAnalysis as SurveyAnalysis | null) ?? null
      }
      responses={responses.map((r) => ({
        id: r.id,
        email: r.email,
        responses: r.responses as Record<string, unknown> | null,
        createdAt: r.createdAt,
      }))}
    />
  );
}
