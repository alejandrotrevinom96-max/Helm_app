'use client';

// PR Sprint D-4 — Lipsync re-render modal.
//
// Opens from PostDetailModal's UGC video block when the founder
// wants to tweak the script without paying for a full Avatar IV
// re-render. The flow:
//
//   1. Founder edits the script (pre-filled with the current
//      asset.baseContent / heygenJob.scriptText).
//   2. Picks speed or precision mode.
//   3. Submits → POST /api/heygen/lipsync.
//   4. Component polls GET /api/heygen/lipsync/[id] every 5s.
//   5. When status='completed', shows the new video. Founder
//      can preview, download, or close.
//
// Re-renders are cheaper + faster than a full HeyGen pass. The
// original heygen_jobs row stays intact; this is a new
// heygen_lipsync_jobs row keyed to it.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface LipsyncJob {
  id: string;
  sourceJobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  mode: 'speed' | 'precision';
  editedScript: string;
  resultVideoUrl: string | null;
  resultCaptionUrl: string | null;
  durationSec: string | null;
  errorMessage: string | null;
}

interface Props {
  sourceJobId: string;
  initialScript: string;
  onClose: () => void;
}

export function LipsyncRerenderModal({
  sourceJobId,
  initialScript,
  onClose,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [script, setScript] = useState(initialScript);
  const [mode, setMode] = useState<'speed' | 'precision'>('speed');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<LipsyncJob | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Esc to close, body scroll lock — same UX as the avatar picker.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, submitting]);

  // ─── Poll once a job exists + isn't terminal ───────────────
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tick = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`/api/heygen/lipsync/${jobId}`, {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = (await res.json()) as { lipsync?: LipsyncJob };
      if (data.lipsync) setJob(data.lipsync);
    } catch {
      /* transient — keep polling */
    }
  }, []);

  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (!job) return;
    if (job.status === 'completed' || job.status === 'failed') return;
    pollRef.current = setInterval(() => void tick(job.id), 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [job, tick]);

  const submit = async () => {
    if (submitting) return;
    if (script.trim().length < 5) {
      setError('Script too short.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/heygen/lipsync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceJobId,
          editedScript: script.trim(),
          mode,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        lipsync?: LipsyncJob;
        error?: string;
      };
      if (!res.ok || !data.lipsync) {
        setError(data.error ?? `Submit failed (${res.status})`);
        return;
      }
      setJob(data.lipsync);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setSubmitting(false);
    }
  };

  if (!mounted) return null;

  const wordCount = script.trim().split(/\s+/).filter(Boolean).length;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="lipsync-title"
    >
      <div className="glass-elevated rounded-2xl p-6 max-w-2xl w-full border border-border-bright">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <h3
              id="lipsync-title"
              className="font-display text-xl font-light mb-1"
            >
              Re-render with edited script
            </h3>
            <p className="text-xs text-text-3">
              Swap the audio + lip-sync without re-doing the avatar pass.
              5-10x cheaper than a full render.
            </p>
          </div>
          <button
            type="button"
            onClick={() => !submitting && onClose()}
            disabled={submitting}
            className="text-text-3 hover:text-text-1 text-xl leading-none px-1 disabled:opacity-50"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {!job ? (
          <div className="space-y-3">
            <div>
              <label
                htmlFor="lipsync-script"
                className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-1.5 block"
              >
                Edited script · {wordCount} words
              </label>
              <textarea
                id="lipsync-script"
                value={script}
                onChange={(e) => setScript(e.target.value)}
                rows={8}
                maxLength={10_000}
                className="platform-field-input"
                style={{ resize: 'vertical', minHeight: '160px' }}
              />
              <p className="text-[11px] text-text-3 mt-1.5">
                Helm uses your saved project voice + locale + speed to
                TTS this script, then lipsyncs it onto the original
                video.
              </p>
            </div>

            <div>
              <label className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-1.5 block">
                Quality mode
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode('speed')}
                  className={`flex-1 p-3 rounded-lg border text-left transition-colors ${
                    mode === 'speed'
                      ? 'border-accent bg-accent/5'
                      : 'border-border hover:border-border-bright'
                  }`}
                >
                  <div className="text-sm font-medium">⚡ Speed</div>
                  <div className="text-[11px] text-text-3 mt-0.5">
                    ~1-2 min · cheaper · UGC-quality lip-sync
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setMode('precision')}
                  className={`flex-1 p-3 rounded-lg border text-left transition-colors ${
                    mode === 'precision'
                      ? 'border-accent bg-accent/5'
                      : 'border-border hover:border-border-bright'
                  }`}
                >
                  <div className="text-sm font-medium">✨ Precision</div>
                  <div className="text-[11px] text-text-3 mt-0.5">
                    ~3-5 min · Avatar-inference quality
                  </div>
                </button>
              </div>
            </div>

            {error && (
              <div className="p-3 bg-danger/10 border border-danger/30 rounded-lg text-sm text-danger">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="px-4 py-2 text-sm text-text-2 hover:text-text-1 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={submitting || script.trim().length < 5}
                className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                {submitting ? 'Submitting…' : 'Start re-render'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {job.status === 'processing' || job.status === 'pending' ? (
              <div className="flex items-center gap-3 p-4 rounded-lg border border-purple-500/30 bg-purple-500/5">
                <div className="w-5 h-5 rounded-full border-2 border-purple-500 border-t-transparent animate-spin" />
                <div>
                  <div className="text-sm text-purple-500">
                    Re-rendering ({job.mode})
                  </div>
                  <div className="text-xs text-text-3 mt-0.5">
                    {job.mode === 'speed'
                      ? 'Typically 1-2 minutes…'
                      : 'Typically 3-5 minutes…'}
                  </div>
                </div>
              </div>
            ) : job.status === 'completed' && job.resultVideoUrl ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-emerald-500">
                  <span>✓</span>
                  <span>Re-render ready</span>
                </div>
                <video
                  src={job.resultVideoUrl}
                  controls
                  playsInline
                  preload="metadata"
                  className="rounded-lg w-full max-w-md mx-auto aspect-[9/16] object-cover bg-bg"
                />
                <div className="flex gap-2">
                  <a
                    href={job.resultVideoUrl}
                    download
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:opacity-90"
                  >
                    ⬇ Download
                  </a>
                  {job.resultCaptionUrl && (
                    <a
                      href={job.resultCaptionUrl}
                      download
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-3 py-1.5 bg-bg border border-border rounded-lg text-xs font-medium hover:bg-bg-elev"
                    >
                      ⬇ SRT
                    </a>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-3 rounded-lg border border-danger/30 bg-danger/5">
                <div className="text-sm text-danger">
                  ⚠ Re-render failed
                </div>
                {job.errorMessage && (
                  <div className="text-xs text-text-3 font-mono mt-1 break-words">
                    {job.errorMessage}
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end pt-2 border-t border-border">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-text-2 hover:text-text-1"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
