import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getActiveProject } from '@/lib/active-project';
import { WebhooksConfig } from './webhooks-config';
import { VisualsStatus } from './visuals-status';
import { WeeklyBriefConfig } from './weekly-brief-config';
import { HeygenAvatarConfig } from './heygen-avatar-config';
import { DeleteProjectSection } from './delete-project-section';

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
        {/* PR #86 — Sprint 7.10: Video Avatar settings. Requires a
            project context to read/save the per-project avatar
            choice. We hide the card entirely when there's no
            active project (typical for users mid-onboarding) so
            the empty state doesn't surface a saveable form with
            nowhere to write to. */}
        {activeProject && (
          <HeygenAvatarConfig
            projectId={activeProject.id}
            userId={user.id}
          />
        )}

        {/* PR Sprint 7.19 — Danger Zone. Always last on the page
            so destructive actions are visually separated from
            the regular configuration cards. Only rendered when
            an active project exists; without one there's
            nothing to delete. */}
        {activeProject && (
          <DeleteProjectSection
            projectId={activeProject.id}
            projectName={activeProject.name}
          />
        )}
      </div>
    </div>
  );
}
