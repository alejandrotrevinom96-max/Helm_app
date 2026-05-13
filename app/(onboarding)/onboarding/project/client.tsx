'use client';

// PR #74 — Sprint 7.2B Step 2: Project (client).
//
// Manual project creation (name + website). Honest about why the
// website matters: it's what the brand bible auto-generator reads
// later if/when the founder runs it.
//
// We intentionally drop the GitHub-tab the plan proposed. The PR
// #72 hotfix narrowed GitHub OAuth scopes to remove `repo`, so the
// repo-scan path is effectively deprecated for new signups —
// surfacing a GitHub option here would either render an empty list
// or burn a confusing "couldn't read repos" error. Existing users
// with the `repo` grant still have access via Settings →
// Integrations; the wizard's job is the happy path.
//
// The plan also wanted a one-liner field — we accept it as
// "Description" but persist it to onboarding_progress.brandAnswers
// (NOT projects.description, which doesn't exist) so it carries
// into the brand step's seed bible.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';

interface Props {
  existingProject: {
    id: string;
    name: string;
    brandUrl: string | null;
  } | null;
  priorOneLiner: string;
}

export function ProjectClient({ existingProject, priorOneLiner }: Props) {
  const router = useRouter();
  const [name, setName] = useState(existingProject?.name ?? '');
  const [oneLiner, setOneLiner] = useState(priorOneLiner);
  const [website, setWebsite] = useState(existingProject?.brandUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleContinue = async () => {
    if (!name.trim() || !oneLiner.trim() || busy) return;
    setBusy(true);
    setError(null);

    try {
      let projectId = existingProject?.id ?? null;

      // Create the project if we don't have one yet. /api/projects
      // accepts { name, brandUrl } (NOT description); we keep
      // oneLiner aside for the brand step to consume.
      if (!projectId) {
        const res = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim().slice(0, 80),
            brandUrl: website.trim() ? website.trim() : null,
          }),
        });
        const data = (await res.json()) as {
          project?: { id: string };
          error?: string;
        };
        if (!res.ok || !data.project?.id) {
          setError(data.error ?? 'Could not create project');
          setBusy(false);
          return;
        }
        projectId = data.project.id;
      }

      // Mark step complete + stash projectId + oneLiner for the
      // brand step. POSTing brandAnswers.oneLiner here means step
      // 3 already has it without re-asking.
      await fetch('/api/onboarding/wizard-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: 'project',
          completed: true,
          primaryProjectId: projectId,
          brandAnswers: { oneLiner: oneLiner.trim() },
        }),
      });

      router.push('/onboarding/brand');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
      setBusy(false);
    }
  };

  return (
    <div>
      <h1 className="font-display text-3xl md:text-4xl font-light tracking-tight mb-2">
        Your project
      </h1>
      <p className="text-text-2 mb-8">
        Start with one project. You can add more later from the sidebar.
        {existingProject && (
          <span className="block text-sm text-text-3 mt-2">
            ✓ We detected you already created{' '}
            <strong>{existingProject.name}</strong> — you can edit here or
            just continue.
          </span>
        )}
      </p>

      <GlassCard className="p-6 space-y-5">
        <div>
          <label
            htmlFor="project-name"
            className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2 block"
          >
            Project name *
          </label>
          <input
            id="project-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Voya"
            maxLength={80}
            disabled={busy}
            className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm outline-none focus:border-accent"
          />
        </div>

        <div>
          <label
            htmlFor="project-oneliner"
            className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2 block"
          >
            What does it do? (1 sentence) *
          </label>
          <input
            id="project-oneliner"
            type="text"
            value={oneLiner}
            onChange={(e) => setOneLiner(e.target.value.slice(0, 300))}
            placeholder="e.g. AI travel planning for Mexican women in life transitions"
            disabled={busy}
            className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm outline-none focus:border-accent"
          />
          <p className="text-xs text-text-3 mt-1">
            Be specific. &quot;Travel app&quot; is too generic — &quot;Travel for
            Mexican women in life transitions&quot; is where the ideas live.
          </p>
        </div>

        <div>
          <label
            htmlFor="project-website"
            className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2 block"
          >
            Website (optional)
          </label>
          <input
            id="project-website"
            type="url"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://voya.travel"
            disabled={busy}
            className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm outline-none focus:border-accent"
          />
          <p className="text-xs text-text-3 mt-1">
            If you have a site, we use it later in /marketing to auto-generate
            your full brand bible from the content.
          </p>
        </div>
      </GlassCard>

      {error && (
        <div className="mt-4 p-3 bg-danger/10 border border-danger/30 rounded-lg text-sm text-danger">
          {error}
        </div>
      )}

      <div className="mt-8 flex items-center justify-between">
        <a
          href="/onboarding/welcome"
          className="text-sm text-text-3 hover:text-text-1"
        >
          ← Back
        </a>
        <Button
          onClick={handleContinue}
          disabled={!name.trim() || !oneLiner.trim() || busy}
        >
          {busy ? 'Creating…' : 'Continue →'}
        </Button>
      </div>
    </div>
  );
}
