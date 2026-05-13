import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { integrations } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { getActiveProject, getAllUserProjects } from '@/lib/active-project';
import { IntegrationsClient } from './client';
import { MetaIntegrationCard } from './meta-integration-card';
import { RedditCard } from './reddit-card';
import { XCard } from './x-card';
import { LinkedInCard } from './linkedin-card';
import { ThreadsCard } from './threads-card';
import { TikTokCard } from './tiktok-card';

export default async function IntegrationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const userIntegrations = await db
    .select({ provider: integrations.provider, createdAt: integrations.createdAt })
    .from(integrations)
    .where(eq(integrations.userId, user.id));

  const allProjects = await getAllUserProjects(user.id);
  // PR #29 — the Meta posting card is scoped to the active project
  // (cookie-driven, falls back to oldest). Each project has its own
  // FB Page; the card flips state when the user switches projects.
  const activeProject = await getActiveProject(user.id);

  return (
    <>
      <IntegrationsClient
        connected={userIntegrations.map((i) => i.provider)}
        allProjects={allProjects.map((p) => ({
          id: p.id,
          name: p.name,
          githubRepoFullName: p.githubRepoFullName,
          vercelProjectId: p.vercelProjectId,
          vercelTeamId: p.vercelTeamId,
          supabaseProjectRef: p.supabaseProjectRef,
          supabaseTables: (p.supabaseTables as { tableName: string; metricLabel: string }[] | null) ?? null,
          metaAdAccountId: p.metaAdAccountId,
        }))}
      />

      {activeProject && (
        <div className="max-w-6xl mx-auto px-4 md:px-8 pb-12">
          <h2 className="font-display text-2xl font-light mb-2">
            Auto-publishing
          </h2>
          <p className="text-sm text-text-2 mb-6">
            Connect a social platform to{' '}
            <span className="text-text-1 font-medium">
              {activeProject.name}
            </span>{' '}
            and Helm will publish your scheduled posts automatically.
          </p>
          <MetaIntegrationCard projectId={activeProject.id} />
        </div>
      )}

      {/* PR #58 — Sprint 7.0.2: research sources need Reddit OAuth
          for cloud-IP reliability. Separate section because Reddit
          is user-scoped, not project-scoped. */}
      <div className="max-w-6xl mx-auto px-4 md:px-8 pb-12">
        <h2 className="font-display text-2xl font-light mb-2">
          Research sources
        </h2>
        <p className="text-sm text-text-2 mb-6">
          OAuth into the platforms Helm scans for audience signal.
        </p>
        <RedditCard
          initiallyConnected={userIntegrations.some(
            (i) => i.provider === 'reddit',
          )}
        />
      </div>

      {/* PR #65 — Sprint 7.0.8: X (Twitter) publishing via the new
          pay-per-use API. PR #66 — Sprint 7.0.9: LinkedIn + Threads
          land here too. Credentials are platform-specific (env vars
          for X, per-project OAuth for LinkedIn, piggybacks the Meta
          token for Threads). */}
      {activeProject && (
        <div className="max-w-6xl mx-auto px-4 md:px-8 pb-12 space-y-4">
          <div>
            <h2 className="font-display text-2xl font-light mb-2">
              Auto-publishing (more platforms)
            </h2>
            <p className="text-sm text-text-2 mb-2">
              Beyond Facebook + Instagram. Each platform has its own
              credentials path — pick what you actually publish to.
            </p>
          </div>
          <XCard />
          <LinkedInCard projectId={activeProject.id} />
          <ThreadsCard projectId={activeProject.id} />
          {/* PR #87 — Sprint 7.11: TikTok Upload to Inbox.
              User-scoped (not project-scoped) — see the schema
              comment on tiktok_integrations for the rationale.
              No projectId prop needed. */}
          <TikTokCard />
        </div>
      )}
    </>
  );
}
