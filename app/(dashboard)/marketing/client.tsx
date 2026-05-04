'use client';

import { useEffect, useState } from 'react';
import type { Project, GeneratedPost, ScheduledPost } from '@/lib/db/schema';
import { BrandBibleCard } from './brand-bible-card';
import type { BrandBible } from '@/lib/types/brand';
import { templates, categories } from '@/lib/marketing/templates';
import { formatScheduledDate } from '@/lib/utils';
import { GlassCard } from '@/components/ui/glass-card';
import { Button } from '@/components/ui/button';
import { EditScheduledModal, type EditablePost } from './edit-scheduled-modal';
import { broadcastEvent, useBroadcast } from '@/hooks/use-broadcast';
import { DraftCard, type Draft } from './draft-card';
import { DriftAlert } from './drift-alert';

const PLATFORMS = [
  { id: 'instagram', label: 'Instagram', color: '#e1306c' },
  { id: 'facebook', label: 'Facebook', color: '#0866ff' },
  { id: 'linkedin', label: 'LinkedIn', color: '#0a66c2' },
  { id: 'threads', label: 'Threads', color: '#666' },
] as const;

type Platform = (typeof PLATFORMS)[number]['id'];

interface Generation {
  platform: Platform;
  drafts: Draft[];
  // Index into drafts[] of the version the user picked. Defaults to 0
  // (highest pillar) so the user can schedule without selecting if they
  // accept the first option.
  selectedDraftIdx: number;
  error?: string;
  scheduledFor: string; // local datetime-local format
}

// Default: tomorrow 9am local. Returns a YYYY-MM-DDTHH:mm string.
function defaultScheduleTime(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
}

