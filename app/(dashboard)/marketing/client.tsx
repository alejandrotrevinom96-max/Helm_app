'use client';

import { useState } from 'react';
import type { Project, GeneratedPost } from '@/lib/db/schema';

const PLATFORMS = [
  { id: 'instagram', label: 'Instagram', color: '#e1306c' },
  { id: 'facebook', label: 'Facebook', color: '#0866ff' },
  { id: 'linkedin', label: 'LinkedIn', color: '#0a66c2' },
  { id: 'threads', label: 'Threads', color: '#000' },
] as const;

export function MarketingClient({
  project,
  recentPosts,
}: {
  project: Project;
  recentPosts: GeneratedPost[];
}) {
  const [platform, setPlatform] = useState<typeof PLATFORMS[number]['id']>('instagram');
  const [prompt, setPrompt] = useState('');
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setOutput('');
    try {
      const res = await fetch('/api/ai/generate-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, platform, prompt }),
      });
      const data = await res.json();
      if (data.content) setOutput(data.content);
      else setOutput('Error generating post. Try again.');
    } catch (err) {
      setOutput('Error generating post.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6 md:mb-8">
        <h1 className="font-display text-3xl md:text-4xl font-medium tracking-tight">Marketing</h1>
        <p className="text-text-dim mt-1 text-sm">Generate posts tailored to your project</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
        <div className="bg-bg-elev border border-border rounded-xl p-4 md:p-6">
          <div className="flex flex-wrap gap-2 mb-4 border-b border-border pb-4">
            {PLATFORMS.map((p) => (
              <button
                key={p.id}
                onClick={() => setPlatform(p.id)}
                className={`px-3 py-1.5 rounded-md text-xs flex items-center gap-2 border ${
                  platform === p.id
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-border bg-bg text-text-dim'
                }`}
              >
                <span style={{ color: p.color }}>●</span>
                {p.label}
              </button>
            ))}
          </div>

          <label className="block text-xs font-mono uppercase tracking-wider text-text-faint mb-2">
            What do you want to post about?
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. We just hit 100 paying customers. Share the journey."
            className="w-full bg-bg border border-border rounded-lg p-3 text-sm min-h-[100px] outline-none focus:border-accent"
          />

          <button
            onClick={generate}
            disabled={loading || !prompt.trim()}
            className="mt-4 bg-accent text-bg px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {loading ? 'Generating...' : 'Generate with Claude →'}
          </button>

          {output && (
            <div className="mt-6 bg-bg border border-border rounded-lg p-4 whitespace-pre-wrap text-sm">
              {output}
              <button
                onClick={() => navigator.clipboard.writeText(output)}
                className="mt-3 block text-xs text-accent hover:underline"
              >
                Copy to clipboard
              </button>
            </div>
          )}
        </div>

        <div className="bg-bg-elev border border-border rounded-xl p-5">
          <div className="font-display text-base font-medium mb-1">Recent generations</div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint mb-4">
            Last {recentPosts.length}
          </div>
          {recentPosts.length === 0 && (
            <p className="text-text-faint text-sm">No posts generated yet.</p>
          )}
          {recentPosts.map((p) => (
            <div key={p.id} className="bg-bg border border-border rounded-lg p-3 mb-2 text-xs">
              <div className="text-text-faint font-mono mb-1">{p.platform}</div>
              <div className="line-clamp-3 text-text-dim">{p.content}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
