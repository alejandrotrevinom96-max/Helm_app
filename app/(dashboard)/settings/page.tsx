import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getActiveProject } from '@/lib/active-project';
import { AmbientBackground } from '@/components/ui/ambient-background';
import { WebhooksConfig } from './webhooks-config';
import { VisualsStatus } from './visuals-status';
import { WeeklyBriefConfig } from './weekly-brief-config';
import { HeygenAvatarConfig } from './heygen-avatar-config';
import { DeleteProjectSection } from './delete-project-section';

// PR Sprint 7.25 Phase 2 — Platform redesign lands first on /settings.
// The page wraps every card in <AmbientBackground> (dark-only canvas
// glow + dot grid + cursor light) and uses the new editorial page
// header (88px Instrument Serif italic title + mono eyebrow). The
// existing card components stayed at the same import path and
// preserve every backend hookup (webhook PATCH, weekly-brief toggle,
// HeyGen avatar PATCH, project delete) — only their visuals moved
// to the new `platform-*` class set defined in app/globals.css.
export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Sprint 7.0.2: WeeklyBriefConfig's "Send test now" button needs a
  // projectId to target. We resolve it server-side so the client
  // doesn't have to do a second fetch.
  const activeProject = await getActiveProject(user.id);

  return (
    <AmbientBackground accentTint="default">
      <main className="platform-main">
        <header className="platform-page-head platform-reveal-1">
          <span className="platform-eyebrow">account · automation · danger</span>
          <h1>
            Settings<span className="accent">.</span>
          </h1>
          <p className="sub">
            Account configuration and integrations. Configure once — Helm
            keeps doing the work.
          </p>
        </header>

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
      </main>
    </AmbientBackground>
  );
}
