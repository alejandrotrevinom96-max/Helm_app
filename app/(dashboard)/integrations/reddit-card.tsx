'use client';

// PR #58 — Sprint 7.0.2: Reddit OAuth card for the Integrations page.
//
// Why a dedicated card vs. extending the existing IntegrationsClient
// list: Reddit's purpose (research source access for discovery + scan)
// is conceptually separate from the publishing/sync integrations
// (Vercel/Supabase/Meta) that live in IntegrationsClient. Reddit also
// doesn't carry per-project state — it's user-scoped.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { GlassCard } from '@/components/ui/glass-card';
import { Button } from '@/components/ui/button';

interface Props {
  initiallyConnected: boolean;
}

export function RedditCard({ initiallyConnected }: Props) {
  const [banner, setBanner] = useState<{
    kind: 'success' | 'error';
    msg: string;
  } | null>(null);

  // Surface the callback's ?reddit=connected / ?error=... so the
  // founder knows the OAuth round-trip actually worked.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('reddit') === 'connected') {
      setBanner({
        kind: 'success',
        msg: 'Reddit connected. Discovery will use authenticated requests from now on.',
      });
    }
    const err = params.get('error');
    if (err) {
      const friendly =
        err === 'reddit_not_configured'
          ? 'Reddit OAuth isn\'t configured on the server. Ask admin to set REDDIT_CLIENT_ID.'
          : err === 'state_expired'
            ? 'The connection request expired. Try again.'
            : err === 'invalid_state'
              ? 'The connection request was tampered with. Try again.'
              : err === 'token_exchange_failed'
                ? 'Reddit rejected the token exchange. Verify your client credentials.'
                : `Reddit connection failed (${err}).`;
      setBanner({ kind: 'error', msg: friendly });
    }
  }, []);

  return (
    <GlassCard className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="font-display text-lg font-light mb-1">Reddit</h3>
          <p className="text-sm text-text-3 max-w-prose">
            Reddit blocks unauthenticated requests from cloud IPs, so without
            an OAuth connection Helm&apos;s discovery + scan return empty
            results. Connecting your Reddit account fixes this — read-only
            access, no posting.
          </p>
        </div>
        <div className="shrink-0">
          {initiallyConnected ? (
            <span className="text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-1 rounded bg-emerald-500/15 text-emerald-500">
              Connected
            </span>
          ) : (
            <Link href="/api/integrations/reddit/auth">
              <Button size="sm">Connect Reddit</Button>
            </Link>
          )}
        </div>
      </div>

      {initiallyConnected && (
        <div className="mt-4 pt-4 border-t border-border flex items-center gap-3">
          <Link
            href="/api/integrations/reddit/auth"
            className="text-xs font-mono text-text-3 hover:text-text-1 transition-colors"
          >
            Re-authorize →
          </Link>
          <Link
            href="/research/sources"
            className="text-xs font-mono text-accent hover:opacity-80"
          >
            Open Sources →
          </Link>
        </div>
      )}

      {banner && (
        <div
          className={`mt-3 text-xs ${
            banner.kind === 'error' ? 'text-danger' : 'text-emerald-500'
          }`}
        >
          {banner.msg}
        </div>
      )}
    </GlassCard>
  );
}
