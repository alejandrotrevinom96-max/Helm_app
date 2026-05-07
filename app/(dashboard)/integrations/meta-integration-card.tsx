'use client';

// PR #29 — Sprint 5.1: Auto-posting Meta foundation.
//
// Card rendered inside the Integrations page that lets the founder
// connect / disconnect a Meta (Facebook + Instagram Business) asset
// to a project. Pre-PR-29 the existing IntegrationsClient handled
// vercel/supabase/meta-ads (analytics integration); this is a NEW
// card for posting integration. They live side-by-side.
//
// State machine:
//   - no row → "Connect Meta" button → /api/integrations/meta/authorize
//   - row.status='connected' → show page name + IG handle + Disconnect
//   - row.status='expired' → show banner + "Reconnect"
//   - OAuth callback writes ?meta_connected=true OR ?meta_error=...
//     to /integrations and we surface the message at the top.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Facebook,
  Instagram,
  Check,
  AlertCircle,
} from 'lucide-react';

interface SafeIntegration {
  id: string;
  facebookPageId: string | null;
  facebookPageName: string | null;
  instagramBusinessId: string | null;
  instagramBusinessUsername: string | null;
  metaUserName: string | null;
  tokenExpiresAt: string | null;
  status: 'pending' | 'connected' | 'expired' | 'disconnected' | 'failed';
  lastError: string | null;
  createdAt: string;
}

export function MetaIntegrationCard({ projectId }: { projectId: string }) {
  const searchParams = useSearchParams();
  const [integration, setIntegration] = useState<SafeIntegration | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);

  // OAuth callback messages — written to the URL by /api/integrations/
  // meta/callback. We display them once and let the user dismiss
  // implicitly by navigating away.
  const metaConnected = searchParams.get('meta_connected');
  const metaError = searchParams.get('meta_error');
  const connectedPage = searchParams.get('page');

  useEffect(() => {
    if (!projectId) return;
    fetch(`/api/integrations/meta?projectId=${projectId}`)
      .then((r) => r.json())
      .then((d: { integration: SafeIntegration | null }) => {
        setIntegration(d.integration);
      })
      .catch(() => {
        // GET failure is non-fatal; the card just renders the
        // disconnected state.
        setIntegration(null);
      })
      .finally(() => setLoading(false));
  }, [projectId]);

  const handleConnect = () => {
    window.location.href = `/api/integrations/meta/authorize?projectId=${projectId}`;
  };

  const handleDisconnect = async () => {
    if (
      !confirm(
        'Disconnect Meta? Posts already scheduled will FAIL until you reconnect.'
      )
    ) {
      return;
    }
    setDisconnecting(true);
    await fetch(`/api/integrations/meta?projectId=${projectId}`, {
      method: 'DELETE',
    });
    setIntegration(null);
    setDisconnecting(false);
  };

  if (loading) {
    return (
      <div className="p-6 border border-border rounded-xl">
        <div className="text-sm text-text-3">Loading Meta integration…</div>
      </div>
    );
  }

  const isConnected = integration?.status === 'connected';

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="p-6">
        <div className="flex items-start justify-between mb-4 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 bg-blue-500/10 rounded-lg flex items-center justify-center shrink-0">
              <Facebook className="w-5 h-5 text-blue-500" />
            </div>
            <div className="min-w-0">
              <h3 className="font-display text-lg font-light">
                Meta (Facebook + Instagram)
              </h3>
              <p className="text-xs text-text-3">
                Auto-publish scheduled posts to your Facebook Page and
                Instagram Business
              </p>
            </div>
          </div>

          {isConnected && (
            <span className="flex items-center gap-1 px-2 py-1 bg-emerald-500/10 text-emerald-500 rounded text-[10px] font-mono uppercase tracking-[0.1em] shrink-0">
              <Check className="w-3 h-3" />
              Connected
            </span>
          )}
        </div>

        {metaConnected && (
          <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-sm text-emerald-500">
            ✓ Successfully connected
            {connectedPage ? ` to ${connectedPage}` : ''}
          </div>
        )}

        {metaError && (
          <div className="mb-4 p-3 bg-danger/10 border border-danger/30 rounded-lg text-sm text-danger">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="font-medium">Connection failed</div>
                <div className="text-xs mt-0.5 opacity-80 break-words">
                  {decodeURIComponent(metaError)}
                </div>
              </div>
            </div>
          </div>
        )}

        {isConnected ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {integration?.facebookPageName && (
                <div className="p-3 bg-bg rounded-lg border border-border">
                  <div className="flex items-center gap-2 mb-1">
                    <Facebook className="w-3 h-3 text-blue-500" />
                    <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3">
                      Facebook Page
                    </span>
                  </div>
                  <div className="text-sm font-medium truncate">
                    {integration.facebookPageName}
                  </div>
                </div>
              )}

              {integration?.instagramBusinessUsername ? (
                <div className="p-3 bg-bg rounded-lg border border-border">
                  <div className="flex items-center gap-2 mb-1">
                    <Instagram className="w-3 h-3 text-pink-500" />
                    <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3">
                      Instagram
                    </span>
                  </div>
                  <div className="text-sm font-medium truncate">
                    @{integration.instagramBusinessUsername}
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-amber-500/5 rounded-lg border border-amber-500/20">
                  <div className="text-xs text-amber-500">
                    No Instagram Business account is linked to this Page
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-border">
              <div className="text-xs text-text-3">
                Token expires:{' '}
                {integration?.tokenExpiresAt
                  ? new Date(integration.tokenExpiresAt).toLocaleDateString()
                  : 'Unknown'}
              </div>
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="text-xs text-danger hover:opacity-80 disabled:opacity-50"
              >
                {disconnecting ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm text-text-2 mb-4">
              Connect your Facebook Page and Instagram Business to enable
              auto-posting from Helm. We&apos;ll only request the
              permissions needed to publish your scheduled content.
            </p>
            <button
              onClick={handleConnect}
              className="w-full px-4 py-2.5 bg-accent text-white rounded-lg text-sm font-medium hover:opacity-90 flex items-center justify-center gap-2"
            >
              <Facebook className="w-4 h-4" />
              Connect Meta
            </button>
            <p className="text-[10px] text-text-3 mt-2 text-center">
              You&apos;ll be redirected to Facebook to grant permissions
            </p>
          </>
        )}
      </div>
    </div>
  );
}