function localMinDatetime(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

const PLATFORM_CHAR_LIMIT: Record<Platform, number | null> = {
  threads: 500,
  instagram: 2200,
  facebook: 5000,
  linkedin: 3000,
};

// Default-select the highest-consistency-score draft. Returns 0 when the
// drafts array is empty so the rendering logic doesn't choke on -1.
function pickBestDraftIdx(drafts: Draft[]): number {
  if (drafts.length === 0) return 0;
  let bestIdx = 0;
  let bestScore = drafts[0].consistencyScore;
  for (let i = 1; i < drafts.length; i++) {
    if (drafts[i].consistencyScore > bestScore) {
      bestScore = drafts[i].consistencyScore;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export function MarketingClient({
  project,
  recentPosts,
  upcoming,
  visualsAvailable,
}: {
  project: Project;
  recentPosts: GeneratedPost[];
  upcoming: ScheduledPost[];
  visualsAvailable: boolean;
}) {
  // Multi-select platforms; we enforce at least 1 selected at all times.
  const [platforms, setPlatforms] = useState<Platform[]>(['instagram']);
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [editingPost, setEditingPost] = useState<EditablePost | null>(null);

  // After generation, one entry per platform with its own editable copy
  // and its own scheduled time. activeTab toggles which one is visible.
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [activeTab, setActiveTab] = useState<Platform | null>(null);
  const [schedulingAll, setSchedulingAll] = useState(false);
  const [scheduleSummary, setScheduleSummary] = useState<string | null>(null);

  const togglePlatform = (p: Platform) => {
    setPlatforms((prev) => {
      if (prev.includes(p)) {
        if (prev.length === 1) return prev; // never empty
        return prev.filter((x) => x !== p);
      }
      return [...prev, p];
    });
  };

  // Pre-fill the prompt with the template hook when the user picks a template,
  // but only if the prompt is empty so we don't blow away in-progress text.
  useEffect(() => {
    if (!selectedTemplate) return;
    const t = templates.find((tt) => tt.id === selectedTemplate);
    if (t && !prompt.trim()) setPrompt(t.hook);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTemplate]);

  // If selected template no longer applies to ANY of the chosen platforms,
  // deselect it instead of leaving a stale chip highlighted.
  useEffect(() => {
    if (!selectedTemplate) return;
    const t = templates.find((tt) => tt.id === selectedTemplate);
    if (!t) return;
    const stillUseful = platforms.some((p) =>
      (t.bestFor as readonly string[]).includes(p)
    );
    if (!stillUseful) setSelectedTemplate(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platforms]);

  useBroadcast((event) => {
    if (event.type.startsWith('scheduled-post')) {
      location.reload();
    }
  });

  const generate = async () => {
    if (!prompt.trim() || platforms.length === 0) return;
    setLoading(true);
    setError(null);
    setGenerations([]);
    setActiveTab(null);
    try {
      const res = await fetch('/api/ai/generate-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          platforms,
          prompt,
          templateId: selectedTemplate,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Generation failed');
        return;
      }
      const defaultTime = defaultScheduleTime();
      const next: Generation[] = (
        data.generations as Array<{
          platform: Platform;
          drafts: Draft[];
          error?: string;
        }>
      ).map((g) => ({
        platform: g.platform,
        drafts: g.drafts ?? [],
        // Pick the highest-scoring draft as default — saves the user a click
        // when the first pillar's output already matches their bible best.
        selectedDraftIdx: pickBestDraftIdx(g.drafts ?? []),
        error: g.error,
        scheduledFor: defaultTime,
      }));
      setGenerations(next);
      setActiveTab(next[0]?.platform ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const updateScheduledFor = (platform: Platform, scheduledFor: string) => {
    setGenerations((prev) =>
      prev.map((g) => (g.platform === platform ? { ...g, scheduledFor } : g))
    );
  };

  const updateDraftContent = (
    platform: Platform,
    draftIdx: number,
    content: string
  ) => {
    setGenerations((prev) =>
      prev.map((g) =>
        g.platform === platform
          ? {
              ...g,
              drafts: g.drafts.map((d, i) =>
                i === draftIdx ? { ...d, content } : d
              ),
            }
          : g
      )
    );
  };

  const selectDraft = (platform: Platform, idx: number) => {
    setGenerations((prev) =>
      prev.map((g) =>
        g.platform === platform ? { ...g, selectedDraftIdx: idx } : g
      )
    );
  };

  // Update one draft inside one platform without losing the rest of the
  // tree. Used by both visual and carousel handlers below.
  const patchDraft = (
    platform: Platform,
    draftIdx: number,
    patch: Partial<Draft>
  ) => {
    setGenerations((prev) =>
      prev.map((g) =>
        g.platform === platform
          ? {
              ...g,
              drafts: g.drafts.map((d, i) =>
                i === draftIdx ? { ...d, ...patch } : d
              ),
            }
          : g
      )
    );
  };

  const handleGenerateVisual = async (
    platform: Platform,
    draftIdx: number
  ) => {
    const gen = generations.find((g) => g.platform === platform);
    const draft = gen?.drafts[draftIdx];
    if (!draft || !draft.content) return;

    patchDraft(platform, draftIdx, {
      visualLoading: true,
      visualError: undefined,
    });

    try {
      const res = await fetch('/api/visuals/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          platform,
          postContent: draft.content,
        }),
      });
      const data = await res.json();
      if (data.ok && data.visual) {
        patchDraft(platform, draftIdx, {
          visual: { url: data.visual.url, prompt: data.visual.prompt },
          visualLoading: false,
        });
      } else {
        patchDraft(platform, draftIdx, {
          visualLoading: false,
          visualError: data.hint ?? data.error ?? 'Visual generation failed',
        });
      }
    } catch (e) {
      patchDraft(platform, draftIdx, {
        visualLoading: false,
        visualError: e instanceof Error ? e.message : 'Network error',
      });
    }
  };

  const handleGenerateCarousel = async (
    platform: Platform,
    draftIdx: number
  ) => {
    const gen = generations.find((g) => g.platform === platform);
    const draft = gen?.drafts[draftIdx];
    if (!draft || !draft.content) return;

    patchDraft(platform, draftIdx, {
      visualLoading: true,
      visualError: undefined,
    });

    try {
      const res = await fetch('/api/visuals/carousel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          postContent: draft.content,
          template: 'educational',
        }),
      });
      const data = await res.json();
      if (data.ok && data.carousel?.slides?.[0]) {
        // Use slide 0 as the preview thumbnail; the full carousel still
        // lives in data.carousel for whatever ships it later.
        patchDraft(platform, draftIdx, {
          visual: {
            url: data.carousel.slides[0].url,
            prompt: 'Carousel slide 1 of ' + data.carousel.totalSlides,
          },
          visualLoading: false,
        });
      } else {
        patchDraft(platform, draftIdx, {
          visualLoading: false,
          visualError: data.hint ?? data.error ?? 'Carousel generation failed',
        });
      }
    } catch (e) {
      patchDraft(platform, draftIdx, {
        visualLoading: false,
        visualError: e instanceof Error ? e.message : 'Network error',
      });
    }
  };

  const regenerateOne = async (platform: Platform) => {
    setGenerations((prev) =>
      prev.map((g) =>
        g.platform === platform
          ? { ...g, error: undefined, drafts: [] }
          : g
      )
    );
    try {
      const res = await fetch('/api/ai/generate-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          platforms: [platform],
          prompt,
          templateId: selectedTemplate,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGenerations((prev) =>
          prev.map((g) =>
            g.platform === platform
              ? { ...g, error: data.error ?? 'Regen failed' }
              : g
          )
        );
        return;
      }
      const newGen = (data.generations as Array<{
        platform: Platform;
        drafts: Draft[];
        error?: string;
      }>)[0];
      if (newGen?.drafts && newGen.drafts.length > 0) {
        setGenerations((prev) =>
          prev.map((g) =>
            g.platform === platform
              ? {
                  ...g,
                  drafts: newGen.drafts,
                  selectedDraftIdx: pickBestDraftIdx(newGen.drafts),
                }
              : g
          )
        );
      } else if (newGen?.error) {
        setGenerations((prev) =>
          prev.map((g) =>
            g.platform === platform ? { ...g, error: newGen.error } : g
          )
        );
      }
    } catch (e) {
      setGenerations((prev) =>
        prev.map((g) =>
          g.platform === platform
            ? { ...g, error: e instanceof Error ? e.message : String(e) }
            : g
        )
      );
    }
  };

  const applyDateToAll = () => {
    const first = generations[0]?.scheduledFor;
    if (!first) return;
    setGenerations((prev) => prev.map((g) => ({ ...g, scheduledFor: first })));
  };

  // A generation is schedulable when it has at least one draft and the
  // selected draft has content + a scheduled time. The "all ready" check
  // also tolerates platforms that errored out — those are skipped, not
  // blocked.
  const getSelectedDraft = (g: Generation): Draft | null => {
    return g.drafts[g.selectedDraftIdx] ?? null;
  };
  const allReady =
    generations.length > 0 &&
    generations.every((g) => {
      if (g.error) return true;
      const sel = getSelectedDraft(g);
      return !!sel?.content && !!g.scheduledFor;
    });
  const schedulableCount = generations.filter((g) => {
    if (g.error) return false;
    const sel = getSelectedDraft(g);
    return !!sel?.content && !!g.scheduledFor;
  }).length;

  const scheduleAll = async () => {
    setSchedulingAll(true);
    setScheduleSummary(null);
    try {
      const results = await Promise.all(
        generations
          .filter((g) => {
            if (g.error) return false;
            const sel = getSelectedDraft(g);
            return !!sel?.content && !!g.scheduledFor;
          })
          .map(async (g) => {
            const sel = getSelectedDraft(g)!;
            const res = await fetch('/api/marketing/schedule', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                projectId: project.id,
                platform: g.platform,
                content: sel.content,
                templateId: selectedTemplate,
                scheduledFor: new Date(g.scheduledFor).toISOString(),
                consistencyScore: sel.consistencyScore,
                scoreBreakdown: sel.scoreBreakdown,
                visualUrl: sel.visual?.url ?? null,
                visualPrompt: sel.visual?.prompt ?? null,
              }),
            });
            return { platform: g.platform, ok: res.ok };
          })
      );
      const failed = results.filter((r) => !r.ok);
      if (failed.length === 0) {
        setScheduleSummary(`✓ Scheduled ${results.length}`);
        broadcastEvent({ type: 'scheduled-post-created' });
        setTimeout(() => location.reload(), 1500);
      } else {
        setScheduleSummary(
          `${results.length - failed.length} ok, ${failed.length} failed (${failed.map((f) => f.platform).join(', ')})`
        );
      }
    } finally {
      setSchedulingAll(false);
    }
  };

  const copyOne = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      // ignore
    }
  };

  const cancelPost = async (id: string) => {
    if (!confirm('Cancel this scheduled post?')) return;
    const res = await fetch(`/api/marketing/schedule?id=${id}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      broadcastEvent({ type: 'scheduled-post-deleted' });
      location.reload();
    } else {
      alert('Could not cancel');
    }
  };

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const minDateTime = localMinDatetime();
  const activeGeneration = activeTab
    ? generations.find((g) => g.platform === activeTab) ?? null
    : null;

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6 md:mb-8">
        <h1 className="font-display text-display-md font-light tracking-tight">Marketing</h1>
        <p className="text-text-2 mt-2 max-w-2xl text-sm">
          Generate posts tailored to your project, optimized per platform.
        </p>
      </div>

      <DriftAlert projectId={project.id} />

      <BrandBibleCard
        project={{
          id: project.id,
          name: project.name,
          brandUrl: project.brandUrl,
          brandContext:
            (project.brandContext as BrandBible | null) ?? null,
        }}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
        <div className="space-y-4">
          <div className="glass rounded-2xl p-4 md:p-6">
            <div className="mb-4 border-b border-border pb-4">
              <label className="block text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
                Platforms
              </label>
              <div className="flex flex-wrap gap-2">
                {PLATFORMS.map((p) => {
                  const active = platforms.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => togglePlatform(p.id)}
                      className={`px-3 py-1.5 rounded-md text-xs flex items-center gap-2 border transition-colors ${
                        active
                          ? 'border-accent bg-accent-soft text-accent'
                          : 'border-border bg-bg text-text-2 hover:text-text-1'
                      }`}
                    >
                      <span style={{ color: active ? undefined : p.color }}>●</span>
                      {p.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] font-mono text-text-3 mt-2">
                {platforms.length === 1
                  ? '1 platform · post will be optimized for it'
                  : `${platforms.length} platforms · each gets its own optimized version`}
              </p>
            </div>

            <div className="mb-4">
              <label className="block text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-3">
                Choose a template (optional)
              </label>
              <div className="space-y-3">
                {categories.map((cat) => {
                  const inCat = templates.filter(
                    (t) =>
                      t.category === cat &&
                      platforms.some((p) =>
                        (t.bestFor as readonly string[]).includes(p)
                      )
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
                              onClick={() =>
                                setSelectedTemplate(active ? null : t.id)
                              }
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
              {loading
                ? 'Generating…'
                : `Generate ${platforms.length > 1 ? `${platforms.length} versions` : ''} with Claude →`}
            </button>
            {error && <p className="text-xs text-danger mt-3">{error}</p>}
          </div>

          {generations.length > 0 && (
            <GlassCard elevated className="p-4 md:p-5">
              <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-accent mb-3">
                Review & schedule
              </div>

              <div className="flex flex-wrap gap-1 mb-4 border-b border-border">
                {generations.map((g) => {
                  const isActive = activeTab === g.platform;
                  return (
                    <button
                      key={g.platform}
                      onClick={() => setActiveTab(g.platform)}
                      className={`px-3 py-2 text-xs flex items-center gap-2 border-b-2 transition-colors ${
                        isActive
                          ? 'border-accent text-accent'
                          : 'border-transparent text-text-2 hover:text-text-1'
                      }`}
                    >
                      <span>●</span>
                      {PLATFORMS.find((p) => p.id === g.platform)?.label ?? g.platform}
                      {g.error && <span className="text-danger">⚠</span>}
                    </button>
                  );
                })}
              </div>

              {activeGeneration && (
                <div className="space-y-4">
                  {activeGeneration.error ? (
                    <div className="text-sm text-danger">
                      Generation failed: {activeGeneration.error}{' '}
                      <button
                        onClick={() => regenerateOne(activeGeneration.platform)}
                        className="ml-2 underline"
                      >
                        Retry
                      </button>
                    </div>
                  ) : activeGeneration.drafts.length === 0 ? (
                    <div className="text-sm text-text-3 italic">
                      No drafts available.
                    </div>
                  ) : (
                    <>
                      <p className="text-xs text-text-3">
                        3 drafts · each leans into a different brand pillar.
                        Click a card to select.
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {activeGeneration.drafts.map((draft, idx) => {
                          const platform = activeGeneration.platform;
                          const supportsCarousel =
                            platform === 'instagram' || platform === 'linkedin';
                          return (
                            <DraftCard
                              key={idx}
                              draft={draft}
                              isSelected={
                                activeGeneration.selectedDraftIdx === idx
                              }
                              onSelect={() => selectDraft(platform, idx)}
                              onContentChange={(content) =>
                                updateDraftContent(platform, idx, content)
                              }
                              visualsAvailable={visualsAvailable}
                              onGenerateVisual={
                                visualsAvailable
                                  ? () => handleGenerateVisual(platform, idx)
                                  : undefined
                              }
                              onRegenerateVisual={
                                visualsAvailable
                                  ? () => handleGenerateVisual(platform, idx)
                                  : undefined
                              }
                              showCarouselButton={
                                supportsCarousel &&
                                draft.content.length > 200
                              }
                              onGenerateCarousel={() =>
                                handleGenerateCarousel(platform, idx)
                              }
                            />
                          );
                        })}
                      </div>

                      {(() => {
                        const sel = getSelectedDraft(activeGeneration);
                        if (!sel) return null;
                        const limit =
                          PLATFORM_CHAR_LIMIT[activeGeneration.platform];
                        const overLimit =
                          limit && sel.content.length > limit;
                        return (
                          <div className="text-xs text-text-3">
                            Selected · {sel.content.length} chars
                            {overLimit && (
                              <span className="text-danger ml-2">
                                ⚠{' '}
                                {
                                  PLATFORMS.find(
                                    (p) =>
                                      p.id === activeGeneration.platform
                                  )?.label
                                }{' '}
                                max is {limit}
                              </span>
                            )}
                          </div>
                        );
                      })()}

                      <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
                        <div className="flex-1">
                          <label className="block text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-1">
                            Schedule for
                          </label>
                          <input
                            type="datetime-local"
                            value={activeGeneration.scheduledFor}
                            onChange={(e) =>
                              updateScheduledFor(
                                activeGeneration.platform,
                                e.target.value
                              )
                            }
                            min={minDateTime}
                            className="bg-bg-elev border border-border rounded-lg px-3 py-2 text-sm text-text-1 [color-scheme:dark]"
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              const sel = getSelectedDraft(activeGeneration);
                              if (sel) copyOne(sel.content);
                            }}
                          >
                            Copy selected
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              regenerateOne(activeGeneration.platform)
                            }
                          >
                            Regenerate all
                          </Button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              <div className="flex flex-wrap gap-2 mt-6 pt-4 border-t border-border items-center">
                <Button variant="ghost" size="sm" onClick={applyDateToAll}>
                  Apply this date to all
                </Button>
                <div className="flex-1" />
                {scheduleSummary && (
                  <span className="text-xs text-text-2">{scheduleSummary}</span>
                )}
                <Button
                  size="sm"
                  onClick={scheduleAll}
                  disabled={!allReady || schedulingAll || schedulableCount === 0}
                >
                  {schedulingAll ? 'Scheduling…' : `Schedule all (${schedulableCount})`}
                </Button>
              </div>
              <p className="text-xs text-text-3 mt-2">
                Times in your timezone: <span className="font-mono">{tz}</span>
              </p>
            </GlassCard>
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
                  <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <button
                      onClick={() =>
                        setEditingPost({
                          id: p.id,
                          platform: p.platform,
                          content: p.content,
                          scheduledFor: p.scheduledFor,
                        })
                      }
                      className="text-text-3 hover:text-accent text-xs leading-none px-1"
                      title="Edit scheduled post"
                      aria-label="Edit scheduled post"
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => cancelPost(p.id)}
                      className="text-text-3 hover:text-danger text-base leading-none px-1"
                      title="Cancel scheduled post"
                      aria-label="Cancel scheduled post"
                    >
                      ×
                    </button>
                  </div>
                </div>
              </div>
            ))}
            <a
              href="/marketing/scheduled"
              className="text-xs text-accent hover:underline mt-3 block"
            >
              View all scheduled →
            </a>
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
              <div
                key={p.id}
                className="bg-bg border border-border rounded-lg p-3 mb-2 last:mb-0 text-xs"
              >
                <div className="text-text-3 font-mono mb-1">{p.platform}</div>
                <div className="line-clamp-3 text-text-2">{p.content}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <EditScheduledModal
        post={editingPost}
        onClose={() => setEditingPost(null)}
        onSaved={() => location.reload()}
      />
    </div>
  );
}
