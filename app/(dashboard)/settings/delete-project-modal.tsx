'use client';

// PR Sprint 7.19 — Type-to-confirm delete modal.
//
// Gates the destructive action behind:
//   1. An explicit "Delete" string match (case-sensitive — the
//      brief is explicit about capital-D-Delete).
//   2. A submit button that stays disabled + opaque until the
//      input matches.
//   3. A brief success state after the API call resolves, then
//      a redirect to the next project (or /onboarding/project
//      if no projects remain).
//
// The redirect target is chosen by the API response — the
// endpoint sets the active_project_id cookie to the next
// available project (or clears it if none) so the dashboard
// layout's getActiveProject() resolves cleanly on the next
// render.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';

interface Props {
  projectId: string;
  projectName: string;
  onClose: () => void;
}

const REQUIRED_TYPED = 'Delete';

type Phase = 'idle' | 'submitting' | 'done' | 'error';

export function DeleteProjectModal({
  projectId,
  projectName,
  onClose,
}: Props) {
  const router = useRouter();
  const [typed, setTyped] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Focus the input on mount so the founder can start typing
  // immediately. The dialog is the only thing on screen worth
  // interacting with.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Keep the input case-sensitive — "delete" should not unlock
  // the button. We use exact equality, not toLowerCase.
  const canSubmit = typed === REQUIRED_TYPED && phase === 'idle';

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setPhase('submitting');
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'DELETE',
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        remainingCount?: number;
        nextProjectId?: string | null;
        error?: string;
      };
      if (!res.ok || !data.success) {
        setError(data.error ?? 'Could not delete project');
        setPhase('error');
        return;
      }

      // Brief success window so the founder sees the action
      // landed, then redirect. router.refresh() repulls server
      // components (sidebar / layout) with the new cookie state.
      setPhase('done');
      router.refresh();

      // Pick the next destination based on what's left:
      //   - At least one project remains → /marketing/generate.
      //     The active_project_id cookie was already pointed at
      //     the next project server-side.
      //   - Zero projects remain → /onboarding/project. The
      //     wizard step that creates a fresh project (kept
      //     separate from /onboarding/welcome because the
      //     founder is already onboarded; they just need a new
      //     project, not the whole welcome flow).
      const target =
        data.remainingCount && data.remainingCount > 0
          ? '/marketing/generate'
          : '/onboarding/project';
      // 600ms lets the success state render before the route
      // change — fast enough to feel responsive, slow enough to
      // confirm the destruction visually.
      window.setTimeout(() => {
        router.push(target);
      }, 600);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
      setPhase('error');
    }
  }, [canSubmit, projectId, router]);

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && canSubmit) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  // Backdrop click closes — but only when not submitting, so a
  // stray click mid-delete doesn't leave the modal stuck in a
  // half-state.
  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && phase !== 'submitting') {
      onClose();
    }
  };

  return (
    <div
      onClick={handleBackdrop}
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-project-title"
    >
      <div className="glass-elevated rounded-2xl p-6 max-w-md w-full border border-danger/40">
        <div className="flex items-start justify-between gap-3 mb-4">
          <h3
            id="delete-project-title"
            className="font-display text-xl font-light"
          >
            Delete {projectName}?
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={phase === 'submitting'}
            className="text-text-3 hover:text-text-1 p-1 disabled:opacity-50"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-text-2 mb-2">
          This will permanently delete:
        </p>
        <ul className="text-sm text-text-2 space-y-1 mb-4">
          <li className="flex items-start gap-2">
            <span className="text-danger shrink-0">·</span>
            <span>All drafts and scheduled posts</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-danger shrink-0">·</span>
            <span>All research findings</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-danger shrink-0">·</span>
            <span>Brand Bible and voice settings</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-danger shrink-0">·</span>
            <span>All analytics data</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-danger shrink-0">·</span>
            <span>All integrations for this project</span>
          </li>
        </ul>

        <p className="text-sm text-text-1 font-medium mb-4">
          This action cannot be undone.
        </p>

        <label
          htmlFor="delete-confirm-input"
          className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 block mb-2"
        >
          Type &ldquo;Delete&rdquo; to confirm:
        </label>
        <input
          ref={inputRef}
          id="delete-confirm-input"
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={handleKey}
          disabled={phase === 'submitting' || phase === 'done'}
          autoComplete="off"
          spellCheck={false}
          className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm outline-none focus:border-danger disabled:opacity-50"
          placeholder="Delete"
        />

        {error && (
          <div className="mt-3 p-2 bg-danger/10 border border-danger/30 rounded text-xs text-danger">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onClose}
            disabled={phase === 'submitting'}
            className="px-4 py-2 text-sm text-text-2 hover:text-text-1 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit && phase !== 'error'}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              canSubmit || phase === 'submitting' || phase === 'done'
                ? 'bg-danger text-white hover:opacity-90'
                : 'bg-danger/30 text-white cursor-not-allowed'
            } ${phase === 'error' ? 'bg-danger text-white' : ''}`}
          >
            {phase === 'submitting'
              ? 'Deleting…'
              : phase === 'done'
                ? 'Deleted ✓'
                : phase === 'error'
                  ? 'Try again'
                  : 'Delete project'}
          </button>
        </div>
      </div>
    </div>
  );
}
