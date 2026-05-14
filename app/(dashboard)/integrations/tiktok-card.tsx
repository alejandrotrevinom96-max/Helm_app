'use client';

// PR #87 — Sprint 7.11: TikTok integration card.
//
// Mirrors LinkedInCard's shape (Sprint 7.0.9) but user-scoped —
// TikTok is the founder's personal account, not per-project.
// Surfaces connection state, drives the connect / refresh flows,
// and reads `?tiktok=connected` / `?tiktok_error=…` on mount so
// the OAuth round-trip lands with a clear banner.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { GlassCard } from '@/components/ui/glass-card';
import { Button } from '@/components/ui/button';
import { DisconnectButton } from '@/components/integrations/disconnect-button';

interface TestResp {
  configured?: boolean;
  connected?: boolean;
  status?: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  openId?: string | null;
  accessTokenExpiresAt?: string | null;
  refreshTokenExpiresAt?: string | null;
  accessExpired?: boolean;
  refreshExpired?: boolean;
  hasUploadScope?: boolean;
  healthy?: boolean;
  lastError?: string | null;
  error?: string;
}

export function TikTokCard() {
  const [state, setState] = useState<TestResp & { loading: boolean }>({
    loading: true,
  });

  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true }));
    try {
      const res = await fetch('/api/integrations/tiktok/test', {
        cache: 'no-store',
      });
      const data = (await res.json()) as TestResp;
      setState({ loading: false, ...data });
    } catch (e) {
      setState({
        loading: false,
        configured: false,
        error: e instanceof Error ? e.message : 'Network error',
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Banner from the OAuth round-trip.
  const [banner, setBanner] = useState<{
    kind: 'success' | 'error';
    msg: string;
  } | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('tiktok') === 'connected') {
      setBanner({ kind: 'success', msg: 'TikTok connected.' });
    }
    const err = params.get('tiktok_error');
    if (err) {
      const friendly =
        err === 'tiktok_not_configured'
          ? 'Server missing TikTok credentials — admin needs to set TIKTOK_CLIENT_KEY + TIKTOK_CLIENT_SECRET.'
          : err === 'state_expired'
            ? 'The connection request expired. Try again.'
            : err === 'invalid_state'
              ? 'The connection request was tampered with. Try again.'
              : err === 'token_exchange_failed'
                ? 'TikTok rejected the token exchange. Verify your app credentials in developers.tiktok.com.'
                : err === 'session_mismatch'
                  ? 'Your Helm session changed during connect. Try again.'
                  : `TikTok connection failed (${err}).`;
      setBanner({ kind: 'error', msg: friendly });
    }
  }, []);

  const handleManualRefresh = async () => {
    setState((prev) => ({ ...prev, loading: true }));
    try {
      await fetch('/api/integrations/tiktok/refresh', { method: 'POST' });
    } catch {
      // Ignore — the /test refetch below surfaces the canonical state.
    }
    await refresh();
  };

  const connectHref = '/api/integrations/tiktok/connect';

  const statusBadge = (() => {
    if (state.loading) {
      return (
        <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3">
          checking…
        </span>
      );
    }
    if (!state.configured) {
      return (
        <span className="text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-0.5 rounded bg-amber-500/15 text-amber-500">
          server not configured
        </span>
      );
    }
    if (!state.connected) {
      return (
        <span className="text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-0.5 rounded bg-text-3/15 text-text-2">
          UPLOAD TO INBOX
        </span>
      );
    }
    if (state.refreshExpired) {
      return (
        <span className="text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-0.5 rounded bg-danger/15 text-danger">
          re-auth required
        </span>
      );
    }
    if (!state.hasUploadScope) {
      return (
        <span className="text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-0.5 rounded bg-amber-500/15 text-amber-500">
          missing video.upload
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-500">
        {state.avatarUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={state.avatarUrl}
            alt=""
            className="w-4 h-4 rounded-full"
          />
        )}
        connected · @{state.displayName ?? 'tiktok'}
      </span>
    );
  })();

  return (
    <GlassCard className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-display text-lg font-light">TikTok</span>
            {statusBadge}
          </div>
          <p className="text-sm text-text-3 max-w-prose">
            Send videos to your TikTok drafts inbox — one tap to publish
            from the app. Uses the unaudited{' '}
            <code className="text-text-2">video.upload</code> scope so
            you skip the 4 - 8 week TikTok app audit.
          </p>
          {state.connected && state.accessTokenExpiresAt && (
            <p className="text-[11px] font-mono text-text-3 mt-1">
              Access token expires{' '}
              {new Date(state.accessTokenExpiresAt).toLocaleString()} ·
              auto-refresh on every send.
            </p>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {state.connected && !state.refreshExpired ? (
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={handleManualRefresh}
              >
                {state.loading ? 'Checking…' : 'Test'}
              </Button>
              <Link href={connectHref}>
                <Button size="sm" variant="secondary">
                  Re-authorize
                </Button>
              </Link>
              {/* PR Sprint 7.19 — TikTok disconnect. Calls the
                  user-scoped DELETE endpoint which best-effort
                  revokes against /v2/oauth/revoke/ before the
                  DB row is dropped. setState flips the card
                  back to the connect prompt immediately. */}
              <DisconnectButton
                providerLabel="TikTok"
                endpoint="/api/integrations/tiktok/disconnect"
                onDisconnected={() => {
                  setState({
                    loading: false,
                    configured: state.configured,
                    connected: false,
                  });
                }}
              />
            </>
          ) : (
            <Link href={connectHref}>
              <Button size="sm" disabled={!state.configured}>
                {state.connected ? 'Reconnect' : 'Connect TikTok →'}
              </Button>
            </Link>
          )}
        </div>
      </div>

      {banner && (
        <div
          className={`mt-3 text-xs ${
            banner.kind === 'error' ? 'text-danger' : 'text-emerald-500'
          }`}
        >
          {banner.msg}
        </div>
      )}
      {state.error && !banner && (
        <div className="mt-3 text-xs text-danger">{state.error}</div>
      )}
      {state.lastError && state.connected && (
        <div className="mt-3 text-xs text-amber-500 font-mono">
          Last error: {state.lastError}
        </div>
      )}
    </GlassCard>
  );
}
