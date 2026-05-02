'use client';

import { useState } from 'react';

const INTEGRATIONS = [
  {
    id: 'github',
    name: 'GitHub',
    description: 'Auto-detect projects and stack from repos',
    badge: '✓ Connected on signup',
  },
  {
    id: 'vercel',
    name: 'Vercel',
    description: 'Web Analytics, deployments, and traffic',
    instructions:
      'Go to Vercel → Account Settings → Tokens → Create a new token (full scope), then paste it below.',
    inputLabel: 'Vercel API token',
  },
  {
    id: 'supabase',
    name: 'Supabase',
    description: 'Auth users, signups, recent activity',
    instructions:
      'Go to Supabase → Account → Access Tokens → Generate new token. Then paste it below along with your project ref.',
    inputLabel: 'Supabase access token',
    extraInput: 'Project ref (e.g. abcdefgh)',
  },
  {
    id: 'meta',
    name: 'Meta Ads',
    description: 'Ad spend, impressions, CPM, conversions',
    instructions:
      'OAuth flow coming soon. For now, paste a long-lived access token from Meta for Developers.',
    inputLabel: 'Meta access token',
    extraInput: 'Ad account ID (e.g. act_123456)',
  },
] as const;

export function IntegrationsClient({ connected }: { connected: string[] }) {
  const connectedSet = new Set(connected);

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="font-display text-4xl font-medium tracking-tight">Integrations</h1>
        <p className="text-text-dim mt-1 text-sm">
          Connect your data sources to populate your dashboard
        </p>
      </div>

      <div className="space-y-4">
        {INTEGRATIONS.map((int) => (
          <IntegrationCard
            key={int.id}
            integration={int}
            isConnected={connectedSet.has(int.id)}
          />
        ))}
      </div>
    </div>
  );
}

function IntegrationCard({
  integration,
  isConnected,
}: {
  integration: any;
  isConnected: boolean;
}) {
  const [showForm, setShowForm] = useState(false);
  const [token, setToken] = useState('');
  const [extra, setExtra] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const res = await fetch('/api/integrations/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: integration.id, token, extra }),
    });
    if (res.ok) location.reload();
    else {
      alert('Failed to save. Check the token format.');
      setSaving(false);
    }
  };

  return (
    <div className="bg-bg-elev border border-border rounded-xl p-6">
      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-medium text-lg">{integration.name}</h3>
            {isConnected && (
              <span className="text-[10px] font-mono px-2 py-0.5 bg-green-500/15 text-green-400 rounded">
                CONNECTED
              </span>
            )}
          </div>
          <p className="text-text-dim text-sm">{integration.description}</p>
        </div>
        {!isConnected && integration.id !== 'github' && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="text-sm text-accent hover:underline"
          >
            {showForm ? 'Cancel' : 'Connect'}
          </button>
        )}
      </div>

      {showForm && !isConnected && (
        <div className="mt-4 pt-4 border-t border-border">
          <p className="text-xs text-text-faint mb-3">{integration.instructions}</p>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={integration.inputLabel}
            className="w-full bg-bg border border-border rounded-lg p-2.5 text-sm mb-2 outline-none focus:border-accent"
          />
          {integration.extraInput && (
            <input
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              placeholder={integration.extraInput}
              className="w-full bg-bg border border-border rounded-lg p-2.5 text-sm mb-2 outline-none focus:border-accent"
            />
          )}
          <button
            onClick={save}
            disabled={saving || !token}
            className="bg-accent text-bg px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save & Connect'}
          </button>
        </div>
      )}
    </div>
  );
}
