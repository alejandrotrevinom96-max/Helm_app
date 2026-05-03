'use client';

import { useState } from 'react';
import type { Project, ResearchFinding } from '@/lib/db/schema';
import { timeAgo } from '@/lib/utils';

export function ResearchClient({
  project,
  findings,
}: {
  project: Project;
  findings: ResearchFinding[];
}) {
  const [scanning, setScanning] = useState(false);
  const [filter, setFilter] = useState<'all' | 'reddit' | 'hackernews'>('all');

  const filtered = findings.filter((f) => filter === 'all' || f.source === filter);

  const scan = async () => {
    setScanning(true);
    try {
      const res = await fetch('/api/research/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id }),
      });
      if (res.ok) location.reload();
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="p-4 md:p-8">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-3 mb-6 md:mb-8">
        <div>
          <h1 className="font-display text-display-md font-light tracking-tight">Market Research</h1>
          <p className="text-text-2 mt-2 max-w-2xl text-sm">
            Pain points and opportunities matching your niche
          </p>
        </div>
        <button
          onClick={scan}
          disabled={scanning}
          className="bg-[image:var(--accent-grad)] text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 self-start sm:self-auto transition-transform hover:-translate-y-0.5"
        >
          {scanning ? 'Scanning Reddit...' : 'Scan now →'}
        </button>
      </div>

      <div className="flex gap-1 glass rounded-lg p-1 mb-6 w-fit">
        {(['all', 'reddit', 'hackernews'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded text-xs font-mono uppercase tracking-[0.1em] transition-colors ${
              filter === f ? 'bg-bg text-text-1' : 'text-text-2 hover:text-text-1'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="glass rounded-2xl p-8 md:p-12 text-center">
          <p className="font-display text-2xl mb-2">No findings yet</p>
          <p className="text-text-2 text-sm mb-4">
            Click &quot;Scan now&quot; to search Reddit for posts matching your project.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
        {filtered.map((f) => (
          <a
            key={f.id}
            href={f.url}
            target="_blank"
            rel="noopener"
            className="glass rounded-2xl p-5 hover:border-border-bright transition-all hover:-translate-y-0.5"
          >
            <div className="flex justify-between items-center mb-3">
              <span className="text-xs text-text-3 font-mono uppercase tracking-[0.1em]">{f.source}</span>
              <span
                className={`text-[11px] font-mono px-2 py-1 rounded-full ${
                  (f.matchScore ?? 0) > 80
                    ? 'bg-accent-soft text-accent'
                    : 'bg-success-soft text-success'
                }`}
              >
                {f.matchScore} match
              </span>
            </div>
            <h3 className="text-sm font-medium mb-2 leading-snug">{f.title}</h3>
            <p className="text-xs text-text-2 mb-3 line-clamp-2">{f.snippet}</p>
            <div className="flex justify-between text-[11px] text-text-3 font-mono">
              <span>↑ {f.upvotes ?? 0} · 💬 {f.comments ?? 0}</span>
              <span>{f.postedAt && timeAgo(f.postedAt)}</span>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
