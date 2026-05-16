'use client';

// PR #65 — Sprint 7.0.8: X (Twitter) status card.
// PR Sprint B-finish: per-user soft disconnect.
//
// X publishes via env-var-based OAuth 1.0a credentials — the
// new pay-per-use plan is one account per deployment. We can't
// drop env vars on the founder's behalf, so "Disconnect" here is
// a SOFT signal recorded in user_integration_opt_outs. The
// publish dispatcher + the status check consult it before
// reporting connected / firing API calls.
//
// "Test connection" hits /api/integrations/x/test which calls X's
// /me endpoint with the stored creds AND reports the opt-out
// state for this user.
import { useCallback, useEffect, useState } from 'react';
import { GlassCard } from '@/components/ui/glass-card';
import { Button } from '@/components/ui/button';
import { DisconnectButton } from '@/components/integrations/disconnect-button';
import { showToast } from '@/lib/toast/toast';

interface State {
  loading: boolean;
  configured: boolean;
  optedOut: boolean;
  username: string | null;
  error: string | null;
  hint: string | null;
}

export function XCard() {
  const [state, setState] = useState<State>({
    loading: true,
    configured: false,
    optedOut: false,
    username: null,
    error: null,
    hint: null,
  });
  const [reconnecting, setReconnecting] = useState(false);

  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const res = await fetch('/api/integrations/x/test', {
        cache: 'no-store',
      });
      const data = (await res.json()) as {
        configured?: boolean;
        optedOut?: boolean;
        username?: string;
        hint?: string;
        error?: string;
      };
      setState({
        loading: false,
        configured: Boolean(data.configured),
        optedOut: Boolean(data.optedOut),
        username: data.username ?? null,
        error: data.error ?? null,
        hint: data.hint ?? null,
      });
    } catch (e) {
      setState({
        loading: false,
        configured: false,
        optedOut: false,
        username: null,
        error: e instanceof Error ? e.message : 'Network error',
        hint: null,
      });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Reconnect flow — clears the user_integration_opt_outs row so
  // the deploy-wide creds become usable for this founder again.
  // Idempotent; no confirmation modal because re-enabling is not
  // a destructive action.
  const handleReconnect = useCallback(async () => {
    if (reconnecting) return;
    setReconnecting(true);
    try {
      const res = await fetch('/api/integrations/x/reconnect', {
        method: 'POST',
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        showToast(
          data.error ?? `Could not reconnect (${res.status})`,
          'error',
        );
        return;
      }
      showToast('Reconnected to X');
      await refresh();
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : 'Could not reconnect to X',
        'error',
      );
    } finally {
      setReconnecting(false);
    }
  }, [reconnecting, refresh]);

  // Connected = deploy-wide creds present AND this founder has
  // NOT soft-disconnected. The Disconnect / Reconnect surface
  // dispatches off this combo.
  const isConnected =
    state.configured && !state.optedOut && Boolean(state.username);

  return (
    <GlassCard className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-display text-lg font-light">X (Twitter)</span>
            {state.loading ? (
              <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3">
                checking…
              </span>
            ) : state.optedOut ? (
              <span className="text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-0.5 rounded bg-text-3/15 text-text-2">
                disconnected
              </span>
            ) : isConnected ? (
              <span className="text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-500">
                connected · @{state.username}
              </span>
            ) : state.configured && state.error ? (
              <span className="text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-0.5 rounded bg-danger/15 text-danger">
                credentials rejected
              </span>
            ) : (
              <span className="text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-0.5 rounded bg-amber-500/15 text-amber-500">
                not configured
              </span>
            )}
          </div>
          <p className="text-sm text-text-3 max-w-prose">
            Auto-publish single tweets and 2-8 tweet threads from structured
            drafts. Uses your X API credentials (OAuth 1.0a User Context).
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {state.optedOut ? (
            <Button
              size="sm"
              variant="primary"
              onClick={() => void handleReconnect()}
              disabled={reconnecting}
            >
              {reconnecting ? 'Reconnecting…' : 'Connect X'}
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={refresh}>
              {state.loading ? 'Checking…' : 'Test'}
            </Button>
          )}
          {/* PR Sprint B-finish — Disconnect surfaces only when
              the founder is currently connected. Hidden while
              they're already disconnected (the Connect X button
              above replaces it) and while creds aren't even
              configured (nothing to disconnect FROM). */}
          <DisconnectButton
            providerLabel="X (Twitter)"
            endpoint="/api/integrations/x/disconnect"
            onDisconnected={() => void refresh()}
            hidden={!isConnected}
          />
        </div>
      </div>

      {/* When connected, show the soft-disconnect explainer so
          the founder understands what "Disconnect" does here vs
          on Vercel / Supabase (where it drops a real token). */}
      {isConnected && (
        <p className="mt-3 text-[11px] text-text-3">
          Disconnect stops Helm from publishing to X on your behalf.
          The deploy-wide credentials stay in place; you can reconnect
          anytime.
        </p>
      )}

      {/* Opted-out state explainer. */}
      {state.optedOut && (
        <p className="mt-3 text-[11px] text-text-3">
          Helm is not publishing to X on your behalf. Hit{' '}
          <span className="text-text-1">Connect X</span> to resume.
        </p>
      )}

      {!state.configured && state.hint && (
        <div className="mt-3 p-3 bg-bg-elev rounded-lg text-xs font-mono text-text-2 space-y-1">
          <div className="text-text-3 uppercase tracking-[0.1em] text-[10px] mb-1">
            Set in Vercel env vars:
          </div>
          <div>X_API_KEY</div>
          <div>X_API_SECRET</div>
          <div>X_ACCESS_TOKEN</div>
          <div>X_ACCESS_TOKEN_SECRET</div>
          <div className="text-text-3 mt-2">{state.hint}</div>
        </div>
      )}

      {state.configured && !state.optedOut && state.error && (
        <div className="mt-3 text-xs text-danger font-mono">
          {state.error}
        </div>
      )}
    </GlassCard>
  );
}
