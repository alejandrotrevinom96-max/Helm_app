import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { generatedPosts } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { getActiveProject } from '@/lib/active-project';
import { MarketingClient } from './client';

export default async function MarketingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const project = await getActiveProject(user.id);
  if (!project) redirect('/onboarding');

  const recentPosts = await db
    .select()
    .from(generatedPosts)
    .where(eq(generatedPosts.projectId, project.id))
    .orderBy(desc(generatedPosts.createdAt))
    .limit(10);

  return <MarketingClient project={project} recentPosts={recentPosts} />;
}
