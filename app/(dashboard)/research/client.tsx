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
    <div className="p-8">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="font-display text-4xl font-medium tracking-tight">Market Research</h1>
          <p className="text-text-dim mt-1 text-sm">Pain points and opportunities matching your niche</p>
        </div>
        <button
          onClick={scan}
          disabled={scanning}
          className="bg-accent text-bg px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {scanning ? 'Scanning Reddit...' : 'Scan now →'}
        </button>
      </div>

      <div className="flex gap-1 bg-bg-elev border border-border rounded-lg p-1 mb-6 w-fit">
        {(['all', 'reddit', 'hackernews'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded text-xs font-mono uppercase ${
              filter === f ? 'bg-bg text-text' : 'text-text-dim'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="bg-bg-elev border border-border rounded-xl p-12 text-center">
          <p className="font-display text-2xl mb-2">No findings yet</p>
          <p className="text-text-dim text-sm mb-4">
            Click "Scan now" to search Reddit for posts matching your project.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {filtered.map((f) => (
          <a
            key={f.id}
            href={f.url}
            target="_blank"
            rel="noopener"
            className="bg-bg-elev border border-border rounded-xl p-5 hover:border-border-bright transition-colors"
          >
            <div className="flex justify-between items-center mb-3">
              <span className="text-xs text-text-dim">{f.source}</span>
              <span
                className={`text-[11px] font-mono px-2 py-1 rounded-full ${
                  (f.matchScore ?? 0) > 80
                    ? 'bg-accent-soft text-accent'
                    : 'bg-green-500/10 text-green-400'
                }`}
              >
                {f.matchScore} match
              </span>
            </div>
            <h3 className="text-sm font-medium mb-2 leading-snug">{f.title}</h3>
            <p className="text-xs text-text-dim mb-3 line-clamp-2">{f.snippet}</p>
            <div className="flex justify-between text-[11px] text-text-faint font-mono">
              <span>↑ {f.upvotes ?? 0} · 💬 {f.comments ?? 0}</span>
              <span>{f.postedAt && timeAgo(f.postedAt)}</span>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
