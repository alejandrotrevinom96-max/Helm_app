'use client';

// PR #23 — Sprint 2.2.
//
// Detail modal for a single Library post. Shows:
//   - the full content + visual
//   - status / platform / dates
//   - feedback section (rating + notes + 4 manual metrics) — only for
//     scheduled_posts rows that have status='published' (drafts and
//     pending-scheduled posts have nothing to rate yet)
//   - "Clone & remix" action (always available)
//
// The feedback Save button issues PATCH /api/marketing/library/[id].
// Clone issues POST /api/marketing/library/[id]/clone and redirects.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LibraryPost } from '@/app/api/marketing/library/route';
import { ShareButton } from '@/components/share/share-button';
import { ShipsWheelLoader, PulseMarkLoader } from '@/components/ui/loaders';
import { ScheduleModal } from './schedule-modal';
// PR Sprint D-4 — Lipsync re-render modal. Surfaced on UGC /
// Reel rows that already have a completed HeyGen render — lets
// the founder tweak the spoken script + re-render at 5-10x
// lower cost than a full Avatar IV pass.
import { LipsyncRerenderModal } from './lipsync-rerender-modal';
// PR Sprint D-5 — Video Translation modal. Surfaced alongside the
// Lipsync button on rows with a completed HeyGen render — kicks
// off multi-language translations of the same source video via
// HeyGen's V3 video-translations endpoint.
import { TranslateModal } from './translate-modal';

// PR #86 — Sprint 7.10: HeyGen video job lifecycle types. Mirrors
// the serializeJob() shape in /api/heygen/jobs.
interface HeygenJobView {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | string;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  errorMessage: string | null;
  errorKind: string | null;
}

// PR #86 — Sprint 7.10: video content types eligible for HeyGen.
// The brief mentions "Reel" and "UGC Script"; we key off the
// canonical contentType strings the structured-draft pipeline
// emits.
const VIDEO_CONTENT_TYPES = new Set<string | null>(['reel', 'ugc']);

// PR #86 — Sprint 7.10: which platforms map "View on platform"
// to a known external URL. For X we synthesize the tweet URL
// from metaPostId (which is the tweet id for x-platform rows).
// Future entries: 'linkedin', 'threads' — once those publishers
// persist their post id in a queryable way the same map handles
// them.
function platformPostUrl(post: LibraryPost): string | null {
  if (post.metaPermalink) return post.metaPermalink;
  if (post.platform === 'x' && post.metaPostId) {
    return `https://x.com/i/web/status/${post.metaPostId}`;
  }
  return null;
}

function platformDisplayName(platform: string): string {
  switch (platform) {
    case 'instagram':
      return 'Instagram';
    case 'facebook':
      return 'Facebook';
    case 'linkedin':
      return 'LinkedIn';
    case 'threads':
      return 'Threads';
    case 'x':
      return 'X';
    case 'reddit':
      return 'Reddit';
    case 'tiktok':
      return 'TikTok';
    default:
      return platform.charAt(0).toUpperCase() + platform.slice(1);
  }
}

// PR #88 — Sprint 7.12: image-format content types eligible for
// Flux generation from the Library modal. Mirrors FLUX_TYPES in
// the Generator panel — kept duplicated here (rather than a
// shared constant) because the two surfaces have slightly
// different lifecycle assumptions about when a button should
// show (Library = drafts that haven't generated yet; Generator
// = freshly-produced drafts).
const FLUX_CONTENT_TYPES = new Set<string | null>([
  'photo',
  'single_image',
  'carousel',
]);

interface Props {
  post: LibraryPost;
  onClose: () => void;
  onUpdate: (updated: LibraryPost) => void;
  onClone: () => void;
  // PR #24 — Sprint 2.3: parent removes the post from its in-memory
  // list when delete or move-to-draft succeeds, so we don't need a
  // full page reload.
  onRemove: (id: string) => void;
  // PR Sprint 7.26 — Asset-based content flow. Other posts in the
  // same content_asset group, so the embedded ScheduleModal can
  // offer "also schedule [other platforms]" + stagger-by-golden-
  // time. Empty/undefined when the parent didn't find siblings
  // (legacy single-platform post, or asset group of 1).
  assetSiblings?: Array<{ id: string; platform: string }>;
}

const RATING_OPTIONS = [
  { value: 'worked', emoji: '👍', label: 'Worked' },
  { value: 'flopped', emoji: '👎', label: 'Flopped' },
  { value: 'not_sure', emoji: '❓', label: 'Not sure' },
] as const;

