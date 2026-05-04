import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getActiveProject, getAllUserProjects } from '@/lib/active-project';
import { GlassCard } from '@/components/ui/glass-card';
import { CompassClient } from './client';

export default async function CompassPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const project = await getActiveProject(user.id);
  const allProjects = await getAllUserProjects(user.id);

  if (!project) {
    return (
      <div className="p-6 md:p-10 max-w-3xl">
        <h1 className="font-display text-display-lg font-light tracking-tight mb-2">
          Compass
        </h1>
        <p className="text-text-2 mb-8">
          Score your project across 5 dimensions backed by VC research.
        </p>
        <GlassCard className="p-8 text-center">
          <p className="text-text-2">
            Create a project first to compute its compass reading.
          </p>
        </GlassCard>
      </div>
    );
  }

  return (
    <CompassClient
      project={{ id: project.id, name: project.name }}
      hasMultipleProjects={allProjects.length > 1}
    />
  );
}
