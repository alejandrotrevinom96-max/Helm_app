'use client';

// PR Sprint D-5 — Translation modal.
//
// Opens from PostDetailModal's UGC video block when the founder
// wants to dub the same video into N other languages. HeyGen
// clones the original voice into each target language and
// re-renders lipsync — the avatar appears to natively speak
// each language.
//
// Pattern:
//   1. List existing translation jobs for this source (GET).
//   2. Founder ticks languages they don't have yet + submits.
//   3. POST creates one row per language, status='processing'.
//   4. Modal polls each non-terminal row every 5s.
//   5. Completed translations show with <video> + Download
//      + SRT.
//
// Currently 8 curated locales — the list endpoint
// /v3/video-translations/languages is exposed via the V3
// client but we hardcode the most useful ones to keep the
// picker UX clean.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface TranslationJob {
  id: string;
  sourceJobId: string;
  heygenTranslationId: string;
  targetLanguage: string;
  mode: 'speed' | 'precision';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  resultVideoUrl: string | null;
  resultCaptionUrl: string | null;
  durationSec: string | null;
  errorMessage: string | null;
}

interface Props {
  sourceJobId: string;
  onClose: () => void;
}

// Curated list of HeyGen-supported language NAMES. HeyGen
// rejects BCP-47 codes here — it wants its own canonical names.
// Order optimized for Helm's founder base (Mexican Spanish first,
// global English second, etc.).
const LANGUAGE_OPTIONS: Array<{ name: string; label: string }> = [
  { name: 'Spanish (Mexico)', label: '🇲🇽 Spanish (Mexico)' },
  { name: 'Spanish (Spain)', label: '🇪🇸 Spanish (Spain)' },
  { name: 'English', label: '🇺🇸 English' },
  { name: 'Portuguese (Brazil)', label: '🇧🇷 Portuguese (Brazil)' },
  { name: 'French (France)', label: '🇫🇷 French' },
  { name: 'German', label: '🇩🇪 German' },
  { name: 'Italian', label: '🇮🇹 Italian' },
  { name: 'Japanese', label: '🇯🇵 Japanese' },
];

