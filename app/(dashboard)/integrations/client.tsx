'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const INTEGRATIONS = [
  {
    id: 'vercel',
    name: 'Vercel',
    description: 'Web Analytics, deployments, and traffic',
    instructions:
      'Vercel → Account Settings → Tokens → Create Token (full scope), then paste below.',
    inputLabel: 'Vercel API token',
  },
  {
    id: 'supabase',
    name: 'Supabase',
    description: 'Auth users, signups, recent activity',
    instructions:
      'Supabase → Account → Access Tokens → Generate new token, then paste below.',
    inputLabel: 'Supabase access token',
  },
  {
    id: 'meta',
    name: 'Meta Ads',
    description: 'Ad spend, impressions, CPM, conversions',
    instructions:
      'Meta for Developers → System User → Generate long-lived access token.',
    inputLabel: 'Meta access token',
  },
] as const;

type ProjectRow = {
  id: string;
  name: string;
  githubRepoFullName: string | null;
  vercelProjectId: string | null;
  vercelTeamId: string | null;
  supabaseProjectRef: string | null;
  metaAdAccountId: string | null;
};

type VercelOption = { id: string; name: string; repo?: string; domain?: string };
type SupabaseOption = { ref: string; name: string; region: string };
type MetaOption = { id: string; name: string; currency: string };

