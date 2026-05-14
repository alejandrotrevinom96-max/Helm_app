'use client';

// PR Sprint 7.19 — universal disconnect button for the
// Integrations page.
//
// Renders a muted "Disconnect" link that opens a confirmation
// modal on click. Confirming fires DELETE against the provided
// endpoint, shows a toast, and notifies the parent so it can
// refresh state (router.refresh() for server components,
// local-state setter for client-only flows like the X /
// TikTok cards that own their `connected` boolean).
//
// Why a dedicated primitive instead of inlining: every provider
// (Vercel, Supabase, Reddit, LinkedIn, TikTok) needs identical
// modal copy + identical destructive styling. Keeping it in one
// place means a copy or color change touches one file.
//
// Styling rules from the brief:
//   - Default: muted text (text-text-3 + transparent bg)
//   - Hover: soft red to signal destructive — but NOT bg-danger
//     by default (that's reserved for primary destructive
//     actions like delete-account)
//   - Confirm button in the modal IS bg-danger — once the user
//     hits the modal, the destructive intent is now primary

import { useCallback, useState } from 'react';
import { showToast } from '@/lib/toast/toast';

interface DisconnectButtonProps {
  /** Display name of the provider, e.g. "Vercel". Used in the
   * modal copy and the toast text. */
  providerLabel: string;
  /** DELETE endpoint that drops the credential row. Should
   * return `{ success: true }` on success or `{ error }` with
   * a non-2xx status. */
  endpoint: string;
  /**
   * Optional callback fired AFTER a successful disconnect. The
   * typical use is `() => router.refresh()` for server-component
   * cards (e.g. the credential card that reads `connected` from
   * /api/integrations/health), OR a `setConnected(false)`-style
   * setter for client-only cards.
   */
  onDisconnected?: () => void;
  /** Optional extra body sent to the endpoint (e.g. projectId
   * for per-project integrations like LinkedIn). */
  body?: Record<string, unknown>;
  /** When true, renders nothing — convenient guard so callers
   * can drop `<DisconnectButton hidden={!isConnected} ...>` */
  hidden?: boolean;
}

export function DisconnectButton({
  providerLabel,
  endpoint,
  onDisconnected,
  body,
  hidden,
}: DisconnectButtonProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const confirmDisconnect = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(endpoint, {
        method: 'DELETE',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg =
          (data as { error?: string }).error ??
          `Could not disconnect (${res.status})`;
        showToast(msg, 'error');
        return;
      }
      showToast(`Disconnected from ${providerLabel}`);
      setOpen(false);
      onDisconnected?.();
    } catch (e) {
      showToast(
        e instanceof Error
          ? e.message
          : `Could not disconnect from ${providerLabel}`,
        'error',
      );
    } finally {
      setBusy(false);
    }
  }, [endpoint, body, providerLabel, onDisconnected]);

  if (hidden) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm text-text-3 hover:text-danger transition-colors disabled:opacity-50"
        aria-label={`Disconnect ${providerLabel}`}
      >
        Disconnect
      </button>

      {open && (
        <ConfirmDisconnectModal
          providerLabel={providerLabel}
          busy={busy}
          onConfirm={() => void confirmDisconnect()}
          onCancel={() => {
            if (busy) return;
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

// ============================================================
// Confirmation modal
// ============================================================

function ConfirmDisconnectModal({
  providerLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  providerLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="disconnect-title"
    >
      <div className="glass-elevated rounded-2xl p-6 max-w-md w-full border border-border-bright">
        <h3
          id="disconnect-title"
          className="font-display text-xl font-light mb-2"
        >
          Disconnect {providerLabel}?
        </h3>
        <p className="text-sm text-text-2 mb-6 leading-relaxed">
          This will remove your {providerLabel} credentials from Helm.
          You can reconnect at any time.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 text-sm text-text-2 hover:text-text-1 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-danger text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {busy ? 'Disconnecting…' : 'Disconnect'}
          </button>
        </div>
      </div>
    </div>
  );
}
