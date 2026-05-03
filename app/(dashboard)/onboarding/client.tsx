'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

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
}: {
  candidates: Candidate[];
  scanError: string | null;
  userId: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<number>>(
    new Set(candidates.map((c) => c.repo.id))
  );
  const [submitting, setSubmitting] = useState(false);

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
