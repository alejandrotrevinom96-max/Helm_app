'use client';

// PR #65 — Sprint 7.0.8: X (Twitter) status card.
//
// X publishes via env-var-based OAuth 1.0a credentials — there's no
// per-user OAuth flow yet (the new pay-per-use plan is one account
// per deployment in our current setup). So this card just verifies
// the credentials are reachable + surfaces the connected handle.
//
// "Test connection" hits /api/integrations/x/test which calls X's
// /me endpoint with the stored creds.
import { useEffect, useState } from 'react';
import { GlassCard } from '@/components/ui/glass-card';
import { Button } from '@/components/ui/button';

interface State {
  loading: boolean;
  configured: boolean;
  username: string | null;
  error: string | null;
  hint: string | null;
}

export function XCard() {
  const [state, setState] = useState<State>({
    loading: true,
    configured: false,
    username: null,
    error: null,
    hint: null,
  });

  const refresh = async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const res = await fetch('/api/integrations/x/test', {
        cache: 'no-store',
      });
      const data = (await res.json()) as {
        configured?: boolean;
        username?: string;
        hint?: string;
        error?: string;
      };
      setState({
        loading: false,
        configured: Boolean(data.configured),
        username: data.username ?? null,
        error: data.error ?? null,
        hint: data.hint ?? null,
      });
    } catch (e) {
      setState({
        loading: false,
        configured: false,
        username: null,
        error: e instanceof Error ? e.message : 'Network error',
        hint: null,
      });
    }
  };

  useEffect(() => {
    refresh();
  }, []);

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
            ) : state.configured && state.username ? (
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
            Pay-per-use plan: ~$200/mo Basic tier covers 100/hr writes.
          </p>
        </div>
        <div className="shrink-0">
          <Button size="sm" variant="secondary" onClick={refresh}>
            {state.loading ? 'Checking…' : 'Test'}
          </Button>
        </div>
      </div>

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

      {state.configured && state.error && (
        <div className="mt-3 text-xs text-danger font-mono">
          {state.error}
        </div>
      )}
    </GlassCard>
  );
}
