'use client';

// PR #33 — Sprint 6.1.
//
// Modal that lets a user create a project manually — no GitHub repo
// required. Pre-PR-33 the only project creation path was the GitHub
// scan during onboarding, which excluded everyone who doesn't host
// their code on GitHub. The user feedback was "no hay botón de
// + Add project. Solo se pueden crear a través de github."
//
// Form fields:
//   - name (required): the project's display name
//   - brand URL (optional): saved into projects.brand_url; powers
//     auto-discovery flows (PR #26 brand bible auto-generate, etc).
//
// On success the new project is set as the active project and the
// page revalidates so sidebar/active-project consumers refresh.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Sparkles, X } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  // PR #72 — Sprint 7.2A hotfix: optional pre-fill from the landing
  // page hero. When the user previewed a brand URL on `/` and clicked
  // "See full bible", the URL travels through signup → user_metadata
  // → onboarding and ends up here. We prefill the field so the
  // submit-it-yourself moment is "click Create" instead of "retype
  // the URL you literally just typed two minutes ago".
  defaultBrandUrl?: string | null;
}

export function AddProjectModal({
  isOpen,
  onClose,
  defaultBrandUrl = null,
}: Props) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [brandUrl, setBrandUrl] = useState(defaultBrandUrl ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If the prop changes after mount (parent navigates between flows
  // with different URLs), keep the field in sync — but only when the
  // user hasn't already started typing. Treating their input as the
  // source of truth past first edit avoids stomping the typed value.
  useEffect(() => {
    if (defaultBrandUrl && !brandUrl) {
      setBrandUrl(defaultBrandUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultBrandUrl]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          brandUrl: brandUrl.trim() || null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        project?: { id?: string };
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data?.error ?? 'Failed to create project');
      }
      // Reset before closing so re-opening starts clean.
      setName('');
      setBrandUrl('');
      onClose();
      // The endpoint already set the new project as active via cookie.
      // refresh() makes server components (sidebar, dashboard) pick
      // up the new active project without a full reload.
      router.refresh();

      // PR Sprint 7.19 — send the founder into the onboarding wizard
      // scoped to this new project, instead of dropping them at
      // /marketing/generate (which previously left a new project
      // without a brand bible). We jump directly to the BRAND step
      // (skipping welcome + project, which are already complete from
      // a returning-user's perspective — the project just got
      // created). The query params let the brand client target this
      // specific project + signal to the rest of the wizard that
      // this is a per-project flow, not a first-time signup.
      const newProjectId = data.project?.id;
      if (newProjectId) {
        router.push(
          `/onboarding/brand?project=${encodeURIComponent(
            newProjectId,
          )}&newProject=1`,
        );
      } else {
        // Defensive — endpoint succeeded but didn't return the id.
        // Fall back to the legacy behavior so the user isn't stuck.
        router.push('/marketing/generate');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-bg-elev border border-border rounded-xl p-6 max-w-md w-full">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="font-display text-2xl font-light">New project</h3>
            <p className="text-sm text-text-3 mt-1">
              {defaultBrandUrl
                ? 'We carried your URL over from the landing. Name it and go.'
                : 'Add a project manually. You can connect integrations later.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-3 hover:text-text-1 p-1"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 bg-danger/10 border border-danger/30 rounded-lg text-sm text-danger">
              {error}
            </div>
          )}

          {defaultBrandUrl && !error && (
            <div className="p-3 bg-accent/10 border border-accent/30 rounded-lg text-xs text-accent flex items-start gap-2">
              <Sparkles className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                We carried{' '}
                <strong className="break-all">{defaultBrandUrl}</strong>{' '}
                over from the landing. Right after you name the project we
                drop you in /marketing/generate where you can build the full
                brand bible.
              </div>
            </div>
          )}

          <div>
            <label className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2 block">
              Name *
            </label>
            <input
              type="text"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm outline-none focus:border-accent"
              placeholder="e.g. Voya"
              maxLength={80}
            />
          </div>

          <div>
            <label className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2 block">
              Website URL (optional)
            </label>
            <input
              type="url"
              value={brandUrl}
              onChange={(e) => setBrandUrl(e.target.value)}
              className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm outline-none focus:border-accent"
              placeholder="https://example.com"
            />
            <p className="text-xs text-text-3 mt-1">
              Used by the brand bible auto-generator (PR #26).
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-sm text-text-2 hover:text-text-1 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !name.trim()}
              className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-2"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              Create project
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
