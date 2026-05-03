'use client';

import { useEffect, useState } from 'react';
import type { Project, GeneratedPost, ScheduledPost } from '@/lib/db/schema';
import { BrandCard, type BrandContext } from './brand-card';
import { templates, categories } from '@/lib/marketing/templates';
import { formatScheduledDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const PLATFORMS = [
  { id: 'instagram', label: 'Instagram', color: '#e1306c' },
  { id: 'facebook', label: 'Facebook', color: '#0866ff' },
  { id: 'linkedin', label: 'LinkedIn', color: '#0a66c2' },
  { id: 'threads', label: 'Threads', color: '#000' },
] as const;

type ScheduleMode = 'now' | 'later';

export function MarketingClient({
  project,
  recentPosts,
  upcoming,
}: {
  project: Project;
  recentPosts: GeneratedPost[];
  upcoming: ScheduledPost[];
}) {
  const [platform, setPlatform] = useState<typeof PLATFORMS[number]['id']>('instagram');
  const [prompt, setPrompt] = useState('');
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);

  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('now');
  const [scheduledFor, setScheduledFor] = useState('');
  const [scheduleStatus, setScheduleStatus] = useState<string | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedTemplate) return;
    const t = templates.find((tt) => tt.id === selectedTemplate);
    if (t && !prompt.trim()) setPrompt(t.hook);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTemplate]);

  useEffect(() => {
    if (!selectedTemplate) return;
    const t = templates.find((tt) => tt.id === selectedTemplate);
    if (t && !t.bestFor.includes(platform)) setSelectedTemplate(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform]);

  const generate = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setOutput('');
    try {
      const res = await fetch('/api/ai/generate-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          platform,
          prompt,
          templateId: selectedTemplate,
        }),
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

  const copyToClipboard = async () => {
    setScheduleError(null);
    try {
      await navigator.clipboard.writeText(output);
      setScheduleStatus('✓ Copied');
      setTimeout(() => setScheduleStatus(null), 2000);
    } catch {
      setScheduleError('Could not copy');
    }
  };

  const cancelPost = async (id: string) => {
    if (!confirm('Cancel this scheduled post?')) return;
    const res = await fetch(`/api/marketing/schedule?id=${id}`, {
      method: 'DELETE',
    });
    if (res.ok) location.reload();
    else alert('Could not cancel');
  };

  const schedulePost = async () => {
    if (!output || !scheduledFor) return;
    setScheduleStatus('scheduling…');
    setScheduleError(null);
    try {
      const res = await fetch('/api/marketing/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          platform,
          content: output,
          templateId: selectedTemplate,
          scheduledFor: new Date(scheduledFor).toISOString(),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setScheduleStatus('✓ Scheduled');
        setTimeout(() => location.reload(), 1500);
      } else {
        setScheduleStatus(null);
        setScheduleError(data.error ?? 'Failed to schedule');
      }
    } catch (e) {
      setScheduleStatus(null);
      setScheduleError(e instanceof Error ? e.message : String(e));
    }
  };

  // datetime-local needs a YYYY-MM-DDTHH:mm string in local time
  const minDateTime = (() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  })();

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6 md:mb-8">
        <h1 className="font-display text-display-md font-light tracking-tight">Marketing</h1>
        <p className="text-text-2 mt-2 max-w-2xl text-sm">
          Generate posts tailored to your project
        </p>
      </div>

      <BrandCard
        projectId={project.id}
        initialContext={(project.brandContext as BrandContext | null) ?? null}
        initialUrl={project.brandUrl}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
        <div className="glass rounded-2xl p-4 md:p-6">
          <div className="flex flex-wrap gap-2 mb-4 border-b border-border pb-4">
            {PLATFORMS.map((p) => (
              <button
                key={p.id}
                onClick={() => setPlatform(p.id)}
                className={`px-3 py-1.5 rounded-md text-xs flex items-center gap-2 border transition-colors ${
                  platform === p.id
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-border bg-bg text-text-2 hover:text-text-1'
                }`}
              >
                <span style={{ color: p.color }}>●</span>
                {p.label}
              </button>
            ))}
          </div>

          <div className="mb-4">
            <label className="block text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-3">
              Choose a template (optional)
            </label>
            <div className="space-y-3">
              {categories.map((cat) => {
                const inCat = templates.filter(
                  (t) => t.category === cat && t.bestFor.includes(platform)
                );
                if (inCat.length === 0) return null;
                return (
                  <div key={cat}>
                    <div className="text-xs text-text-3 mb-2">{cat}</div>
                    <div className="flex flex-wrap gap-2">
                      {inCat.map((t) => {
                        const active = selectedTemplate === t.id;
                        return (
                          <button
                            key={t.id}
                            onClick={() => setSelectedTemplate(active ? null : t.id)}
                            className={`text-left px-3 py-2 rounded-lg border text-xs transition-colors max-w-[260px] ${
                              active
                                ? 'border-accent bg-accent-soft text-accent'
                                : 'border-border hover:border-border-bright text-text-2'
                            }`}
                          >
                            <div className="font-medium">{t.title}</div>
                            <div className="text-text-3 mt-0.5 line-clamp-2">
                              {t.description}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <label className="block text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
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
            className="mt-4 bg-[image:var(--accent-grad)] text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-transform hover:-translate-y-0.5"
          >
            {loading ? 'Generating...' : 'Generate with Claude →'}
          </button>

          {output && (
            <div className="mt-6 bg-bg border border-border rounded-lg p-4 whitespace-pre-wrap text-sm">
              {output}
            </div>
          )}

          {output && (
            <div className="mt-4 pt-4 border-t border-border">
              <label className="block text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-3">
                When to post
              </label>
              <div className="flex flex-wrap gap-2 mb-3">
                <button
                  onClick={() => setScheduleMode('now')}
                  className={`text-xs px-3 py-1.5 rounded transition-colors ${
                    scheduleMode === 'now'
                      ? 'bg-accent-soft text-accent'
                      : 'text-text-2 hover:text-text-1'
                  }`}
                >
                  Just copy now
                </button>
                <button
                  onClick={() => setScheduleMode('later')}
                  className={`text-xs px-3 py-1.5 rounded transition-colors ${
                    scheduleMode === 'later'
                      ? 'bg-accent-soft text-accent'
                      : 'text-text-2 hover:text-text-1'
                  }`}
                >
                  Schedule for later
                </button>
              </div>

              {scheduleMode === 'later' && (
                <input
                  type="datetime-local"
                  value={scheduledFor}
                  onChange={(e) => setScheduledFor(e.target.value)}
                  min={minDateTime}
                  className="bg-bg-elev border border-border rounded-lg px-3 py-2 text-sm mb-3 text-text-1 [color-scheme:dark]"
                />
              )}

              <div className="flex flex-wrap gap-2 items-center">
                <Button variant="secondary" size="sm" onClick={copyToClipboard}>
                  Copy to clipboard
                </Button>
                {scheduleMode === 'later' && (
                  <Button
                    size="sm"
                    onClick={schedulePost}
                    disabled={!scheduledFor || scheduleStatus === 'scheduling…'}
                  >
                    {scheduleStatus === 'scheduling…' ? 'Scheduling…' : 'Schedule reminder →'}
                  </Button>
                )}
                {scheduleStatus && scheduleStatus !== 'scheduling…' && (
                  <span className="text-xs text-success">{scheduleStatus}</span>
                )}
                {scheduleError && (
                  <span className="text-xs text-danger">{scheduleError}</span>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="glass rounded-2xl p-5">
            <div className="font-display text-lg font-light mb-1">Upcoming posts</div>
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-4">
              Next {upcoming.length}
            </div>
            {upcoming.length === 0 && (
              <p className="text-text-3 text-sm">No scheduled posts yet.</p>
            )}
            {upcoming.map((p) => (
              <div
                key={p.id}
                className="border-l-2 border-accent pl-3 mb-3 last:mb-0 group relative"
              >
                <div className="flex justify-between items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-accent mb-1">
                      {p.platform} · {formatScheduledDate(p.scheduledFor)}
                    </div>
                    <div className="text-xs text-text-2 line-clamp-3 whitespace-pre-wrap">
                      {p.content}
                    </div>
                  </div>
                  <button
                    onClick={() => cancelPost(p.id)}
                    className="text-text-3 hover:text-danger opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity text-base leading-none px-1"
                    title="Cancel scheduled post"
                    aria-label="Cancel scheduled post"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="glass rounded-2xl p-5">
            <div className="font-display text-lg font-light mb-1">Recent generations</div>
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-4">
              Last {recentPosts.length}
            </div>
            {recentPosts.length === 0 && (
              <p className="text-text-3 text-sm">No posts generated yet.</p>
            )}
            {recentPosts.map((p) => (
              <div key={p.id} className="bg-bg border border-border rounded-lg p-3 mb-2 last:mb-0 text-xs">
                <div className="text-text-3 font-mono mb-1">{p.platform}</div>
                <div className="line-clamp-3 text-text-2">{p.content}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
