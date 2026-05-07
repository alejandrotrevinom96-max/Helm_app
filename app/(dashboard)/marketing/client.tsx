'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Project } from '@/lib/db/schema';
import { BrandBibleCard } from './brand-bible-card';
import type { BrandBible } from '@/lib/types/brand';
import { templates, categories } from '@/lib/marketing/templates';
import { GlassCard } from '@/components/ui/glass-card';
import { Button } from '@/components/ui/button';
import { broadcastEvent, useBroadcast } from '@/hooks/use-broadcast';
import { DraftCard, type Draft } from './draft-card';
import { DriftAlert } from './drift-alert';
import { PerformanceInsights } from './performance-insights';
import { SmartTemplatesSection } from './smart-templates-section';
import { StoryToggle } from './story-toggle';
import { ReelToggle } from './reel-toggle';
import type { VideoMetadata } from '@/lib/meta/video-validator';

const PLATFORMS = [
  { id: 'instagram', label: 'Instagram', color: '#e1306c' },
  { id: 'facebook', label: 'Facebook', color: '#0866ff' },
  { id: 'linkedin', label: 'LinkedIn', color: '#0a66c2' },
  { id: 'threads', label: 'Threads', color: '#666' },
  { id: 'reddit', label: 'Reddit', color: '#FF4500' },
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
  // Reddit's hard ceiling is 40k for body text but anything past ~1500
  // typically buries the lede. We warn at 1500 — same UX pattern as
  // threads (warn before max so the user gets to edit, not hard-block).
  reddit: 1500,
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
  userId,
  visualsAvailable,
}: {
  project: Project;
  // PR #32 — Sprint 5.3: forwarded to ReelToggle for Supabase Storage
  // upload path namespacing.
  userId: string;
  visualsAvailable: boolean;
}) {
  // Multi-select platforms; we enforce at least 1 selected at all times.
  const [platforms, setPlatforms] = useState<Platform[]>(['instagram']);
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  // PR #31 — Sprint 5.2.1: top-level Story flag. Pre-PR-31 this lived
  // inside Generation[] (per-platform, per-tab), which meant the
  // toggle only appeared AFTER generating drafts — buried in the
  // review panel and easy to miss. Surfacing it next to the platforms
  // picker makes the intent visible from the first click and the
  // schedule POST applies it only to Instagram (FB silently ignores).
  const [isStory, setIsStory] = useState(false);
  // PR #32 — Sprint 5.3: Reel intent + uploaded-video state.
  // Mutually exclusive with isStory (a single post can't be both —
  // enforced both client-side and server-side).
  const [isReel, setIsReel] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoMetadata, setVideoMetadata] = useState<VideoMetadata | null>(
    null
  );

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

  // PR #31 — Sprint 5.2.1: reset Story flag when Instagram leaves
  // the platform set. Otherwise the user could check "Story", swap
  // to Facebook only, and end up with a flagged-but-impossible
  // schedule that the server would 400 anyway.
  useEffect(() => {
    if (!platforms.includes('instagram')) {
      if (isStory) setIsStory(false);
      // PR #32 — Reel state collapses too. videoUrl stays uploaded
      // in Supabase (cheap to leave) but we drop the local
      // reference so re-toggling Reel later starts clean.
      if (isReel) setIsReel(false);
      if (videoUrl) {
        setVideoUrl(null);
        setVideoMetadata(null);
      }
    }
  }, [platforms, isStory, isReel, videoUrl]);

  // PR #32 — Sprint 5.3: Story / Reel are mutually exclusive. The
  // last-clicked toggle wins. Server-side guard re-validates this so
  // a stale state can't slip through.
  useEffect(() => {
    if (isStory && isReel) {
      // Whichever became true last wins; React batches but in practice
      // setIsStory and setIsReel are wired to user clicks so they
      // can't fire in the same render. If we ever land here, drop
      // the Story (Reel is the heavier intent — it has an upload).
      setIsStory(false);
    }
  }, [isStory, isReel]);

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

      // Some failures (Vercel default 500, edge timeout, etc.) return
      // HTML instead of JSON. Pre-PR-20 we called res.json() blind and
      // crashed with "Unexpected token 'A', 'An error o'..." — now we
      // try JSON first, fall back to a status-derived message if the
      // response body isn't JSON.
      let data: { ok?: boolean; visual?: { url: string; prompt: string }; error?: string; hint?: string } = {};
      try {
        data = await res.json();
      } catch {
        patchDraft(platform, draftIdx, {
          visualLoading: false,
          visualError: `Server error (${res.status}). Please try again in a moment.`,
        });
        return;
      }

      if (res.ok && data.ok && data.visual) {
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
      // Same defensive parse as handleGenerateVisual — never assume the
      // response is JSON (chromium boot timeouts often return HTML).
      let data: { ok?: boolean; carousel?: { slides?: Array<{ url: string }>; totalSlides?: number }; error?: string; hint?: string } = {};
      try {
        data = await res.json();
      } catch {
        patchDraft(platform, draftIdx, {
          visualLoading: false,
          visualError: `Server error (${res.status}). Please try again in a moment.`,
        });
        return;
      }
      if (res.ok && data.ok && data.carousel?.slides?.[0]) {
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
                // PR #31 — Sprint 5.2.1: top-level isStory applies only
                // to Instagram drafts. Server enforces this too (400
                // on isStory + non-instagram), but filtering here means
                // an FB+IG batch with the toggle on schedules cleanly:
                // FB as feed, IG as Story.
                isStory: isStory && g.platform === 'instagram',
                // PR #32 — Sprint 5.3: Reels also Instagram-only. We
                // ship the videoUrl + metadata so the server can
                // re-validate without re-parsing. Mutually exclusive
                // with isStory at the per-platform level (server 400
                // catches any inconsistency).
                isReel: isReel && g.platform === 'instagram',
                videoUrl:
                  isReel && g.platform === 'instagram' ? videoUrl : null,
                videoDurationSeconds:
                  isReel && g.platform === 'instagram'
                    ? videoMetadata?.duration ?? null
                    : null,
                videoSizeBytes:
                  isReel && g.platform === 'instagram'
                    ? videoMetadata?.sizeBytes ?? null
                    : null,
                videoAspectRatio:
                  isReel && g.platform === 'instagram'
                    ? videoMetadata?.aspectRatio ?? null
                    : null,
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

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const minDateTime = localMinDatetime();
  const activeGeneration = activeTab
    ? generations.find((g) => g.platform === activeTab) ?? null
    : null;

  // PR #22: outer padding + Marketing h1 moved up to the new
  // /marketing/layout.tsx so the sub-tab nav (Generate / Calendar /
  // Library) renders right under the header. This component is
  // now mounted inside that layout via /marketing/generate/page.tsx,
  // so it should NOT render its own page chrome.
  return (
    <div>
      <DriftAlert projectId={project.id} />

      <PerformanceInsights projectId={project.id} />

      <BrandBibleCard
        project={{
          id: project.id,
          name: project.name,
          brandUrl: project.brandUrl,
          brandContext:
            (project.brandContext as BrandBible | null) ?? null,
        }}
      />

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

              {/* PR #31/#32 — Story + Reel toggles surfaced next to
                  the platforms picker. Both no-op for non-Instagram
                  platforms. imageUrl for the Story warning is null
                  pre-generation; once drafts exist, we feed the
                  selected Instagram draft's visual so the dimension
                  validator fires reactively. The Reel toggle owns
                  its own video upload state. */}
              {platforms.includes('instagram') && (
                <div className="mt-4 space-y-2">
                  <StoryToggle
                    platform="instagram"
                    imageUrl={(() => {
                      const igGen = generations.find(
                        (g) => g.platform === 'instagram'
                      );
                      const sel = igGen?.drafts[igGen.selectedDraftIdx];
                      return sel?.visual?.url ?? null;
                    })()}
                    isStory={isStory}
                    onChange={(next) => {
                      setIsStory(next);
                      if (next && isReel) setIsReel(false);
                    }}
                  />
                  <ReelToggle
                    platform="instagram"
                    userId={userId}
                    isReel={isReel}
                    videoUrl={videoUrl}
                    videoMetadata={videoMetadata}
                    onChangeReel={(next) => {
                      setIsReel(next);
                      if (next && isStory) setIsStory(false);
                    }}
                    onChangeVideo={(url, meta) => {
                      setVideoUrl(url);
                      setVideoMetadata(meta);
                    }}
                  />
                </div>
              )}
            </div>

            <div className="mb-4">
              <SmartTemplatesSection
                projectId={project.id}
                platforms={platforms}
                onSelect={(promptStarter) => {
                  // Smart templates set the prompt directly. We clear
                  // selectedTemplate (the hardcoded ID) because the smart
                  // template doesn't map to a server-side systemHint.
                  setPrompt(promptStarter);
                  setSelectedTemplate(null);
                }}
                fallbackContent={
                  <div className="space-y-3">
                    <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3">
                      Choose a template (optional)
                    </div>
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
                }
              />
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

                      {/* PR #31 — StoryToggle moved up next to the
                          platforms picker so users see the option from
                          the first click. The toggle below is gone;
                          schedule per-Instagram-draft reads the
                          top-level isStory state. */}

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

        {/*
          PR #23 — Library CTA. Pre-PR-23 the right sidebar showed
          "Upcoming posts" + "Recent generations" — useful but cluttered
          and hard to find ("View all scheduled" was buried). The whole
          archive (drafts + scheduled + published + cancelled, with
          performance feedback + clone) now lives under /marketing/library.
        */}
        <div className="mt-2 p-6 border border-border rounded-xl bg-bg-elev">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h3 className="font-display text-lg mb-1">
                Looking for past posts?
              </h3>
              <p className="text-sm text-text-2">
                All your drafts, scheduled posts, and published content live
                in your Library — with performance feedback and clone-and-remix.
              </p>
            </div>
            <Link
              href="/marketing/library"
              className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity whitespace-nowrap self-start sm:self-auto"
            >
              → Open Library
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
