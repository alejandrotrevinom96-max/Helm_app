import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { researchFindings } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { getActiveProject } from '@/lib/active-project';
import { ResearchClient } from './client';

export default async function ResearchPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const project = await getActiveProject(user.id);
  if (!project) redirect('/onboarding');

  const findings = await db
    .select()
    .from(researchFindings)
    .where(eq(researchFindings.projectId, project.id))
    .orderBy(desc(researchFindings.matchScore))
    .limit(50);

  return <ResearchClient project={project} findings={findings} />;
}
