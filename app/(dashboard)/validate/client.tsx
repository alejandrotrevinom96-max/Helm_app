'use client';

import { useState } from 'react';
import type { Project } from '@/lib/db/schema';
import { slugify } from '@/lib/utils';

interface PageWithCount {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  isActive: boolean | null;
  signupCount: number;
}

export function ValidateClient({
  project,
  pages,
}: {
  project: Project;
  pages: PageWithCount[];
}) {
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');

  const create = async () => {
    if (!title.trim()) return;
    setCreating(true);
    const res = await fetch('/api/waitlist-pages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: project.id,
        title,
        subtitle,
        slug: slugify(title),
      }),
    });
    if (res.ok) location.reload();
    setCreating(false);
  };

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6 md:mb-8">
        <h1 className="font-display text-display-md font-light tracking-tight">Validate</h1>
        <p className="text-text-2 mt-2 max-w-2xl text-sm">
          Test ideas with public waitlist pages
        </p>
      </div>

      <div className="glass rounded-2xl p-4 md:p-6 mb-6">
        <h2 className="font-display text-xl font-medium mb-4">Create new waitlist page</h2>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Page title (e.g. AI co-pilot for indie hackers)"
          className="w-full bg-bg border border-border rounded-lg p-3 text-sm mb-3 outline-none focus:border-accent"
        />
        <input
          value={subtitle}
          onChange={(e) => setSubtitle(e.target.value)}
          placeholder="Subtitle / value prop (optional)"
          className="w-full bg-bg border border-border rounded-lg p-3 text-sm mb-3 outline-none focus:border-accent"
        />
        {title && (
          <p className="text-xs text-text-3 font-mono mb-3">
            URL: {baseUrl}/w/{slugify(title)}
          </p>
        )}
        <button
          onClick={create}
          disabled={creating || !title.trim()}
          className="bg-[image:var(--accent-grad)] text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-transform hover:-translate-y-0.5"
        >
          {creating ? 'Creating...' : 'Create + Get URL →'}
        </button>
      </div>

      <h2 className="font-display text-xl font-medium mb-4">Your waitlist pages</h2>
      {pages.length === 0 ? (
        <p className="text-text-3 text-sm">No pages yet. Create your first one above.</p>
      ) : (
        <div className="space-y-3">
          {pages.map((p) => (
            <div key={p.id} className="glass rounded-2xl p-4 md:p-5 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
              <div className="flex-1 min-w-0">
                <h3 className="font-medium mb-1">{p.title}</h3>
                <a
                  href={`/w/${p.slug}`}
                  target="_blank"
                  className="text-xs font-mono text-accent hover:underline break-all"
                >
                  {baseUrl}/w/{p.slug} ↗
                </a>
              </div>
              <div className="text-left sm:text-right flex-shrink-0">
                <div className="font-display text-2xl font-medium">{p.signupCount}</div>
                <div className="text-[10px] uppercase tracking-[0.15em] text-text-3">signups</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
