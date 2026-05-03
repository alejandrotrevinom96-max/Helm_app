'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';

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

type ProviderId = 'vercel' | 'supabase' | 'meta';

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

type ProviderError = { message: string; hint?: string };

export function IntegrationsClient({
  connected,
  allProjects,
}: {
  connected: string[];
  allProjects: ProjectRow[];
}) {
  const connectedSet = new Set(connected);

  const [vercelOptions, setVercelOptions] = useState<VercelOption[]>([]);
  const [supabaseOptions, setSupabaseOptions] = useState<SupabaseOption[]>([]);
  const [metaOptions, setMetaOptions] = useState<MetaOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [errors, setErrors] = useState<Record<ProviderId, ProviderError | null>>({
    vercel: null,
    supabase: null,
    meta: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function fetchListing<T>(
      url: string,
      provider: ProviderId,
      pluck: (data: { projects?: T[]; accounts?: T[] }) => T[] | undefined,
      setOptions: (v: T[]) => void
    ) {
      try {
        const res = await fetch(url);
        const data = await res.json();
        if (cancelled) return;
        if (res.ok) {
          const list = pluck(data) ?? [];
          setOptions(list);
          setErrors((prev) => ({ ...prev, [provider]: null }));
        } else {
          setErrors((prev) => ({
            ...prev,
            [provider]: {
              message: data.detail || data.error || `HTTP ${res.status}`,
              hint: data.hint,
            },
          }));
        }
      } catch (e) {
        if (cancelled) return;
        setErrors((prev) => ({
          ...prev,
          [provider]: { message: e instanceof Error ? e.message : 'Network error' },
        }));
      }
    }

    async function loadOptions() {
      setLoadingOptions(true);
      const tasks: Promise<void>[] = [];
      if (connectedSet.has('vercel')) {
        tasks.push(
          fetchListing<VercelOption>(
            '/api/integrations/vercel/list-projects',
            'vercel',
            (d) => d.projects,
            setVercelOptions
          )
        );
      }
      if (connectedSet.has('supabase')) {
        tasks.push(
          fetchListing<SupabaseOption>(
            '/api/integrations/supabase/list-projects',
            'supabase',
            (d) => d.projects,
            setSupabaseOptions
          )
        );
      }
      if (connectedSet.has('meta')) {
        tasks.push(
          fetchListing<MetaOption>(
            '/api/integrations/meta/list-ad-accounts',
            'meta',
            (d) => d.accounts,
            setMetaOptions
          )
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
    <div className="p-4 md:p-8 max-w-4xl">
      <div className="mb-8 md:mb-10">
        <h1 className="font-display text-display-md font-light tracking-tight">Integrations</h1>
        <p className="text-text-2 mt-2 max-w-2xl text-sm">
          Connect your data sources, then map each Helm project to its remote counterpart.
        </p>
      </div>

      <section className="mb-10 md:mb-12">
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
              error={errors[int.id as ProviderId]}
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
            <div className="space-y-2 mb-4" aria-label="Loading remote projects">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-64" />
            </div>
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
                errors={errors}
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
  error,
}: {
  integration: { id: string; name: string; description: string; instructions: string; inputLabel: string };
  isConnected: boolean;
  error: ProviderError | null;
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    null | { ok: true; count: number } | { ok: false; message: string; hint?: string }
  >(null);

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
      setTestResult(null);
      router.refresh();
    } else {
      alert('Failed to save. Check the token format.');
    }
    setSaving(false);
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/integrations/health?provider=${integration.id}`);
      const data = await res.json();
      if (data.ok) {
        setTestResult({ ok: true, count: data.count ?? 0 });
      } else {
        setTestResult({
          ok: false,
          message: data.detail || data.error || 'Unknown error',
          hint: data.hint,
        });
      }
    } catch (e) {
      setTestResult({
        ok: false,
        message: e instanceof Error ? e.message : 'Network error',
      });
    }
    setTesting(false);
  };

  return (
    <div className="glass rounded-2xl p-4 md:p-6">
      <div className="flex justify-between items-start gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h3 className="font-medium text-lg">{integration.name}</h3>
            {isConnected && !error && (
              <span className="text-[10px] font-mono px-2 py-0.5 bg-green-500/15 text-green-400 rounded">
                CONNECTED
              </span>
            )}
            {isConnected && error && (
              <span className="text-[10px] font-mono px-2 py-0.5 bg-red-500/15 text-red-400 rounded">
                ERROR
              </span>
            )}
          </div>
          <p className="text-text-2 text-sm">{integration.description}</p>
        </div>
        <div className="flex gap-3 flex-shrink-0 text-sm">
          {isConnected && (
            <button
              onClick={testConnection}
              disabled={testing}
              className="text-accent hover:underline disabled:opacity-50"
            >
              {testing ? 'Testing…' : 'Test'}
            </button>
          )}
          <button
            onClick={() => setShowForm(!showForm)}
            className="text-accent hover:underline"
          >
            {showForm ? 'Cancel' : isConnected ? 'Replace token' : 'Connect'}
          </button>
        </div>
      </div>

      {error && !showForm && (
        <div className="mt-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-xs">
          <div className="text-red-300 font-medium mb-1">Couldn&apos;t reach {integration.name}</div>
          <div className="text-red-200/80 break-words">{error.message}</div>
          {error.hint && (
            <div className="text-red-200/60 mt-2 leading-relaxed">{error.hint}</div>
          )}
        </div>
      )}

      {testResult && !showForm && (
        <div
          className={`mt-4 rounded-lg p-3 text-xs ${
            testResult.ok
              ? 'bg-green-500/10 border border-green-500/30 text-green-300'
              : 'bg-red-500/10 border border-red-500/30 text-red-300'
          }`}
        >
          {testResult.ok
            ? `Connection OK — ${testResult.count} ${integration.id === 'meta' ? 'ad account(s)' : 'project(s)'} found.`
            : (
                <>
                  <div className="font-medium mb-1">Connection failed</div>
                  <div className="opacity-80 break-words">{testResult.message}</div>
                  {testResult.hint && (
                    <div className="opacity-60 mt-2 leading-relaxed">{testResult.hint}</div>
                  )}
                </>
              )}
        </div>
      )}

      {showForm && (
        <div className="mt-4 pt-4 border-t border-border">
          <p className="text-xs text-text-3 mb-3">{integration.instructions}</p>
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
            className="bg-[image:var(--accent-grad)] text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-transform hover:-translate-y-0.5"
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
  errors,
}: {
  project: ProjectRow;
  connected: Set<string>;
  vercelOptions: VercelOption[];
  supabaseOptions: SupabaseOption[];
  metaOptions: MetaOption[];
  errors: Record<ProviderId, ProviderError | null>;
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
    <div className="glass rounded-2xl p-4 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[image:var(--accent-grad)] flex items-center justify-center font-display font-semibold text-white">
            {project.name[0].toUpperCase()}
          </div>
          <div>
            <h3 className="font-medium">{project.name}</h3>
            <div className="text-xs font-mono text-text-3">
              {project.githubRepoFullName ?? '—'}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3">
        {connected.has('vercel') && (
          <Field label="Vercel project">
            <ProviderSelect
              providerLabel="Vercel"
              error={errors.vercel}
              options={vercelOptions.map((o) => ({
                value: o.id,
                label: `${o.name}${o.repo ? ` · ${o.repo}` : ''}`,
              }))}
              value={vercel}
              onChange={setVercel}
            />
          </Field>
        )}
        {connected.has('supabase') && (
          <Field label="Supabase project">
            <ProviderSelect
              providerLabel="Supabase"
              error={errors.supabase}
              options={supabaseOptions.map((o) => ({
                value: o.ref,
                label: `${o.name} (${o.ref})`,
              }))}
              value={supabase}
              onChange={setSupabase}
            />
          </Field>
        )}
        {connected.has('meta') && (
          <Field label="Meta ad account">
            <ProviderSelect
              providerLabel="Meta"
              error={errors.meta}
              options={metaOptions.map((o) => ({
                value: o.id,
                label: `${o.name} (${o.id})`,
              }))}
              value={meta}
              onChange={setMeta}
            />
          </Field>
        )}
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving || !dirty}
          className="bg-[image:var(--accent-grad)] text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-transform hover:-translate-y-0.5"
        >
          {saving ? 'Saving…' : 'Save mappings'}
        </button>
        {savedAt && !dirty && (
          <span className="text-xs text-success">Saved.</span>
        )}
      </div>
    </div>
  );
}

function ProviderSelect({
  providerLabel,
  error,
  options,
  value,
  onChange,
}: {
  providerLabel: string;
  error: ProviderError | null;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  if (error) {
    return (
      <div className="bg-red-500/5 border border-red-500/30 rounded-lg p-3 text-xs">
        <div className="text-red-300">
          Can&apos;t load {providerLabel} projects. Fix the credential above and try again.
        </div>
      </div>
    );
  }
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-bg border border-border rounded-lg p-2.5 text-sm outline-none focus:border-accent"
    >
      <option value="">{options.length === 0 ? '— no projects found —' : '— none —'}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-1.5 block">
        {label}
      </span>
      {children}
    </label>
  );
}