export function IntegrationsClient({
  connected,
  allProjects,
}: {
  connected: string[];
  allProjects: ProjectRow[];
}) {
  const connectedSet = new Set(connected);

  // Remote option lists, fetched once when the relevant credential is connected.
  const [vercelOptions, setVercelOptions] = useState<VercelOption[]>([]);
  const [supabaseOptions, setSupabaseOptions] = useState<SupabaseOption[]>([]);
  const [metaOptions, setMetaOptions] = useState<MetaOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadOptions() {
      setLoadingOptions(true);
      const tasks: Promise<void>[] = [];
      if (connectedSet.has('vercel')) {
        tasks.push(
          fetch('/api/integrations/vercel/list-projects')
            .then((r) => r.json())
            .then((d) => {
              if (!cancelled && d.projects) setVercelOptions(d.projects);
            })
            .catch(() => {})
        );
      }
      if (connectedSet.has('supabase')) {
        tasks.push(
          fetch('/api/integrations/supabase/list-projects')
            .then((r) => r.json())
            .then((d) => {
              if (!cancelled && d.projects) setSupabaseOptions(d.projects);
            })
            .catch(() => {})
        );
      }
      if (connectedSet.has('meta')) {
        tasks.push(
          fetch('/api/integrations/meta/list-ad-accounts')
            .then((r) => r.json())
            .then((d) => {
              if (!cancelled && d.accounts) setMetaOptions(d.accounts);
            })
            .catch(() => {})
        );
      }
      await Promise.all(tasks);
      if (!cancelled) setLoadingOptions(false);
    }
    loadOptions();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected.join(',')]);

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-10">
        <h1 className="font-display text-4xl font-medium tracking-tight">Integrations</h1>
        <p className="text-text-dim mt-1 text-sm">
          Connect your data sources, then map each Helm project to its remote counterpart.
        </p>
      </div>

      <section className="mb-12">
        <div className="mb-4">
          <h2 className="font-display text-2xl font-medium">Account credentials</h2>
          <p className="text-text-faint text-xs mt-1">One-time setup per provider.</p>
        </div>
        <div className="space-y-4">
          {INTEGRATIONS.map((int) => (
            <CredentialCard
              key={int.id}
              integration={int}
              isConnected={connectedSet.has(int.id)}
            />
          ))}
        </div>
      </section>

      {connected.length > 0 && allProjects.length > 0 && (
        <section>
          <div className="mb-4">
            <h2 className="font-display text-2xl font-medium">Project mappings</h2>
            <p className="text-text-faint text-xs mt-1">
              Tell Helm which remote project corresponds to each of your Helm projects.
            </p>
          </div>
          {loadingOptions && (
            <div className="text-text-faint text-sm mb-4">Loading remote projects…</div>
          )}
          <div className="space-y-4">
            {allProjects.map((p) => (
              <ProjectMappingCard
                key={p.id}
                project={p}
                connected={connectedSet}
                vercelOptions={vercelOptions}
                supabaseOptions={supabaseOptions}
                metaOptions={metaOptions}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function CredentialCard({
  integration,
  isConnected,
}: {
  integration: { id: string; name: string; description: string; instructions: string; inputLabel: string };
  isConnected: boolean;
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const res = await fetch('/api/integrations/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: integration.id, token }),
    });
    if (res.ok) {
      setToken('');
      setShowForm(false);
      router.refresh();
    } else {
      alert('Failed to save. Check the token format.');
    }
    setSaving(false);
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
        <button
          onClick={() => setShowForm(!showForm)}
          className="text-sm text-accent hover:underline"
        >
          {showForm ? 'Cancel' : isConnected ? 'Replace token' : 'Connect'}
        </button>
      </div>

      {showForm && (
        <div className="mt-4 pt-4 border-t border-border">
          <p className="text-xs text-text-faint mb-3">{integration.instructions}</p>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={integration.inputLabel}
            className="w-full bg-bg border border-border rounded-lg p-2.5 text-sm mb-2 outline-none focus:border-accent"
          />
          <button
            onClick={save}
            disabled={saving || !token}
            className="bg-accent text-bg px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save & Connect'}
          </button>
        </div>
      )}
    </div>
  );
}

function ProjectMappingCard({
  project,
  connected,
  vercelOptions,
  supabaseOptions,
  metaOptions,
}: {
  project: ProjectRow;
  connected: Set<string>;
  vercelOptions: VercelOption[];
  supabaseOptions: SupabaseOption[];
  metaOptions: MetaOption[];
}) {
  const router = useRouter();
  const [vercel, setVercel] = useState(project.vercelProjectId ?? '');
  const [supabase, setSupabase] = useState(project.supabaseProjectRef ?? '');
  const [meta, setMeta] = useState(project.metaAdAccountId ?? '');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const dirty =
    vercel !== (project.vercelProjectId ?? '') ||
    supabase !== (project.supabaseProjectRef ?? '') ||
    meta !== (project.metaAdAccountId ?? '');

  const save = async () => {
    setSaving(true);
    const res = await fetch('/api/integrations/map-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: project.id,
        vercelProjectId: connected.has('vercel') ? vercel || null : undefined,
        supabaseProjectRef: connected.has('supabase') ? supabase || null : undefined,
        metaAdAccountId: connected.has('meta') ? meta || null : undefined,
      }),
    });
    setSaving(false);
    if (res.ok) {
      setSavedAt(Date.now());
      router.refresh();
    } else {
      alert('Failed to save mapping.');
    }
  };

  return (
    <div className="bg-bg-elev border border-border rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-orange-400 flex items-center justify-center font-display font-semibold text-bg">
            {project.name[0].toUpperCase()}
          </div>
          <div>
            <h3 className="font-medium">{project.name}</h3>
            <div className="text-xs font-mono text-text-faint">
              {project.githubRepoFullName ?? '—'}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3">
        {connected.has('vercel') && (
          <Field label="Vercel project">
            <select
              value={vercel}
              onChange={(e) => setVercel(e.target.value)}
              className="w-full bg-bg border border-border rounded-lg p-2.5 text-sm outline-none focus:border-accent"
            >
              <option value="">— none —</option>
              {vercelOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                  {o.repo ? ` · ${o.repo}` : ''}
                </option>
              ))}
            </select>
          </Field>
        )}
        {connected.has('supabase') && (
          <Field label="Supabase project">
            <select
              value={supabase}
              onChange={(e) => setSupabase(e.target.value)}
              className="w-full bg-bg border border-border rounded-lg p-2.5 text-sm outline-none focus:border-accent"
            >
              <option value="">— none —</option>
              {supabaseOptions.map((o) => (
                <option key={o.ref} value={o.ref}>
                  {o.name} ({o.ref})
                </option>
              ))}
            </select>
          </Field>
        )}
        {connected.has('meta') && (
          <Field label="Meta ad account">
            <select
              value={meta}
              onChange={(e) => setMeta(e.target.value)}
              className="w-full bg-bg border border-border rounded-lg p-2.5 text-sm outline-none focus:border-accent"
            >
              <option value="">— none —</option>
              {metaOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({o.id})
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving || !dirty}
          className="bg-accent text-bg px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save mappings'}
        </button>
        {savedAt && !dirty && (
          <span className="text-xs text-green-400">Saved.</span>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] font-mono uppercase tracking-widest text-text-faint mb-1.5 block">
        {label}
      </span>
      {children}
    </label>
  );
}
