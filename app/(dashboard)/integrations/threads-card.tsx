'use client';

// PR #66 — Sprint 7.0.9: Threads status card. Threads piggybacks
// the Meta token, so this card doesn't have its own OAuth flow.
// It just probes the existing Meta integration for Threads scopes
// and surfaces the handle or a "Re-connect Meta with Threads
// scopes" instruction.
import { useCallback, useEffect, useState } from 'react';
import { GlassCard } from '@/components/ui/glass-card';
import { Button } from '@/components/ui/button';

interface TestResp {
  connected?: boolean;
  username?: string;
  threadsUserId?: string;
  error?: string;
}

interface Props {
  projectId: string;
}

export function ThreadsCard({ projectId }: Props) {
  const [state, setState] = useState<TestResp & { loading: boolean }>({
    loading: true,
  });

  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true }));
    try {
      const res = await fetch(
        `/api/integrations/threads/test?projectId=${projectId}`,
        { cache: 'no-store' },
      );
      const data = (await res.json()) as TestResp;
      setState({ loading: false, ...data });
    } catch (e) {
      setState({
        loading: false,
        connected: false,
        error: e instanceof Error ? e.message : 'Network error',
      });
    }
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const badge = state.loading ? (
    <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3">
      checking…
    </span>
  ) : state.connected ? (
    <span className="text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-500">
      connected · @{state.username || 'unknown'}
    </span>
  ) : (
    <span className="text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-0.5 rounded bg-amber-500/15 text-amber-500">
      meta token missing threads scope
    </span>
  );

  return (
    <GlassCard className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-display text-lg font-light">Threads</span>
            {badge}
          </div>
          <p className="text-sm text-text-3 max-w-prose">
            Auto-publish text + photo Threads. Uses your existing Meta
            connection — re-authorize Meta with the{' '}
            <code className="font-mono text-xs">threads_basic</code> and{' '}
            <code className="font-mono text-xs">threads_content_publish</code>{' '}
            scopes to enable.
          </p>
        </div>
        <div className="shrink-0">
          <Button size="sm" variant="secondary" onClick={refresh}>
            {state.loading ? 'Checking…' : 'Test'}
          </Button>
        </div>
      </div>

      {/* PR Sprint 7.19 — No standalone Disconnect for Threads.
          Threads piggybacks the Meta access token (single OAuth
          row in meta_integrations), so a "Disconnect Threads"
          button would have to either delete the Meta token
          entirely (killing FB + IG publishing too) or no-op.
          We point the founder at the right surface instead. */}
      {state.connected && (
        <p className="mt-3 text-[11px] text-text-3">
          To disconnect Threads, disconnect Meta (Threads shares the same
          access token).
        </p>
      )}

      {!state.connected && !state.loading && (
        <div className="mt-4 pt-4 border-t border-border space-y-2">
          {state.error && (
            <div className="text-xs text-danger break-words">
              {state.error}
            </div>
          )}
          {/* PR #78 — Sprint 7.5: explicit re-auth CTA. The Meta
              OAuth flow now requests threads_basic +
              threads_content_publish (see
              app/api/integrations/meta/authorize/route.ts) and
              passes auth_type=rerequest so existing users who
              already granted the pre-Threads scope set are
              prompted again for the new permissions. */}
          <a
            href={`/api/integrations/meta/authorize?projectId=${projectId}`}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded bg-accent text-white text-xs font-medium hover:opacity-90"
          >
            Re-authorize Meta with Threads scopes →
          </a>
          <p className="text-[10px] font-mono text-text-3">
            opens Meta consent · re-uses the same Meta integration · no
            second login needed
          </p>
        </div>
      )}
    </GlassCard>
  );
}
