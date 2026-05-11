'use client';

// PR #66 — Sprint 7.0.9: LinkedIn status card for the Integrations
// page. Same shape as RedditCard / XCard — fetches `/test` on mount
// + on demand, surfaces connection state, drives the connect/
// reconnect flow.
//
// Failure surfaces matter here: a missing `w_member_social` scope
// won't fail until the founder schedules a post. We detect it from
// the test response and call it out explicitly.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { GlassCard } from '@/components/ui/glass-card';
import { Button } from '@/components/ui/button';

interface TestResp {
  configured?: boolean;
  connected?: boolean;
  name?: string | null;
  handle?: string | null;
  expiresAt?: string | null;
  hasWriteScope?: boolean;
  expired?: boolean;
  healthy?: boolean;
  hint?: string;
  error?: string;
}

interface Props {
  projectId: string;
}

export function LinkedInCard({ projectId }: Props) {
  const [state, setState] = useState<TestResp & { loading: boolean }>({
    loading: true,
  });

  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true }));
    try {
      const res = await fetch(
        `/api/integrations/linkedin/test?projectId=${projectId}`,
        { cache: 'no-store' },
      );
      const data = (await res.json()) as TestResp;
      setState({ loading: false, ...data });
    } catch (e) {
      setState({
        loading: false,
        configured: false,
        error: e instanceof Error ? e.message : 'Network error',
      });
    }
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Read ?linkedin=connected or ?linkedin_error=… on mount so the
  // callback round-trip surfaces a clear success / error banner
  // even before the first /test refresh resolves.
  const [banner, setBanner] = useState<{
    kind: 'success' | 'error';
    msg: string;
  } | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('linkedin') === 'connected') {
      setBanner({ kind: 'success', msg: 'LinkedIn connected.' });
    }
    const err = params.get('linkedin_error');
    if (err) {
      const friendly =
        err === 'linkedin_not_configured'
          ? 'Server missing LinkedIn credentials — admin needs to set LINKEDIN_CLIENT_ID + LINKEDIN_CLIENT_SECRET.'
          : err === 'state_expired'
            ? 'The connection request expired. Try again.'
            : err === 'invalid_state'
              ? 'The connection request was tampered with. Try again.'
              : err === 'token_exchange_failed'
                ? 'LinkedIn rejected the token exchange. Verify your app credentials in the LinkedIn developer portal.'
                : `LinkedIn connection failed (${err}).`;
      setBanner({ kind: 'error', msg: friendly });
    }
  }, []);

  const connectHref = `/api/integrations/linkedin/connect?projectId=${encodeURIComponent(projectId)}`;

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
      return null;
    }
    if (state.expired) {
      return (
        <span className="text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-0.5 rounded bg-danger/15 text-danger">
          token expired
        </span>
      );
    }
    if (!state.hasWriteScope) {
      return (
        <span className="text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-0.5 rounded bg-amber-500/15 text-amber-500">
          missing w_member_social
        </span>
      );
    }
    return (
      <span className="text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-500">
        connected · {state.name ?? 'unknown'}
      </span>
    );
  })();

  return (
    <GlassCard className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-display text-lg font-light">LinkedIn</span>
            {statusBadge}
          </div>
          <p className="text-sm text-text-3 max-w-prose">
            Auto-publish text posts and single-image posts via UGC API.
            Carousel-style posts use the first slide (real PDF carousels
            land in a later sprint).
          </p>
          {state.connected && state.expiresAt && !state.expired && (
            <p className="text-[11px] font-mono text-text-3 mt-1">
              Token expires {new Date(state.expiresAt).toLocaleDateString()}.
            </p>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {state.connected && !state.expired ? (
            <>
              <Button size="sm" variant="secondary" onClick={refresh}>
                {state.loading ? 'Checking…' : 'Test'}
              </Button>
              <Link href={connectHref}>
                <Button size="sm" variant="secondary">
                  Re-authorize
                </Button>
              </Link>
            </>
          ) : (
            <Link href={connectHref}>
              <Button size="sm" disabled={!state.configured}>
                {state.connected ? 'Reconnect' : 'Connect LinkedIn'}
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
      {state.hint && !state.connected && !banner && (
        <div className="mt-3 text-xs text-text-3">{state.hint}</div>
      )}
    </GlassCard>
  );
}
