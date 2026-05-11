import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getActiveProject } from '@/lib/active-project';
import { WebhooksConfig } from './webhooks-config';
import { VisualsStatus } from './visuals-status';
import { WeeklyBriefConfig } from './weekly-brief-config';

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Sprint 7.0.2: WeeklyBriefConfig's "Send test now" button needs a
  // projectId to target. We resolve it server-side so the client
  // doesn't have to do a second fetch.
  const activeProject = await getActiveProject(user.id);

  return (
    <div className="p-6 md:p-10 max-w-3xl">
      <h1 className="font-display text-display-lg font-light tracking-tight mb-2">
        Settings
      </h1>
      <p className="text-text-2 mb-8">Account configuration and integrations.</p>

      <div className="space-y-6">
        <WeeklyBriefConfig projectId={activeProject?.id ?? null} />
        <WebhooksConfig />
        <VisualsStatus />
      </div>
    </div>
  );
}