export function TranslateModal({ sourceJobId, onClose }: Props) {
  const [mounted, setMounted] = useState(false);
  const [translations, setTranslations] = useState<TranslationJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<'speed' | 'precision'>('speed');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Esc + body lock.
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

  // Initial load — pull existing translation jobs.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/heygen/translate?sourceJobId=${encodeURIComponent(sourceJobId)}`,
          { cache: 'no-store' },
        );
        if (!res.ok) {
          if (!cancelled) setLoading(false);
          return;
        }
        const data = (await res.json()) as {
          translations?: TranslationJob[];
        };
        if (!cancelled) {
          setTranslations(data.translations ?? []);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sourceJobId]);

  // Poll non-terminal rows every 5s.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refreshOne = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/heygen/translate/${id}`, {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = (await res.json()) as { translation?: TranslationJob };
      if (data.translation) {
        setTranslations((prev) =>
          prev.map((t) => (t.id === data.translation!.id ? data.translation! : t)),
        );
      }
    } catch {
      /* transient */
    }
  }, []);

  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    const live = translations.filter(
      (t) => t.status !== 'completed' && t.status !== 'failed',
    );
    if (live.length === 0) return;
    const tick = () => {
      for (const t of live) void refreshOne(t.id);
    };
    pollRef.current = setInterval(tick, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [translations, refreshOne]);

  const alreadyHasLanguage = (lang: string) =>
    translations.some(
      (t) => t.targetLanguage === lang && t.status !== 'failed',
    );

  const toggleLanguage = (lang: string) => {
    if (alreadyHasLanguage(lang)) return; // can't re-pick
    const next = new Set(selected);
    if (next.has(lang)) next.delete(lang);
    else next.add(lang);
    setSelected(next);
  };

  const submit = async () => {
    if (submitting || selected.size === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/heygen/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceJobId,
          targetLanguages: Array.from(selected),
          mode,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        translations?: TranslationJob[];
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? `Submit failed (${res.status})`);
        return;
      }
      // Merge: replace any failed rows for the same language,
      // append the rest.
      setTranslations((prev) => {
        const newOnes = data.translations ?? [];
        const newLangs = new Set(newOnes.map((t) => t.targetLanguage));
        const kept = prev.filter(
          (t) => !newLangs.has(t.targetLanguage) || t.status !== 'failed',
        );
        return [...newOnes, ...kept];
      });
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setSubmitting(false);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="translate-title"
    >
      <div className="glass-elevated rounded-2xl p-6 max-w-2xl w-full border border-border-bright max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <h3
              id="translate-title"
              className="font-display text-xl font-light mb-1"
            >
              Translate to other languages
            </h3>
            <p className="text-xs text-text-3">
              Helm clones the avatar&apos;s voice into each target
              language + re-renders lip-sync. Same avatar, native
              delivery.
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

        {/* Existing translations */}
        {!loading && translations.length > 0 && (
          <div className="mb-4">
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
              Existing translations ({translations.length})
            </div>
            <div className="space-y-2">
              {translations.map((t) => {
                const isLive =
                  t.status === 'pending' || t.status === 'processing';
                return (
                  <div
                    key={t.id}
                    className="p-3 border border-border rounded-lg bg-bg"
                  >
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <div className="text-sm font-medium">
                          {t.targetLanguage}
                        </div>
                        <div
                          className="text-[10px] font-mono uppercase tracking-[0.1em] mt-0.5"
                          style={{
                            color:
                              t.status === 'completed'
                                ? 'var(--d-green-2)'
                                : t.status === 'failed'
                                  ? 'var(--d-red-2)'
                                  : 'var(--accent)',
                          }}
                        >
                          {t.status}
                          {isLive && ' · polling…'}
                        </div>
                      </div>
                      {t.status === 'completed' && t.resultVideoUrl && (
                        <div className="flex gap-2">
                          <a
                            href={t.resultVideoUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-bg-elev border border-border rounded text-[11px] hover:border-border-bright"
                          >
                            ▶ Watch
                          </a>
                          <a
                            href={t.resultVideoUrl}
                            download
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-accent text-white rounded text-[11px] hover:opacity-90"
                          >
                            ⬇ Download
                          </a>
                          {t.resultCaptionUrl && (
                            <a
                              href={t.resultCaptionUrl}
                              download
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 px-2.5 py-1 bg-bg-elev border border-border rounded text-[11px] hover:border-border-bright"
                            >
                              ⬇ SRT
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                    {t.errorMessage && (
                      <div className="mt-2 text-[11px] text-danger font-mono break-words">
                        {t.errorMessage}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Language picker */}
        <div className="space-y-3">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
              Add languages ({selected.size} selected)
            </div>
            <div className="grid grid-cols-2 gap-2">
              {LANGUAGE_OPTIONS.map((opt) => {
                const has = alreadyHasLanguage(opt.name);
                const checked = selected.has(opt.name);
                return (
                  <label
                    key={opt.name}
                    className={`flex items-center gap-2 p-2.5 border rounded transition-colors ${
                      has
                        ? 'opacity-40 cursor-not-allowed border-border'
                        : checked
                          ? 'border-accent bg-accent/5 cursor-pointer'
                          : 'border-border hover:border-border-bright cursor-pointer'
                    }`}
                    title={has ? 'Already translated' : `Translate to ${opt.name}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={has}
                      onChange={() => toggleLanguage(opt.name)}
                    />
                    <span className="text-sm text-text-1">{opt.label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
              Quality mode
            </div>
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
                  ~2-3 min per language · standard lip-sync
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
                  ~5-8 min per language · Avatar-inference quality
                </div>
              </button>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-danger/10 border border-danger/30 rounded-lg text-sm text-danger">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-sm text-text-2 hover:text-text-1 disabled:opacity-50"
            >
              Close
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={submitting || selected.size === 0}
              className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {submitting
                ? 'Submitting…'
                : selected.size === 0
                  ? 'Pick languages first'
                  : `Translate to ${selected.size} language${selected.size === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
