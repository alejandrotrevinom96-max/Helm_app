import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { integrations, projects } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { IntegrationsClient } from './client';

export default async function IntegrationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const userIntegrations = await db
    .select({ provider: integrations.provider, createdAt: integrations.createdAt })
    .from(integrations)
    .where(eq(integrations.userId, user.id));

  const userProjects = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(eq(projects.userId, user.id));

  return (
    <IntegrationsClient
      connected={userIntegrations.map((i) => i.provider)}
      projects={userProjects}
    />
  );
}
