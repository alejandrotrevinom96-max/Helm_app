'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { AddProjectModal } from '@/components/dashboard/add-project-modal';

type Candidate = {
  repo: {
    id: number;
    name: string;
    fullName: string;
    description: string | null;
    htmlUrl: string;
    language: string | null;
    isPrivate: boolean;
  };
  stack: {
    framework: string;
    hasSupabase: boolean;
    hasStripe: boolean;
    hasVercelConfig: boolean;
  };
};

export function OnboardingClient({
  candidates,
  scanError,
  userId,
  noGithub = false,
  pendingBrandUrl = null,
}: {
  candidates: Candidate[];
  scanError: string | null;
  userId: string;
  // PR #33 — Sprint 6.1: when the user signed up via email/Google
  // there's no GitHub integration to scan. Switch to a "manual
  // first project" UI instead of showing an empty repo list.
  noGithub?: boolean;
  // PR #72 — Sprint 7.2A hotfix: URL the user previewed on the
  // landing-page hero before signup. When present, we auto-open the
  // AddProjectModal pre-filled with it so the post-confirmation
  // landing reflects the intent the user expressed pre-signup.
  pendingBrandUrl?: string | null;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<number>>(
    new Set(candidates.map((c) => c.repo.id))
  );
  const [submitting, setSubmitting] = useState(false);
  // PR #72 — auto-open when there's a pending URL from the landing.
  // We rely on initial state rather than a useEffect so the modal
  // renders on first paint without a flash of empty onboarding.
  const [addProjectOpen, setAddProjectOpen] = useState(
    Boolean(pendingBrandUrl),
  );
  // Clear sessionStorage once we've consumed the URL — keeps stale
  // entries from re-popping the modal on a refresh after the project
  // was already created.
  useEffect(() => {
    if (pendingBrandUrl && typeof window !== 'undefined') {
      try {
        window.sessionStorage.removeItem('helm:pendingBrandUrl');
      } catch {
        // private mode — non-fatal
      }
    }
  }, [pendingBrandUrl]);

  // PR #33 — render the manual-first variant when GitHub isn't
  // connected. The user gets a single big "Add project" button that
  // opens the same modal the sidebar uses; once a project exists,
  // the AddProjectModal redirects to /marketing/generate.
  if (noGithub) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="glass-elevated rounded-2xl max-w-md w-full p-8 md:p-10 text-center">
          <h1 className="font-display text-3xl font-light mb-2">
            Welcome to Helm
          </h1>
          <p className="text-sm text-text-2 mb-6">
            Let&apos;s create your first project. You can connect
            integrations (Vercel, Supabase, Meta) later from the Integrations
            page.
          </p>
          <button
            type="button"
            onClick={() => setAddProjectOpen(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-accent text-white rounded-lg text-sm font-medium hover:opacity-90"
          >
            <Plus className="w-4 h-4" />
            Add a project
          </button>
          <p className="text-[10px] text-text-3 mt-6">
            You can also connect a GitHub account later from{' '}
            <span className="font-medium">Settings → Integrations</span> to
            scan repos automatically.
          </p>
          <AddProjectModal
            isOpen={addProjectOpen}
            onClose={() => setAddProjectOpen(false)}
            defaultBrandUrl={pendingBrandUrl}
          />
        </div>
      </div>
    );
  }

  const toggle = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const handleContinue = async () => {
    setSubmitting(true);
    const chosen = candidates.filter((c) => selected.has(c.repo.id));
    const res = await fetch('/api/onboarding/create-projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projects: chosen }),
    });
    if (res.ok) {
      router.push('/integrations');
    } else {
      setSubmitting(false);
      alert('Error creating projects. Try again.');
    }
  };

  return (
    <div className="min-h-screen px-4 md:px-6 py-8 md:py-16">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8 md:mb-12">
          <p className="font-mono text-[10px] text-accent uppercase tracking-[0.15em] mb-4">
            Step 1 of 3
          </p>
          <h1 className="font-display text-display-lg font-light leading-tight mb-4">
            We found <em className="editorial-italic">{candidates.length}</em>{' '}
            {candidates.length === 1 ? 'project' : 'projects'}
          </h1>
          <p className="text-text-2 text-base md:text-lg max-w-2xl">
            Helm scanned your recent repos for SaaS signals (Next.js, Supabase, Stripe, Vercel).
            Select which ones to track.
          </p>
        </div>

        {scanError && (
          <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 mb-6 text-danger text-sm">
            Couldn&apos;t scan repos: {scanError}
          </div>
        )}

        {candidates.length === 0 && !scanError && (
          <div className="glass rounded-2xl p-12 text-center">
            <p className="text-text-2 mb-4">
              No SaaS-like projects detected in your recent repos.
            </p>
            <p className="text-text-3 text-sm">
              We look for repos with Next.js + Supabase, Stripe, or vercel.json.
              You can add a project manually from the dashboard.
            </p>
          </div>
        )}

        <div className="space-y-3 mb-8">
          {candidates.map((c) => (
            <label
              key={c.repo.id}
              className={`block glass rounded-2xl p-5 cursor-pointer transition-all hover:-translate-y-0.5 ${
                selected.has(c.repo.id)
                  ? 'border-accent shadow-[0_0_0_1px_var(--accent-glow)]'
                  : 'hover:border-border-bright'
              }`}
            >
              <div className="flex items-start gap-4">
                <input
                  type="checkbox"
                  checked={selected.has(c.repo.id)}
                  onChange={() => toggle(c.repo.id)}
                  className="mt-1 w-5 h-5 accent-accent"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="font-medium text-lg">{c.repo.name}</h3>
                    {c.repo.isPrivate && (
                      <span className="text-[10px] font-mono px-2 py-0.5 bg-bg border border-border rounded text-text-3 tracking-[0.15em]">
                        PRIVATE
                      </span>
                    )}
                  </div>
                  {c.repo.description && (
                    <p className="text-text-2 text-sm mb-3 line-clamp-2">
                      {c.repo.description}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Tag>{c.stack.framework}</Tag>
                    {c.stack.hasSupabase && <Tag>supabase</Tag>}
                    {c.stack.hasStripe && <Tag>stripe</Tag>}
                    {c.stack.hasVercelConfig && <Tag>vercel</Tag>}
                  </div>
                </div>
              </div>
            </label>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
          <p className="text-text-3 text-sm">
            {selected.size} of {candidates.length} selected
          </p>
          <button
            onClick={handleContinue}
            disabled={selected.size === 0 || submitting}
            className="bg-[image:var(--accent-grad)] text-white px-7 py-3 rounded-lg font-medium disabled:opacity-50 transition-transform hover:-translate-y-0.5"
          >
            {submitting ? 'Setting up...' : 'Continue → Connect integrations'}
          </button>
        </div>

        {/* PR #33 — Sprint 6.1: skip-and-add-manually escape hatch.
            Useful when the user's repos don't match what Helm
            expects (e.g. monorepo, non-web SaaS) and they'd rather
            describe their project from scratch. */}
        <div className="mt-8 pt-6 border-t border-border text-center">
          <p className="text-sm text-text-3 mb-2">
            Don&apos;t see your project, or none of these match?
          </p>
          <button
            type="button"
            onClick={() => setAddProjectOpen(true)}
            className="text-sm text-accent hover:underline"
          >
            Skip and add manually →
          </button>
        </div>

        <AddProjectModal
          isOpen={addProjectOpen}
          onClose={() => setAddProjectOpen(false)}
        />
      </div>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-mono px-2 py-1 bg-bg border border-border rounded text-text-2">
      {children}
    </span>
  );
}
