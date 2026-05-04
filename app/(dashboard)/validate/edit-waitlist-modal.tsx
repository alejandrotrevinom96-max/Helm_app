'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';
import { TemplateConfigEditor } from './template-config-editor';
import type { TemplateConfig } from '@/lib/validate/defaults';

export interface EditableWaitlist {
  id: string;
  title: string;
  slug: string;
  template: string;
  templateConfig: TemplateConfig | null;
}

export function EditWaitlistModal({
  page,
  onClose,
  onSaved,
}: {
  page: EditableWaitlist | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState('');
  const [templateConfig, setTemplateConfig] = useState<TemplateConfig>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!page) return;
    setTitle(page.title);
    setTemplateConfig((page.templateConfig as TemplateConfig | null) ?? {});
    setError(null);
  }, [page]);

  // Escape close — keeps the dialog dismissible without grabbing focus.
  useEffect(() => {
    if (!page) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [page, onClose]);

  if (!page) return null;

  const save = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/waitlist-pages?id=${page.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, templateConfig }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? 'Could not save');
      } else {
        onSaved();
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Edit waitlist page"
    >
      <GlassCard
        elevated
        className="max-w-2xl w-full p-6 my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start mb-4 gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-1 truncate">
              {page.template} · /w/{page.slug} (slug locked)
            </div>
            <h2 className="font-display text-2xl font-light">Edit waitlist page</h2>
          </div>
          <button
            onClick={onClose}
            className="text-text-3 hover:text-text-1 text-xl leading-none px-1"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="space-y-5">
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
              Page title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-bg-elev border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>

          <TemplateConfigEditor
            templateId={page.template}
            config={templateConfig}
            onChange={setTemplateConfig}
          />

          {error && <p className="text-xs text-danger">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={loading || !title.trim()}>
              {loading ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