const METRIC_FIELDS = [
  { key: 'metricsImpressions', label: 'Impressions' },
  { key: 'metricsLikes', label: 'Likes' },
  { key: 'metricsComments', label: 'Comments' },
  { key: 'metricsShares', label: 'Shares' },
] as const;

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function PostDetailModal({
  post,
  onClose,
  onUpdate,
  onClone,
  onRemove,
  assetSiblings,
}: Props) {
  const [rating, setRating] = useState<string | null>(post.performanceRating);
  const [notes, setNotes] = useState(post.performanceNote ?? '');
  const [metrics, setMetrics] = useState<Record<string, string>>({
    metricsImpressions: post.metricsImpressions?.toString() ?? '',
    metricsLikes: post.metricsLikes?.toString() ?? '',
    metricsComments: post.metricsComments?.toString() ?? '',
    metricsShares: post.metricsShares?.toString() ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [movingToDraft, setMovingToDraft] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // PR Sprint 7.17 — inline edit on drafts. The Voice Engine
  // needs (original, edited) pairs to learn from; "Edit & Save"
  // exposes that signal cleanly. State is gated on
  // isDraft below so the textarea never renders for scheduled
  // / published rows (those go through the publisher's lane,
  // not the engine's).
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(post.content);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSavedAt, setEditSavedAt] = useState<number | null>(null);
  // PR #29 — manual retry for posts whose auto-publish failed. We
  // don't auto-poll the publishStatus because the Library refetches
  // every time the user opens this modal anyway.
  const [retryingPublish, setRetryingPublish] = useState(false);
  // PR #55 — Sprint 6.9: restore-from-hidden flow.
  const [restoring, setRestoring] = useState(false);
  // PR #80 — Sprint 7.5.2: Schedule + Post Now flows. Both only
  // surface for drafts (source==='generated'); scheduled rows
  // already live in the publisher's lane.
  const [showSchedule, setShowSchedule] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postResult, setPostResult] = useState<{
    success: boolean;
    message: string;
    permalink?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isDraft = post.source === 'generated';
  // PR #86 — Sprint 7.10 (Bug #3 / FIX 3): "Post now" now surfaces
  // for both drafts AND status='scheduled' rows. Scheduled rows
  // route through the same /publish-now endpoint with
  // ?fromScheduled=1 — the endpoint detects the existing
  // scheduled_posts row instead of creating a fresh one.
  const canPostNow =
    isDraft || (post.source === 'scheduled' && post.status === 'scheduled');

  // PR #86 — Sprint 7.10: HeyGen video job state for reel / ugc
  // posts. PR #87 — Sprint 7.11: extended to scheduled rows too —
  // the GET /api/heygen/jobs endpoint now accepts scheduledPostId
  // and finds the matching job via project+user+completed
  // heuristic.
  const isVideoFormat = VIDEO_CONTENT_TYPES.has(post.contentType);
  const [heygenJob, setHeygenJob] = useState<HeygenJobView | null>(null);
  const [heygenLoading, setHeygenLoading] = useState(false);
  const [heygenError, setHeygenError] = useState<string | null>(null);
  const [heygenStarting, setHeygenStarting] = useState(false);
  // PR Sprint D-4 — lipsync re-render modal toggle.
  const [lipsyncOpen, setLipsyncOpen] = useState(false);
  // PR Sprint D-5 — translation modal toggle.
  const [translateOpen, setTranslateOpen] = useState(false);
  // Polling guard — only one interval per modal mount.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // PR #87 — Sprint 7.11: TikTok publish job state. Only relevant
  // on scheduled rows with a completed heygen video.
  const [tiktokStatus, setTiktokStatus] = useState<{
    publishId: string | null;
    status: string | null;
    failReason: string | null;
  }>({ publishId: null, status: null, failReason: null });
  const [tiktokSending, setTiktokSending] = useState(false);
  const [tiktokError, setTiktokError] = useState<string | null>(null);
  const [tiktokConnected, setTiktokConnected] = useState<boolean | null>(
    null,
  );
  const tiktokPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchHeygenJob = useCallback(async () => {
    if (!isVideoFormat) return;
    try {
      // For drafts we lookup by draftId (direct FK); for scheduled
      // rows we lookup by scheduledPostId (heuristic).
      const qs = isDraft
        ? `draftId=${post.id}`
        : `scheduledPostId=${post.id}`;
      const res = await fetch(`/api/heygen/jobs?${qs}`);
      if (!res.ok) return;
      const data = (await res.json()) as { job: HeygenJobView | null };
      setHeygenJob(data.job);
    } catch {
      // Best-effort; UI stays in the previous state on transient
      // errors.
    }
  }, [isVideoFormat, isDraft, post.id]);

  useEffect(() => {
    if (!isVideoFormat) return;
    setHeygenLoading(true);
    void fetchHeygenJob().finally(() => setHeygenLoading(false));
  }, [isVideoFormat, fetchHeygenJob]);

  // PR #86 — Sprint 7.10: 15-second poll while processing. The
  // webhook is the source of truth (it updates the DB row); this
  // poll just pulls the latest status so the UI flips to
  // "completed" or "failed" without a manual refresh.
  useEffect(() => {
    if (!heygenJob) return;
    if (heygenJob.status !== 'processing' && heygenJob.status !== 'queued') {
      return;
    }
    pollRef.current = setInterval(() => {
      void fetchHeygenJob();
    }, 15000);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [heygenJob, fetchHeygenJob]);

  // PR #87 — Sprint 7.11: TikTok integration check + existing job
  // fetch. Only fires for scheduled rows because the upload endpoint
  // requires scheduledPostId.
  useEffect(() => {
    if (post.source !== 'scheduled' || !isVideoFormat) return;
    let cancelled = false;
    (async () => {
      try {
        const [testRes, uploadRes] = await Promise.all([
          fetch('/api/integrations/tiktok/test', { cache: 'no-store' }),
          fetch(`/api/integrations/tiktok/upload?scheduledPostId=${post.id}`),
        ]);
        const testData = (await testRes.json().catch(() => ({}))) as {
          connected?: boolean;
          hasUploadScope?: boolean;
        };
        if (!cancelled) {
          setTiktokConnected(
            Boolean(testData.connected && testData.hasUploadScope),
          );
        }
        if (uploadRes.ok) {
          const uploadData = (await uploadRes.json()) as {
            job: {
              publishId: string;
              status: string;
              errorMessage: string | null;
            } | null;
          };
          if (uploadData.job && !cancelled) {
            setTiktokStatus({
              publishId: uploadData.job.publishId,
              status: uploadData.job.status,
              failReason: uploadData.job.errorMessage,
            });
          }
        }
      } catch {
        // Best-effort; the UI degrades to "not connected" if /test
        // fails, which is the safe fallback.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [post.source, post.id, isVideoFormat]);

  // PR #87 — Sprint 7.11: TikTok 5-second poll while in
  // PROCESSING_UPLOAD. Terminal statuses
  // (SEND_TO_USER_INBOX / PUBLISH_COMPLETE / FAILED) stop the poll.
  useEffect(() => {
    if (
      !tiktokStatus.publishId ||
      tiktokStatus.status === 'SEND_TO_USER_INBOX' ||
      tiktokStatus.status === 'PUBLISH_COMPLETE' ||
      tiktokStatus.status === 'FAILED'
    ) {
      if (tiktokPollRef.current) {
        clearInterval(tiktokPollRef.current);
        tiktokPollRef.current = null;
      }
      return;
    }
    tiktokPollRef.current = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/integrations/tiktok/status?publishId=${tiktokStatus.publishId}`,
        );
        const data = (await res.json()) as {
          status: string;
          failReason: string | null;
        };
        setTiktokStatus((prev) => ({
          ...prev,
          status: data.status,
          failReason: data.failReason ?? null,
        }));
      } catch {
        // ignore — next tick retries
      }
    }, 5000);
    return () => {
      if (tiktokPollRef.current) {
        clearInterval(tiktokPollRef.current);
        tiktokPollRef.current = null;
      }
    };
  }, [tiktokStatus.publishId, tiktokStatus.status]);

  const handleSendToTikTok = async () => {
    if (tiktokSending) return;
    setTiktokSending(true);
    setTiktokError(null);
    try {
      const res = await fetch('/api/integrations/tiktok/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledPostId: post.id }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        publishId?: string;
        status?: string;
        error?: string;
        hint?: string;
      };
      if (!res.ok || !data.success) {
        setTiktokError(data.error ?? data.hint ?? 'TikTok upload failed');
        return;
      }
      setTiktokStatus({
        publishId: data.publishId ?? null,
        status: data.status ?? 'PROCESSING_UPLOAD',
        failReason: null,
      });
    } catch (e) {
      setTiktokError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setTiktokSending(false);
    }
  };

  // PR #88 — Sprint 7.12: Flux image generation for photo /
  // carousel drafts. Single-image content types go through
  // /api/visuals/generate (single Flux call), carousel slides
  // go through /api/marketing/posts/[id]/generate-slides
  // (one call per slide). Both endpoints persist the resulting
  // URL(s) onto generatedPosts so a reload re-hydrates the
  // images.
  const isImageFormat =
    isDraft && FLUX_CONTENT_TYPES.has(post.contentType);
  const isCarouselFormat = post.contentType === 'carousel';
  const [imageGenerating, setImageGenerating] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [generatedSingleUrl, setGeneratedSingleUrl] = useState<string | null>(
    null,
  );
  const [generatedSlideUrls, setGeneratedSlideUrls] = useState<string[]>([]);

  const handleGenerateImage = async () => {
    if (imageGenerating) return;
    setImageGenerating(true);
    setImageError(null);
    try {
      if (isCarouselFormat) {
        const res = await fetch(
          `/api/marketing/posts/${post.id}/generate-slides`,
          { method: 'POST' },
        );
        const data = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          visualUrls?: (string | null)[];
          error?: string;
          hint?: string;
        };
        if (!res.ok || !data.success) {
          setImageError(data.error ?? data.hint ?? 'Slide generation failed');
          return;
        }
        const urls = (data.visualUrls ?? []).filter(
          (u): u is string => typeof u === 'string' && u.length > 0,
        );
        setGeneratedSlideUrls(urls);
      } else {
        // Single-photo path. The visuals endpoint needs the post
        // caption to scaffold the image prompt — pull from the
        // structured content where available (TikTok photos have
        // a dedicated `imageDirection` field), fall back to the
        // plain caption / content.
        const sc = post.structuredContent as
          | Record<string, unknown>
          | null;
        const postContent =
          (typeof sc?.imageDirection === 'string' && sc.imageDirection) ||
          (typeof sc?.caption === 'string' && sc.caption) ||
          post.content ||
          'Generate a brand-aligned image for this post.';
        const res = await fetch('/api/visuals/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: post.projectId,
            platform: post.platform,
            postContent,
            draftId: post.id,
          }),
        });
        // PR Sprint 7.13 hotfix v2 (BUG 3A) — /api/visuals/generate
        // wraps the result under `visual: { url, ... }`. Sprint
        // 7.12's first wiring read `data.imageUrl ?? data.url` which
        // never matched, so the founder generated an image but the
        // preview in the modal stayed empty (and they thought the
        // button was broken).
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          visual?: { url?: string };
          error?: string;
          hint?: string;
        };
        if (!res.ok || !data.ok || !data.visual?.url) {
          setImageError(
            data.error ?? data.hint ?? 'Image generation failed',
          );
          return;
        }
        setGeneratedSingleUrl(data.visual.url);
      }
    } catch (e) {
      setImageError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setImageGenerating(false);
    }
  };

  // PR Sprint 7.17 — Save an edited draft. Two side effects:
  //   1. PATCH the draft so the new content is persisted +
  //      surfaced in Library / Calendar / Generate-page rehydrate.
  //   2. POST /api/voice-engine/record-edit so the heuristic
  //      classifier turns (original, edited) into Signals that
  //      feed processSignals → learned_overrides.
  // We pass feedbackTier='minor_edits' (weight 0.7) because the
  // founder still considered the draft worth keeping; "discard"
  // is the Delete button and "regenerate" is a separate flow.
  const handleSaveEdit = async () => {
    if (editSaving) return;
    const original = post.content;
    const edited = editDraft.trim();
    if (edited.length === 0) {
      setEditError('Content cannot be empty');
      return;
    }
    if (edited === original) {
      // No change — close the editor without firing anything.
      setEditing(false);
      return;
    }
    setEditSaving(true);
    setEditError(null);
    try {
      const patchRes = await fetch(
        `/api/marketing/library/${post.id}?source=${post.source}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: edited }),
        },
      );
      const patchData = (await patchRes.json().catch(() => ({}))) as {
        post?: { content?: string };
        previousContent?: string;
        error?: string;
      };
      if (!patchRes.ok) {
        setEditError(patchData.error ?? 'Save failed');
        return;
      }

      // Optimistic local update so the modal reflects the new
      // content without the parent refetch.
      onUpdate({ ...post, content: edited });
      setEditSavedAt(Date.now());
      setEditing(false);

      // Fire the Voice Engine. The classifier needs a content_type
      // it understands; drafts always carry one when produced by
      // the structured pipeline. Best-effort: a hook failure
      // never blocks the save.
      void fetch('/api/voice-engine/record-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: post.projectId,
          platform: post.platform,
          contentType: post.contentType ?? 'text',
          postId: post.id,
          original: patchData.previousContent ?? original,
          edited,
          feedbackTier: 'minor_edits',
        }),
      }).catch(() => {
        /* engine failure is operator-visible via the audit log;
           don't surface to the founder */
      });
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setEditSaving(false);
    }
  };

  const handleGenerateVideo = async () => {
    if (heygenStarting) return;
    setHeygenStarting(true);
    setHeygenError(null);
    try {
      // Step 1 — create (or reuse) the job row.
      const createRes = await fetch('/api/heygen/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftId: post.id }),
      });
      const createData = (await createRes.json().catch(() => ({}))) as {
        job?: HeygenJobView;
        error?: string;
      };
      if (!createRes.ok || !createData.job) {
        setHeygenError(createData.error ?? 'Could not create job');
        return;
      }
      // If the job is already completed (idempotent reuse), no
      // need to fire HeyGen again.
      if (createData.job.status === 'completed') {
        setHeygenJob(createData.job);
        return;
      }
      // Step 2 — fire HeyGen.
      const fireRes = await fetch('/api/heygen/generate-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: createData.job.id }),
      });
      const fireData = (await fireRes.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        hint?: string;
        errorKind?: string;
      };
      if (!fireRes.ok || !fireData.success) {
        setHeygenError(
          fireData.error ??
            fireData.hint ??
            'Could not start video generation',
        );
      }
      // Refetch the job either way — fireData failures still
      // leave a row in the table (status='failed') we want
      // surfaced.
      await fetchHeygenJob();
    } catch (e) {
      setHeygenError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setHeygenStarting(false);
    }
  };

  const handlePostNow = async () => {
    if (posting) return;
    if (
      !window.confirm(
        'Publish this post NOW? Goes straight to the connected integration.',
      )
    ) {
      return;
    }
    setPosting(true);
    setError(null);
    setPostResult(null);
    try {
      // PR #86 — Sprint 7.10 (FIX 3): scheduled rows hit the same
      // endpoint with a query flag so the endpoint knows not to
      // expect a draft.
      const qs = post.source === 'scheduled' ? '?fromScheduled=1' : '';
      const res = await fetch(
        `/api/marketing/posts/${post.id}/publish-now${qs}`,
        { method: 'POST' },
      );
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        hint?: string;
        permalink?: string;
        scheduledPostId?: string;
      };
      if (!res.ok || !data.success) {
        setPostResult({
          success: false,
          message:
            data.error ?? data.hint ?? 'Publish failed',
        });
        return;
      }
      setPostResult({
        success: true,
        message: 'Posted ✓',
        permalink: data.permalink,
      });
      // Remove the row from the Library list. For drafts this drops
      // them from Drafts; for scheduled rows this drops them from
      // Scheduled — on close the parent refetches and the post
      // resurfaces under Published.
      onRemove(post.id);
    } catch (e) {
      setPostResult({
        success: false,
        message: e instanceof Error ? e.message : 'Network error',
      });
    } finally {
      setPosting(false);
    }
  };

  const handleScheduled = (when: string) => {
    setShowSchedule(false);
    // Schedule endpoint deletes the draft + inserts a
    // scheduled_posts row. Drop the row from the in-memory list
    // here; parent will refetch on next mount.
    onRemove(post.id);
    setPostResult({
      success: true,
      message: `Scheduled for ${new Date(when).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })}`,
    });
  };

  // PR #55 — Sprint 6.9: draft was Hidden via the Generate/Library
  // voting UI (visibleInLibrary=false + userVote='disliked').
  // Restore puts it back to default-visible (vote: null).
  const isHiddenDraft =
    post.source === 'generated' && post.userVote === 'disliked';

  const handleRestore = async () => {
    if (restoring) return;
    setRestoring(true);
    setError(null);
    try {
      const res = await fetch(`/api/marketing/posts/${post.id}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vote: null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          (data as { error?: string }).error ??
            'Restore failed'
        );
        setRestoring(false);
        return;
      }
      // Restore moves the draft out of the Hidden tab; the
      // parent list refetches via onRemove so the modal can
      // close cleanly.
      onRemove(post.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
      setRestoring(false);
    }
  };

  const showFeedback =
    post.source === 'scheduled' && post.status === 'published';

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        performanceRating: rating,
        performanceNote: notes,
      };
      for (const { key } of METRIC_FIELDS) {
        const v = metrics[key];
        body[key] = v === '' ? null : Number(v);
      }
      const res = await fetch(`/api/marketing/library/${post.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Save failed');
        return;
      }
      // Server returned the raw scheduled_posts row; map it back into
      // LibraryPost shape so the parent stays consistent.
      const updated: LibraryPost = {
        ...post,
        performanceRating: data.post?.performanceRating ?? null,
        performanceNote: data.post?.performanceNote ?? null,
        metricsImpressions: data.post?.metricsImpressions ?? null,
        metricsLikes: data.post?.metricsLikes ?? null,
        metricsComments: data.post?.metricsComments ?? null,
        metricsShares: data.post?.metricsShares ?? null,
      };
      onUpdate(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setSaving(false);
    }
  };

  const handleMoveToDraft = async () => {
    if (
      !confirm(
        'Mover este post de vuelta a Drafts? El horario agendado se borrará.'
      )
    ) {
      return;
    }
    setMovingToDraft(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/marketing/library/${post.id}/move-to-draft`,
        { method: 'POST' }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Move failed');
        setMovingToDraft(false);
        return;
      }
      // The original scheduled row is gone; remove it from the parent
      // list and close. The new draft will appear next time the parent
      // refetches counts (which it does on every removal).
      onRemove(post.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
      setMovingToDraft(false);
    }
  };

  const handleRetryPublish = async () => {
    setRetryingPublish(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/marketing/library/${post.id}/retry-publish`,
        { method: 'POST' }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setError(data?.error ?? 'Retry failed');
        setRetryingPublish(false);
        return;
      }
      // Reflect success locally — parent will pick up canonical state
      // on next refetch but we update optimistically so the modal
      // doesn't keep showing "Failed" while we wait.
      onUpdate({
        ...post,
        publishStatus: 'published',
        publishFailureReason: null,
        metaPermalink: data.permalink ?? post.metaPermalink,
        status: 'published',
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
      setRetryingPublish(false);
    }
  };

  const handleDelete = async () => {
    if (
      !confirm(
        'Eliminar este post permanentemente? Esta acción NO se puede deshacer.'
      )
    ) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/marketing/library/${post.id}?source=${post.source}`,
        { method: 'DELETE' }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? 'Delete failed');
        setDeleting(false);
        return;
      }
      onRemove(post.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
      setDeleting(false);
    }
  };

  const handleClone = async () => {
    setCloning(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/marketing/library/${post.id}/clone`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceTable: post.source }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Clone failed');
        setCloning(false);
        return;
      }
      onClone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
      setCloning(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-bg-elev border border-border rounded-xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-4">
          <div>
            {/* PR Sprint 7.24 — Prompt 4. Header surfaces the
                content type alongside platform + status so the
                founder knows at a glance whether they're looking
                at a Carousel, Single Photo, UGC script, etc. The
                contentType is humanized via the same labels the
                shared ContentTypeBadge uses for the cards. */}
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-accent mb-1">
              {post.platform} · {post.status}
              {post.contentType && (
                <span> · {post.contentType.replace(/_/g, ' ')}</span>
              )}
            </div>
            <h3 className="font-display text-2xl font-light">Post detail</h3>
          </div>
          <button
            onClick={onClose}
            className="text-text-3 hover:text-text-1 text-xl leading-none p-1"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* PR Sprint 7.27 — UGC/Reel script block. For video
            assets we show the SCRIPT (asset.baseContent — what the
            HeyGen avatar actually speaks) ABOVE the per-platform
            caption block, so the founder doesn't confuse the two.
            Sourced from structuredContent which generate-asset
            stamps as {assetType, baseContent}. Skipped silently
            for non-video types so legacy single-caption rows
            render unchanged. */}
        {(() => {
          if (post.contentType !== 'ugc' && post.contentType !== 'reel') {
            return null;
          }
          const script = (
            post.structuredContent as { baseContent?: string } | null
          )?.baseContent;
          if (!script) return null;
          return (
            <div className="mb-4 p-4 rounded-lg border border-amber-500/30 bg-amber-500/5">
              <div className="flex items-baseline justify-between mb-2">
                <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-amber-500">
                  🎥 Script · spoken by avatar
                </div>
                <span className="text-[10px] font-mono text-text-3">
                  {script.split(/\s+/).filter(Boolean).length} words
                </span>
              </div>
              <p className="text-sm text-text-1 whitespace-pre-wrap leading-relaxed">
                {script}
              </p>
            </div>
          );
        })()}

        {/* Content
            PR Sprint 7.17 — drafts (source='generated') can now
            be edited inline. The "Edit" toggle swaps the
            read-only paragraph for a textarea + Save / Cancel.
            On Save we PATCH the draft AND fire the Voice Engine
            record-edit hook so the heuristic classifier turns
            (original, edited) into learning signals. Scheduled
            / published rows stay read-only here (they go
            through the publisher's lane, not the engine's).

            PR Sprint 7.27 — for UGC/Reel this block now shows the
            per-platform CAPTION (not the script — the script block
            sits above). A small mono label clarifies which is which. */}
        <div className="mb-4 p-4 bg-bg border border-border rounded-lg space-y-2">
          {(post.contentType === 'ugc' || post.contentType === 'reel') && (
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-accent">
              ✏️ {post.platform} caption
            </div>
          )}
          {editing && isDraft ? (
            <>
              <textarea
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                rows={8}
                className="w-full px-3 py-2 bg-bg-elev border border-border rounded-md text-sm text-text-1 focus:outline-none focus:border-border-bright resize-y"
                placeholder="Edit the draft content…"
              />
              {editError && (
                <div className="text-xs text-danger">{editError}</div>
              )}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setEditDraft(post.content);
                    setEditError(null);
                  }}
                  disabled={editSaving}
                  className="px-3 py-1.5 text-xs text-text-2 hover:text-text-1 rounded-md transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  disabled={editSaving}
                  className="px-3 py-1.5 text-xs bg-accent text-white rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {editSaving ? 'Saving…' : 'Save edits'}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-text-1 whitespace-pre-wrap">
                {post.content}
              </p>
              {isDraft && (
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => {
                      setEditDraft(post.content);
                      setEditing(true);
                      setEditError(null);
                    }}
                    className="text-xs text-accent hover:underline"
                  >
                    ✎ Edit content
                  </button>
                  {editSavedAt &&
                    Date.now() - editSavedAt < 4000 && (
                      <span className="text-[10px] font-mono text-emerald-500">
                        Saved ✓
                      </span>
                    )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Visual */}
        {post.visualUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.visualUrl}
            alt=""
            className="w-full rounded-lg mb-4 bg-bg"
          />
        )}

        {/* PR #88 — Sprint 7.12: Flux image generation block for
            photo / carousel drafts that don't have visuals yet.
            Single-image hits /api/visuals/generate; carousel hits
            /api/marketing/posts/[id]/generate-slides. Both persist
            the URLs onto the draft so a refresh re-hydrates the
            preview without re-calling Flux. */}
        {isImageFormat &&
          !post.visualUrl &&
          (!post.visualUrls || post.visualUrls.length === 0) &&
          generatedSingleUrl === null &&
          generatedSlideUrls.length === 0 && (
            <div
              data-tiktok-image-gen
              className="mb-4 p-4 bg-bg border border-border rounded-lg space-y-3"
            >
              <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3">
                AI image
              </div>
              <p className="text-sm text-text-2">
                {isCarouselFormat
                  ? 'Generate an AI image per slide.'
                  : 'Generate an AI image for this post.'}
              </p>
              {imageGenerating ? (
                // PR Sprint 7.25 Phase 9 — Ship's Wheel replaces
                // the "🎨 Generating…" plain-text state. Same
                // semantic, the new loader is the app-wide signal
                // for "Helm is making a picture for me".
                <ShipsWheelLoader
                  size={36}
                  vertical={false}
                  label={
                    isCarouselFormat ? 'Charting slides' : 'Painting image'
                  }
                />
              ) : (
                <button
                  type="button"
                  onClick={handleGenerateImage}
                  className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:opacity-90"
                >
                  {isCarouselFormat
                    ? '🎨 Generate slides →'
                    : '🎨 Generate image →'}
                </button>
              )}
              {imageError && (
                <div className="text-xs text-danger">{imageError}</div>
              )}
            </div>
          )}

        {/* Just-generated single-image preview (session-only;
            refresh re-hydrates from post.visualUrl after the
            endpoint persisted it server-side). */}
        {generatedSingleUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={generatedSingleUrl}
            alt="Generated"
            className="w-full rounded-lg mb-4 bg-bg"
          />
        )}

        {/* Just-generated slide previews. */}
        {generatedSlideUrls.length > 0 && (
          <div className="mb-4 grid grid-cols-2 sm:grid-cols-3 gap-2">
            {generatedSlideUrls.map((url, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={`${url}-${i}`}
                src={url}
                alt={`Slide ${i + 1}`}
                className="w-full rounded-lg bg-bg border border-border"
              />
            ))}
          </div>
        )}

        {/* PR #86 — Sprint 7.10: HeyGen video block for Reel / UGC
            drafts. Renders one of five states keyed off the
            heygen_jobs row associated with this draft:
              - no job → "Generate video" CTA
              - queued → badge "Video queued"
              - processing → spinner + "Generating…" (15s poll)
              - completed → thumbnail preview + Download link
              - failed → error reason + Retry CTA
            We poll every 15s while in processing/queued. The
            webhook at /api/heygen/webhook is what actually flips
            the row; the poll just pulls the latest snapshot so
            the modal updates without the user refreshing. */}
        {isVideoFormat && (
          <div className="mb-4 p-4 bg-bg border border-border rounded-lg">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3">
                AI video
              </div>
              {heygenJob && (
                <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3">
                  {heygenJob.status}
                </div>
              )}
            </div>

            {heygenLoading && !heygenJob && (
              <div className="text-xs text-text-3">Checking job…</div>
            )}

            {!heygenLoading && !heygenJob && (
              <div className="space-y-2">
                <p className="text-sm text-text-2">
                  Turn this script into a talking-head video using
                  the avatar you configured in Settings.
                </p>
                <button
                  type="button"
                  onClick={handleGenerateVideo}
                  disabled={heygenStarting}
                  className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {heygenStarting ? 'Starting…' : '🎬 Generate video'}
                </button>
              </div>
            )}

            {heygenJob?.status === 'queued' && (
              // PR Sprint 7.25 Phase 9 — Pulse Mark loader. The
              // pulse rings communicate "Helm is actively
              // listening / waiting" which is exactly what
              // queued is (in line behind the HeyGen worker).
              <PulseMarkLoader
                size={48}
                vertical={false}
                label="Video queued"
                subLabel="rendering starts shortly"
              />
            )}

            {heygenJob?.status === 'processing' && (
              <PulseMarkLoader
                size={48}
                vertical={false}
                label="Rendering video"
                subLabel="usually 2-10 minutes"
              />
            )}

            {/* PR Sprint 7.26 — Asset-based content flow.
                videoUrl resolution order:
                  1. heygenJob.videoUrl — present when this draft
                     is the one a heygen_jobs row is keyed to (the
                     "primary" of the asset group).
                  2. post.videoUrl — hydrated by the library API's
                     LEFT JOIN on content_assets, present for the
                     SIBLING drafts in the same asset group that
                     don't have their own heygen_jobs row.
                We trust post.videoUrl alone as the readiness
                signal when no heygenJob is loaded (i.e. for
                siblings); the leftJoin only fills the column
                AFTER the webhook flips status to completed. */}
            {(() => {
              const displayVideoUrl =
                heygenJob?.videoUrl ?? post.videoUrl ?? null;
              const videoReady =
                (heygenJob?.status === 'completed' && !!heygenJob.videoUrl) ||
                (!heygenJob && !!post.videoUrl);
              if (!videoReady || !displayVideoUrl) return null;
              return (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-emerald-500">
                  <span>✓</span>
                  <span>Video ready</span>
                </div>
                {/* PR Sprint 7.26 — actual <video> player. Pre-fix
                    the modal only showed a thumbnail + download
                    link; the founder had to download to preview,
                    which is a friction point for a "is this the
                    right take?" check. Native controls + muted
                    autoplay-on-pause + loop matches the card-level
                    preview UX. */}
                <video
                  src={displayVideoUrl}
                  controls
                  playsInline
                  preload="metadata"
                  poster={heygenJob?.thumbnailUrl ?? undefined}
                  className="rounded-lg w-full max-w-md aspect-[9/16] object-cover bg-bg"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={displayVideoUrl}
                    download
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:opacity-90"
                  >
                    ⬇ Download video
                  </a>
                  {/* PR Sprint D-4 — re-render with edited script. Surfaces
                      only when we have a heygenJob.id to anchor the
                      lipsync to (siblings of an asset group don't have
                      their own job row). Cheaper alternative to firing
                      a full Avatar IV re-render through fire.ts. */}
                  {heygenJob?.id && (
                    <button
                      type="button"
                      onClick={() => setLipsyncOpen(true)}
                      className="inline-flex items-center gap-2 px-3 py-1.5 bg-bg border border-border rounded-lg text-xs font-medium hover:bg-bg-elev hover:border-border-bright"
                    >
                      ↻ Edit script & re-render
                    </button>
                  )}
                  {/* PR Sprint D-5 — translate the completed render
                      into up to 8 languages. Same gating as lipsync:
                      requires a real heygenJob.id (and the job must
                      be completed — server enforces this on POST). */}
                  {heygenJob?.id && heygenJob.status === 'completed' && (
                    <button
                      type="button"
                      onClick={() => setTranslateOpen(true)}
                      className="inline-flex items-center gap-2 px-3 py-1.5 bg-bg border border-border rounded-lg text-xs font-medium hover:bg-bg-elev hover:border-border-bright"
                    >
                      🌐 Translate
                    </button>
                  )}
                  {/* PR #87 — Sprint 7.11: Send to TikTok inbox.
                      Surfaces only on scheduled rows because the
                      upload endpoint requires a scheduledPostId.
                      Disabled when TikTok isn't connected; click
                      surfaces a hint instead of failing silently. */}
                  {post.source === 'scheduled' &&
                    tiktokStatus.status !== 'SEND_TO_USER_INBOX' &&
                    tiktokStatus.status !== 'PUBLISH_COMPLETE' &&
                    (tiktokConnected ? (
                      <button
                        type="button"
                        onClick={handleSendToTikTok}
                        disabled={
                          tiktokSending ||
                          tiktokStatus.status === 'PROCESSING_UPLOAD'
                        }
                        className="inline-flex items-center gap-2 px-3 py-1.5 bg-bg border border-border rounded-lg text-xs font-medium hover:bg-bg-elev hover:border-border-bright disabled:opacity-50"
                      >
                        {tiktokSending ||
                        tiktokStatus.status === 'PROCESSING_UPLOAD'
                          ? '🎵 Sending to TikTok…'
                          : tiktokStatus.status === 'FAILED'
                            ? '🎵 Retry TikTok'
                            : '🎵 Send to TikTok →'}
                      </button>
                    ) : (
                      <a
                        href="/integrations"
                        className="inline-flex items-center gap-2 px-3 py-1.5 bg-bg border border-border rounded-lg text-xs font-medium hover:bg-bg-elev hover:border-border-bright text-text-3"
                        title="Connect TikTok in /integrations first"
                      >
                        🎵 Connect TikTok to send →
                      </a>
                    ))}
                </div>
                {/* PR Sprint 7.26 — heygenJob may be null for
                    sibling drafts (the heygen_jobs row is keyed
                    to the FIRST draft only). Optional chain so
                    the duration row simply omits for siblings. */}
                {heygenJob?.durationSeconds != null && (
                  <div className="text-[10px] text-text-3">
                    Duration: {heygenJob.durationSeconds}s
                  </div>
                )}

                {/* PR #87 — Sprint 7.11: TikTok status row. Renders
                    once a publish job exists for this post. */}
                {tiktokStatus.publishId &&
                  tiktokStatus.status === 'PROCESSING_UPLOAD' && (
                    <div className="flex items-center gap-2 text-xs text-amber-500">
                      <span className="inline-block w-3 h-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                      <span>Sending to TikTok inbox…</span>
                    </div>
                  )}
                {tiktokStatus.status === 'SEND_TO_USER_INBOX' && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs text-emerald-500">
                      <span>✓</span>
                      <span>In your TikTok inbox</span>
                    </div>
                    <div className="text-[10px] text-text-3">
                      Open TikTok to publish — Helm doesn&apos;t push
                      Direct Posts (avoids TikTok app audit).
                    </div>
                  </div>
                )}
                {tiktokStatus.status === 'PUBLISH_COMPLETE' && (
                  <div className="flex items-center gap-2 text-xs text-emerald-500">
                    <span>✓</span>
                    <span>Published on TikTok</span>
                  </div>
                )}
                {tiktokStatus.status === 'FAILED' && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs text-danger">
                      <span>⚠</span>
                      <span>TikTok rejected the upload</span>
                    </div>
                    {tiktokStatus.failReason && (
                      <div className="text-[10px] text-text-3 font-mono">
                        {tiktokStatus.failReason}
                      </div>
                    )}
                  </div>
                )}
                {tiktokError && (
                  <div className="text-xs text-danger">{tiktokError}</div>
                )}
              </div>
              );
            })()}

            {heygenJob?.status === 'failed' && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-danger">
                  <span>⚠</span>
                  <span>Generation failed</span>
                </div>
                {heygenJob.errorMessage && (
                  <div className="text-xs text-text-3 bg-bg-elev p-2 rounded font-mono break-words">
                    {heygenJob.errorMessage}
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleGenerateVideo}
                  disabled={heygenStarting}
                  className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {heygenStarting ? 'Retrying…' : '↻ Retry'}
                </button>
              </div>
            )}

            {heygenError && (
              <div className="mt-2 text-xs text-danger">{heygenError}</div>
            )}
          </div>
        )}

        {/* PR #32 — Reel video preview + processing state. videoUrl
            is the Supabase Storage public URL we uploaded — we can
            preview it inline without going through Meta. */}
        {post.isReel && post.videoUrl && (
          <div className="mb-4">
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
              Reel video
            </div>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              src={post.videoUrl}
              controls
              playsInline
              className="w-full max-w-sm rounded bg-bg"
              style={{ aspectRatio: '9/16' }}
            />
            <div className="mt-2 text-xs text-text-3">
              {post.videoDurationSeconds
                ? `${post.videoDurationSeconds}s`
                : ''}
              {post.videoSizeBytes
                ? ` · ${(post.videoSizeBytes / (1024 * 1024)).toFixed(1)} MB`
                : ''}
            </div>
            {post.reelProcessingStatus === 'meta_processing' && (
              <div className="mt-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded text-xs text-amber-500">
                ⏱ Meta is processing this Reel. The polling worker will
                publish it once status hits FINISHED — typically 30–90
                seconds, sometimes longer for large videos.
              </div>
            )}
            {post.reelProcessingStatus === 'error' && (
              <div className="mt-2 p-2 bg-danger/10 border border-danger/30 rounded text-xs text-danger">
                ⊘ {post.reelProcessingError ?? 'Reel processing failed'}
              </div>
            )}
          </div>
        )}

        {/* Metadata */}
        <div className="mb-6 grid grid-cols-2 gap-3 text-xs">
          {post.scheduledFor && (
            <div>
              <span className="text-text-3 block">Scheduled for</span>
              <span className="text-text-1">
                {formatDateTime(post.scheduledFor)}
              </span>
            </div>
          )}
          {post.publishedAt && (
            <div>
              <span className="text-text-3 block">Published</span>
              <span className="text-text-1">
                {formatDateTime(post.publishedAt)}
              </span>
            </div>
          )}
          <div>
            <span className="text-text-3 block">Created</span>
            <span className="text-text-1">
              {formatDateTime(post.createdAt)}
            </span>
          </div>
          {/* PR Sprint 7.13 (BUG 2) — Brand fit as a prominent pill,
              matches the post-card badge style so the founder
              recognizes the same signal across surfaces. */}
          {post.consistencyScore !== null && (
            <div className="col-span-2">
              <span className="text-text-3 block mb-1">Brand fit</span>
              <span
                className={`text-xs font-mono uppercase tracking-[0.15em] font-bold px-2.5 py-1 rounded inline-flex items-center gap-2 ${
                  post.consistencyScore >= 80
                    ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30'
                    : post.consistencyScore >= 50
                      ? 'bg-accent/15 text-accent border border-accent/30'
                      : 'bg-danger/15 text-danger border border-danger/30'
                }`}
              >
                {post.consistencyScore}/100
              </span>
            </div>
          )}
        </div>

        {/* PR #29 — Publishing status block. Only renders for scheduled
            posts that have actually been touched by the publisher
            (publishStatus is set). Drafts and never-attempted posts
            don't show this. */}
        {post.source === 'scheduled' && post.publishStatus && (
          <div className="mb-5 p-4 bg-bg rounded-lg border border-border">
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
              Publishing
            </div>

            {post.publishStatus === 'publishing' && (
              <div className="text-sm text-amber-500">
                Publishing now…
              </div>
            )}

            {post.publishStatus === 'published' && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-emerald-500">
                  <span>✓</span>
                  <span>
                    {post.isStory
                      ? 'Story published successfully'
                      : 'Published successfully'}
                  </span>
                </div>
                {post.isStory && post.storyExpiresAt && (
                  <div className="text-xs">
                    {new Date(post.storyExpiresAt) > new Date() ? (
                      <span className="text-pink-500">
                        Expires{' '}
                        {new Date(post.storyExpiresAt).toLocaleString()}
                      </span>
                    ) : (
                      <span className="text-text-3">
                        Expired on{' '}
                        {new Date(post.storyExpiresAt).toLocaleString()}.
                        The permalink may no longer work unless you
                        archived this Story to a Highlight on Instagram.
                      </span>
                    )}
                  </div>
                )}
                {post.publishedAt && (
                  <div className="text-xs text-text-3">
                    {new Date(post.publishedAt).toLocaleString()}
                  </div>
                )}
                {/* PR #86 — Sprint 7.10 (Bug #3 / FIX 2): the
                    "View on platform" link now works for X /
                    LinkedIn / Threads too, and the label adapts
                    to the actual platform. For X we synthesize
                    the URL from metaPostId (the tweet id) since
                    Twitter doesn't return a permalink directly.
                    For the others we use the persisted
                    metaPermalink. Previous version only handled
                    Instagram / Facebook labels and rendered
                    nothing for X (the bug). */}
                {(() => {
                  const url = platformPostUrl(post);
                  if (!url) return null;
                  return (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                    >
                      View on {platformDisplayName(post.platform)} ↗
                    </a>
                  );
                })()}
              </div>
            )}

            {post.publishStatus === 'failed' && (
              post.platform === 'tiktok' ? (
                <TikTokFailureBlock
                  post={post}
                  retryingPublish={retryingPublish}
                  onRetry={handleRetryPublish}
                />
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-danger">
                    <span>⚠</span>
                    <span>Publishing failed</span>
                  </div>
                  {post.publishFailureReason && (
                    <div className="text-xs text-text-3 bg-bg-elev p-2 rounded font-mono break-words">
                      {post.publishFailureReason}
                    </div>
                  )}
                  {post.publishRetryCount > 0 && (
                    <div className="text-[10px] text-text-3">
                      Auto-retry attempts: {post.publishRetryCount}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={handleRetryPublish}
                    disabled={retryingPublish}
                    className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50"
                  >
                    {retryingPublish ? 'Retrying…' : '↻ Retry now'}
                  </button>
                </div>
              )
            )}

            {/* PR Sprint 7.19 — TikTok UGC posts wait on a video
                render. When the cron leaves publishStatus=null
                with a stored failureReason, surface a non-alarming
                "processing" notice instead of nothing at all. */}
            {post.platform === 'tiktok' &&
              post.publishStatus === null &&
              post.publishFailureReason &&
              (post.contentType === 'ugc' || post.contentType === 'reel') && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-amber-500">
                    <span className="inline-block w-3 h-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                    <span>
                      Your video is being processed. We&apos;ll publish
                      automatically when it&apos;s ready.
                    </span>
                  </div>
                </div>
              )}
          </div>
        )}

        {/* Feedback section — only for published posts */}
        {showFeedback && (
          <div className="space-y-4 pt-4 border-t border-border">
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3">
              Feedback
            </div>

            <div>
              <label className="text-xs text-text-2 mb-2 block">
                How did this post perform?
              </label>
              <div className="grid grid-cols-3 gap-2">
                {RATING_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() =>
                      setRating(rating === opt.value ? null : opt.value)
                    }
                    className={`
                      px-3 py-3 rounded-lg border transition-colors text-center
                      ${
                        rating === opt.value
                          ? 'border-accent bg-accent-soft'
                          : 'border-border hover:border-border-bright'
                      }
                    `}
                  >
                    <div className="text-2xl mb-1">{opt.emoji}</div>
                    <div className="text-xs">{opt.label}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-text-2 mb-2 block">
                Notes (optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="What worked or didn't?"
                rows={3}
                className="w-full p-3 bg-bg border border-border rounded-lg text-sm outline-none focus:border-accent resize-y"
              />
            </div>

            <div>
              <label className="text-xs text-text-2 mb-2 block">
                Manual metrics (optional)
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {METRIC_FIELDS.map(({ key, label }) => (
                  <div key={key}>
                    <input
                      type="number"
                      min={0}
                      value={metrics[key]}
                      onChange={(e) =>
                        setMetrics((prev) => ({
                          ...prev,
                          [key]: e.target.value,
                        }))
                      }
                      placeholder="0"
                      className="w-full p-2 bg-bg border border-border rounded-lg text-sm outline-none focus:border-accent"
                    />
                    <label className="text-[10px] text-text-3 block mt-1">
                      {label}
                    </label>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 border border-danger/30 bg-danger/10 rounded-lg text-xs text-danger">
            {error}
          </div>
        )}

        {/* Actions
            PR #24 — split into destructive (left, red) and constructive
            (right) groups. Move-to-draft only shows for scheduled rows
            (it's a no-op for drafts and we explicitly disallow it on
            published rows server-side). Delete is always available
            because the user reported "I can't delete old posts" as the
            #1 papercut. */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-4 mt-4 border-t border-border">
          <div className="flex flex-wrap items-center gap-2">
            {post.source === 'scheduled' && post.status === 'scheduled' && (
              <button
                type="button"
                onClick={handleMoveToDraft}
                disabled={movingToDraft}
                className="px-3 py-2 bg-bg border border-border rounded-lg text-sm hover:bg-bg-elev hover:border-border-bright transition-colors disabled:opacity-50"
              >
                {movingToDraft ? 'Moving…' : '← Move to draft'}
              </button>
            )}
            {/* PR #55 — Sprint 6.9: Restore button for hidden
                drafts. Surfaces only when the draft was Hidden
                via the voting UI; clears the vote + flips
                visibleInLibrary back to true. */}
            {isHiddenDraft && (
              <button
                type="button"
                onClick={handleRestore}
                disabled={restoring}
                className="px-3 py-2 bg-bg border border-accent/40 text-accent rounded-lg text-sm hover:bg-accent/10 transition-colors disabled:opacity-50"
              >
                {restoring ? 'Restoring…' : '↶ Restore to library'}
              </button>
            )}
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="px-3 py-2 text-danger hover:bg-danger/10 rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              {deleting ? 'Deleting…' : '🗑 Delete forever'}
            </button>
          </div>

          {/* PR Sprint 7.24 — Prompt 4. Action buttons reordered
              + visually grouped by frequency of use:
                PRIMARY:   Schedule, Post now (terracotta-tinted)
                SECONDARY: Clone & remix, Share (muted)
              The vertical separator divider isolates the two
              groups so the founder's eye lands on the schedule/
              post actions first. Save feedback (rare path) sits
              with the primaries because it's the closing action
              when a feedback form is showing. */}
          <div className="flex flex-wrap items-center gap-2">
            {/* --- PRIMARY group --- */}
            {/* PR #80 — Sprint 7.5.2: Schedule + Post now CTAs.
                Only surface for drafts (scheduled rows already
                live in the publisher's lane and would create
                duplicates if re-scheduled from here). Disabled
                until any in-flight action settles to avoid
                double-clicks racing the schedule/publish
                endpoints. */}
            {isDraft && (
              <button
                type="button"
                onClick={() => setShowSchedule(true)}
                disabled={posting || deleting || cloning}
                className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                📅 Schedule
              </button>
            )}
            {/* PR #86 — Sprint 7.10 (Bug #3 / FIX 3): Post now is
                now also available for scheduled rows (status=
                'scheduled') so the founder can flip an agendado
                row to immediate publish without going back to
                Drafts first. The publish-now endpoint handles
                both shapes via ?fromScheduled=1. */}
            {canPostNow && (
              <button
                type="button"
                onClick={handlePostNow}
                disabled={posting || deleting || cloning}
                className="px-4 py-2 bg-bg border border-accent/40 text-accent rounded-lg text-sm font-medium hover:bg-accent/10 transition-colors disabled:opacity-50"
              >
                {posting ? '🚀 Publishing…' : '🚀 Post now'}
              </button>
            )}
            {showFeedback && (
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save feedback'}
              </button>
            )}

            {/* --- Separator --- */}
            {(isDraft || canPostNow || showFeedback) && (
              <span
                className="hidden md:inline-block h-6 w-px bg-border mx-1"
                aria-hidden
              />
            )}

            {/* --- SECONDARY group --- */}
            <button
              type="button"
              onClick={handleClone}
              disabled={cloning}
              className="px-4 py-2 bg-bg border border-border rounded-lg text-sm text-text-2 hover:bg-bg-elev hover:border-border-bright hover:text-text-1 transition-colors disabled:opacity-50"
            >
              {cloning ? 'Cloning…' : '🔄 Clone & remix'}
            </button>

            {/* PR #38 — Sprint 6.4: Share from the detail modal
                covers both Library and Calendar (calendar opens
                this same modal when wired). videoUrl rides along
                so Reels share with the video on platforms that
                accept it (mobile native share). */}
            <ShareButton
              caption={post.content}
              imageUrl={post.visualUrl}
              videoUrl={post.videoUrl}
              variant="secondary"
              label="Share"
            />
          </div>
        </div>

        {/* PR #80 — Sprint 7.5.2: action result banner. Posted /
            scheduled / failed surfaces here so the founder sees
            outcome without the modal closing on them. Permalink
            link for successful publish where the platform
            returned one (Meta). */}
        {postResult && (
          <div
            className={`mt-4 p-3 rounded-lg text-sm ${
              postResult.success
                ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-600'
                : 'bg-danger/10 border border-danger/30 text-danger'
            }`}
          >
            <div className="font-medium">{postResult.message}</div>
            {postResult.permalink && (
              <a
                href={postResult.permalink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs underline hover:no-underline mt-1 inline-block"
              >
                View on platform →
              </a>
            )}
          </div>
        )}
      </div>

      {/* Schedule picker modal — opened from the 📅 Schedule
          button above. Renders outside the main modal card so
          it can use its own backdrop + dismiss handling. */}
      {showSchedule && (
        <ScheduleModal
          postId={post.id}
          platform={post.platform}
          siblings={assetSiblings}
          onScheduled={handleScheduled}
          onClose={() => setShowSchedule(false)}
        />
      )}
      {/* PR Sprint D-4 — lipsync re-render modal. Gated on
          heygenJob.id being available (the parent block already
          enforces this on the trigger button); the modal does
          all polling + UI internally so this parent just owns
          the open/close toggle. Initial script comes from the
          asset's stored baseContent (the canonical script —
          same value HeyGen's job was originally fired with). */}
      {lipsyncOpen && heygenJob?.id && (
        <LipsyncRerenderModal
          sourceJobId={heygenJob.id}
          initialScript={
            (
              post.structuredContent as { baseContent?: string } | null
            )?.baseContent ?? post.content
          }
          onClose={() => setLipsyncOpen(false)}
        />
      )}
      {/* PR Sprint D-5 — translation modal. Same gating as the
          lipsync modal — heygenJob.id has to be live so the
          modal can hit /api/heygen/translate?sourceJobId=...
          to list existing translations and POST new ones. */}
      {translateOpen && heygenJob?.id && (
        <TranslateModal
          sourceJobId={heygenJob.id}
          onClose={() => setTranslateOpen(false)}
        />
      )}
    </div>
  );
}

// ============================================================
// TikTok failure block — PR Sprint 7.19
// ============================================================
//
// Branches on contentType so we surface the right next step
// instead of dumping the raw publisher error string. Pre-fix
// every TikTok failure rendered the legacy "no completed HeyGen
// video" message even for posts that never had a video
// requirement (single photo, carousel).
//
// Cases:
//   - 'photo' | 'single_image' | 'single_photo':
//       "Generate an image first" + retry button. If no
//       visualUrl, the retry won't help — the founder needs to
//       go regenerate the image. We still surface Retry for
//       the case where the image WAS generated after the
//       failure (e.g. publish before image ready, then
//       generate, then retry).
//   - 'carousel':
//       Manual-upload guidance with per-slide download links +
//       a TikTok app deep link.
//   - 'ugc' | 'reel' | other:
//       Generic "publishing failed" + retry. Video-not-ready
//       is handled separately by the publishStatus=null branch
//       above, so anything that lands here with publishStatus
//       =failed for video is a real failure.

function TikTokFailureBlock({
  post,
  retryingPublish,
  onRetry,
}: {
  post: LibraryPost;
  retryingPublish: boolean;
  onRetry: () => void;
}) {
  const ct = post.contentType ?? '';
  const isPhoto =
    ct === 'photo' || ct === 'single_image' || ct === 'single_photo';
  const isCarousel = ct === 'carousel';

  if (isPhoto) {
    const hasImage = !!post.visualUrl;
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-danger">
          <span>⚠</span>
          <span>
            {hasImage
              ? 'Publishing failed'
              : 'Generate an image for this post before publishing to TikTok.'}
          </span>
        </div>
        {hasImage && post.publishFailureReason && (
          <div className="text-xs text-text-3 bg-bg-elev p-2 rounded font-mono break-words">
            {post.publishFailureReason}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {!hasImage && (
            // The image-generation block lives above the failure
            // block in the same modal — scroll into view is the
            // right affordance.
            <button
              type="button"
              onClick={() => {
                const el = document.querySelector(
                  '[data-tiktok-image-gen]',
                ) as HTMLElement | null;
                el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }}
              className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:opacity-90"
            >
              Generate image →
            </button>
          )}
          {hasImage && (
            <button
              type="button"
              onClick={onRetry}
              disabled={retryingPublish}
              className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50"
            >
              {retryingPublish ? 'Retrying…' : '↻ Retry now'}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (isCarousel) {
    const slides = Array.isArray(post.visualUrls)
      ? post.visualUrls.filter((u): u is string => typeof u === 'string')
      : [];
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-danger">
          <span>⚠</span>
          <span>TikTok Carousel requires manual upload.</span>
        </div>
        <p className="text-xs text-text-3">
          Download your slides and upload them directly in the TikTok app.
        </p>
        {slides.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {slides.map((url, i) => (
              <a
                key={`${url}-${i}`}
                href={url}
                download
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 border border-border rounded-lg text-xs hover:border-border-bright"
              >
                ↓ Slide {i + 1}
              </a>
            ))}
            <a
              href="https://www.tiktok.com/upload"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:opacity-90"
            >
              Open TikTok →
            </a>
          </div>
        )}
      </div>
    );
  }

  // UGC / reel / unknown — generic publishing failure (the
  // video-not-ready case is rendered separately as a "pending"
  // notice, NOT here). Keep the retry path so transient TikTok
  // API errors recover with one click.
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm text-danger">
        <span>⚠</span>
        <span>Publishing failed</span>
      </div>
      {post.publishFailureReason && (
        <div className="text-xs text-text-3 bg-bg-elev p-2 rounded font-mono break-words">
          {post.publishFailureReason}
        </div>
      )}
      {post.publishRetryCount > 0 && (
        <div className="text-[10px] text-text-3">
          Auto-retry attempts: {post.publishRetryCount}
        </div>
      )}
      <button
        type="button"
        onClick={onRetry}
        disabled={retryingPublish}
        className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50"
      >
        {retryingPublish ? 'Retrying…' : '↻ Retry now'}
      </button>
    </div>
  );
}
