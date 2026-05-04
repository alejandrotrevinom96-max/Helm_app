'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Project } from '@/lib/db/schema';
import { slugify } from '@/lib/utils';
import {
  validateTemplates,
  type ValidateTemplateId,
} from '@/lib/validate/templates';
import { getDefaultConfig, type TemplateConfig } from '@/lib/validate/defaults';
import { TemplateConfigEditor } from './template-config-editor';
import { PreviewModal } from './preview-modal';
import { EditWaitlistModal, type EditableWaitlist } from './edit-waitlist-modal';
import { Button } from '@/components/ui/button';
import { broadcastEvent, useBroadcast } from '@/hooks/use-broadcast';

function PageActionsMenu({
  pageId,
  title,
  isArchived,
  onEdit,
}: {
  pageId: string;
  title: string;
  isArchived: boolean;
  onEdit: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const archive = async () => {
    if (
      !confirm(
        `Archive "${title}"? It will stop accepting responses but data is preserved.`
      )
    )
      return;
    setBusy(true);
    const res = await fetch(`/api/waitlist-pages?id=${pageId}`, {
      method: 'DELETE',
    });
    setBusy(false);
    if (res.ok) {
      broadcastEvent({ type: 'waitlist-archived' });
      location.reload();
    } else {
      alert('Could not archive');
    }
  };

  const restore = async () => {
    setBusy(true);
    const res = await fetch(`/api/waitlist-pages?id=${pageId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: true }),
    });
    setBusy(false);
    if (res.ok) {
      broadcastEvent({ type: 'waitlist-archived' });
      location.reload();
    } else {
      alert('Could not restore');
    }
  };

  const duplicate = async () => {
    setBusy(true);
    const res = await fetch('/api/waitlist-pages/duplicate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: pageId }),
    });
    setBusy(false);
    if (res.ok) {
      broadcastEvent({ type: 'waitlist-duplicated' });
      location.reload();
    } else {
      alert('Could not duplicate');
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        disabled={busy}
        className="text-text-3 hover:text-text-1 px-2 py-1 disabled:opacity-50"
        aria-label="Page actions"
        aria-expanded={open}
      >
        ⋯
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 z-20 glass-elevated rounded-lg py-1 min-w-[140px] shadow-editorial-lg">
            {!isArchived && (
              <button
                onClick={() => {
                  setOpen(false);
                  onEdit();
                }}
                className="w-full text-left px-3 py-2 text-xs hover:bg-surface-1"
              >
                Edit
              </button>
            )}
            <button
              onClick={() => {
                setOpen(false);
                duplicate();
              }}
              disabled={busy}
              className="w-full text-left px-3 py-2 text-xs hover:bg-surface-1 disabled:opacity-50"
            >
              Duplicate
            </button>
            {isArchived ? (
              <button
                onClick={() => {
                  setOpen(false);
                  restore();
                }}
                disabled={busy}
                className="w-full text-left px-3 py-2 text-xs text-accent hover:bg-surface-1 disabled:opacity-50"
              >
                Restore
              </button>
            ) : (
              <button
                onClick={() => {
                  setOpen(false);
                  archive();
                }}
                disabled={busy}
                className="w-full text-left px-3 py-2 text-xs text-danger hover:bg-surface-1 disabled:opacity-50"
              >
                Archive
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

interface PageWithCount {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  isActive: boolean | null;
  createdAt: Date | string;
  template: string | null;
  templateConfig: TemplateConfig | null;
  responseCount: number;
}

const TEMPLATE_LABEL: Record<string, string> = {
  minimal: 'Pre-launch',
  'beta-tester': 'Beta tester',
  'feature-vote': 'Feature vote',
  'pricing-test': 'Pricing test',
  'survey-5q': 'Survey',
};

export function ValidateClient({
  project,
  pages,
  showArchived,
  archivedCount,
}: {
  project: Project;
  pages: PageWithCount[];
  showArchived: boolean;
  archivedCount: number;
}) {
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [selectedTemplate, setSelectedTemplate] =
    useState<ValidateTemplateId>('minimal');
  const [templateConfig, setTemplateConfig] = useState<TemplateConfig>(
    getDefaultConfig('minimal')
  );
  const [showConfig, setShowConfig] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [editingPage, setEditingPage] = useState<EditableWaitlist | null>(null);

  // Reset config when template changes so the editor shows the right defaults
  useEffect(() => {
    setTemplateConfig(getDefaultConfig(selectedTemplate));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTemplate]);

  // Cross-tab refresh: if any other tab created/archived/duplicated a
  // waitlist, our list is stale and the easiest fix is a full reload.
  useBroadcast((event) => {
    if (event.type.startsWith('waitlist-')) {
      location.reload();
    }
  });

  const create = async () => {
    if (!title.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/waitlist-pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          title,
          subtitle: templateConfig.subtitle ?? '',
          slug: slugify(title),
          template: selectedTemplate,
          templateConfig,
        }),
      });
      if (res.ok) {
        broadcastEvent({ type: 'waitlist-created' });
        location.reload();
      } else {
        const data = await res.json();
        setError(data.error ?? 'Could not create');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const activeTemplate = validateTemplates.find((t) => t.id === selectedTemplate)!;

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6 md:mb-8">
        <h1 className="font-display text-display-md font-light tracking-tight">
          Validate
        </h1>
        <p className="text-text-2 mt-2 max-w-2xl text-sm">
          Test ideas with public landing pages — five templates depending on
          what you want to learn.
        </p>
      </div>

      <div className="glass rounded-2xl p-4 md:p-6 mb-6">
        <h2 className="font-display text-xl font-medium mb-4">
          Create new validation page
        </h2>

        <div className="mb-5">
          <label className="block text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-3">
            Choose validation type
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {validateTemplates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedTemplate(t.id)}
                className={`text-left p-4 rounded-xl border transition-colors ${
                  selectedTemplate === t.id
                    ? 'border-accent bg-accent-soft'
                    : 'border-border hover:border-border-bright'
                }`}
              >
                <div className="font-medium text-text-1 mb-1">{t.name}</div>
                <div className="text-xs text-text-2 mb-2">{t.description}</div>
                <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3">
                  best for · {t.bestFor}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3 mb-4">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Page title"
            className="w-full bg-bg border border-border rounded-lg p-3 text-sm outline-none focus:border-accent"
          />
          {title && (
            <p className="text-xs text-text-3 font-mono break-all">
              URL: {baseUrl}/w/{slugify(title)}
            </p>
          )}
        </div>

        {activeTemplate.hasCustomFields ? (
          <div className="mb-4">
            <button
              type="button"
              onClick={() => setShowConfig(!showConfig)}
              className="text-sm text-accent hover:underline mb-3"
            >
              {showConfig ? 'Hide' : 'Configure'} template fields →
            </button>
            {showConfig && (
              <div className="border border-border rounded-xl p-4">
                <TemplateConfigEditor
                  templateId={selectedTemplate}
                  config={templateConfig}
                  onChange={setTemplateConfig}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="mb-4">
            <input
              value={templateConfig.subtitle ?? ''}
              onChange={(e) =>
                setTemplateConfig({ ...templateConfig, subtitle: e.target.value })
              }
              placeholder="Subtitle (optional)"
              className="w-full bg-bg border border-border rounded-lg p-3 text-sm outline-none focus:border-accent"
            />
          </div>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPreviewOpen(true)}
            disabled={!title.trim()}
          >
            Preview ↗
          </Button>
          <button
            onClick={create}
            disabled={creating || !title.trim()}
            className="bg-[image:var(--accent-grad)] text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-transform hover:-translate-y-0.5"
          >
            {creating ? 'Creating…' : 'Create + Get URL →'}
          </button>
          {error && <span className="text-xs text-danger">{error}</span>}
        </div>
      </div>

      <PreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        template={selectedTemplate}
        title={title}
        templateConfig={templateConfig}
      />

      <EditWaitlistModal
        page={editingPage}
        onClose={() => setEditingPage(null)}
        onSaved={() => location.reload()}
      />

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h2 className="font-display text-xl font-medium">
          {showArchived ? 'Archived pages' : 'Your pages'}
        </h2>
        <Link
          href={showArchived ? '/validate' : '/validate?archived=true'}
          className="text-xs text-text-3 hover:text-text-1"
        >
          {showArchived
            ? '← Active pages'
            : `Show archived (${archivedCount}) →`}
        </Link>
      </div>
      {pages.length === 0 ? (
        <p className="text-text-3 text-sm">
          No pages yet. Create your first one above.
        </p>
      ) : (
        <div className="space-y-3">
          {pages.map((p) => (
            <div
              key={p.id}
              className="glass rounded-2xl p-4 md:p-5 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <h3 className="font-medium">{p.title}</h3>
                  <span className="text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-0.5 rounded-full bg-accent-soft text-accent border border-accent/20">
                    {TEMPLATE_LABEL[p.template ?? 'minimal'] ?? 'Custom'}
                  </span>
                </div>
                <a
                  href={`/w/${p.slug}`}
                  target="_blank"
                  className="text-xs font-mono text-accent hover:underline break-all"
                >
                  {baseUrl}/w/{p.slug} ↗
                </a>
              </div>
              <div className="flex items-center gap-4 sm:gap-5 flex-shrink-0">
                <div className="text-left sm:text-right">
                  <div className="font-display text-2xl font-medium leading-none">
                    {p.responseCount}
                  </div>
                  <div className="text-[10px] uppercase tracking-[0.15em] text-text-3 mt-1">
                    responses
                  </div>
                </div>
                <Link
                  href={`/validate/${p.slug}/responses`}
                  className="text-sm text-accent hover:underline whitespace-nowrap"
                >
                  View →
                </Link>
                <PageActionsMenu
                  pageId={p.id}
                  title={p.title}
                  isArchived={showArchived}
                  onEdit={() =>
                    setEditingPage({
                      id: p.id,
                      title: p.title,
                      slug: p.slug,
                      template: p.template ?? 'minimal',
                      templateConfig: p.templateConfig,
                    })
                  }
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
