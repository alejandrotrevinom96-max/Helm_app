'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

interface Quote {
  id: string;
  content: string;
  source: string | null;
  context: string | null;
  tags: string[] | null;
  usageCount: number;
}

export function QuoteVault({ projectId }: { projectId: string }) {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form state
  const [content, setContent] = useState('');
  const [source, setSource] = useState('');
  const [context, setContext] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchQuotes = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/brand/quotes?projectId=${projectId}`);
      const data = await res.json();
      setQuotes(data.quotes ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQuotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const resetForm = () => {
    setContent('');
    setSource('');
    setContext('');
    setTagsInput('');
    setShowAdd(false);
    setEditingId(null);
  };

  const submitQuote = async () => {
    if (!content.trim()) return;
    setSubmitting(true);
    try {
      const tags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const body = {
        projectId,
        content: content.trim(),
        source: source.trim() || null,
        context: context.trim() || null,
        tags,
      };

      if (editingId) {
        await fetch(`/api/brand/quotes/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        await fetch('/api/brand/quotes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      resetForm();
      await fetchQuotes();
    } finally {
      setSubmitting(false);
    }
  };

  const editQuote = (q: Quote) => {
    setContent(q.content);
    setSource(q.source ?? '');
    setContext(q.context ?? '');
    setTagsInput((q.tags ?? []).join(', '));
    setEditingId(q.id);
    setShowAdd(true);
  };

  const deleteQuote = async (id: string) => {
    if (!confirm('Delete this quote?')) return;
    await fetch(`/api/brand/quotes/${id}`, { method: 'DELETE' });
    await fetchQuotes();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-start gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-1">
            Quote vault
          </div>
          <h3 className="font-display text-xl font-light">
            Your authentic voice
          </h3>
          <p className="text-sm text-text-2 mt-1">
            Add quotes you&apos;ve said in podcasts, tweets that worked, or things
            you actually believe. Helm seeds these into post generation.
          </p>
        </div>
        {!showAdd && (
          <Button size="sm" onClick={() => setShowAdd(true)}>
            + Add quote
          </Button>
        )}
      </div>

      {showAdd && (
        <div className="p-4 bg-bg-elev rounded-lg space-y-3">
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-[0.1em] text-text-3 mb-1">
              Quote
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Something you said or wrote that captures your brand…"
              className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <div className="text-[10px] text-text-3 mt-1 text-right">
              {content.length}/1000
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-mono uppercase tracking-[0.1em] text-text-3 mb-1">
                Source (optional)
              </label>
              <input
                type="text"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="Podcast name, tweet, conversation…"
                className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-[10px] font-mono uppercase tracking-[0.1em] text-text-3 mb-1">
                Tags (comma-separated)
              </label>
              <input
                type="text"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="speed, honesty, anti-corp"
                className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-mono uppercase tracking-[0.1em] text-text-3 mb-1">
              Context (optional)
            </label>
            <input
              type="text"
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="When you said this, why it resonates…"
              className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={resetForm} disabled={submitting}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={submitQuote}
              disabled={!content.trim() || submitting}
            >
              {submitting
                ? 'Saving…'
                : editingId
                  ? 'Update quote'
                  : 'Add to vault'}
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-text-3">Loading quotes…</p>
      ) : quotes.length === 0 ? (
        <div className="text-center py-6">
          <p className="text-sm text-text-2 mb-2">No quotes yet.</p>
          <p className="text-xs text-text-3">
            Even 3-5 quotes radically improve generation quality.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {quotes.map((q) => (
            <div
              key={q.id}
              className="group p-3 bg-bg-elev rounded-lg"
            >
              <p className="text-sm text-text-1 italic mb-2">
                &ldquo;{q.content}&rdquo;
              </p>
              <div className="flex flex-wrap items-center gap-2 text-[10px]">
                {q.source && (
                  <span className="text-text-3">— {q.source}</span>
                )}
                {(q.tags ?? []).map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 rounded-full bg-surface-1 text-text-2 font-mono"
                  >
                    {tag}
                  </span>
                ))}
                {q.usageCount > 0 && (
                  <span className="text-accent font-mono">
                    used {q.usageCount}×
                  </span>
                )}
                <div className="ml-auto flex gap-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                  <button
                    onClick={() => editQuote(q)}
                    className="text-text-3 hover:text-text-1"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deleteQuote(q.id)}
                    className="text-text-3 hover:text-danger"
                  >
                    Delete
                  </button>
                </div>
              </div>
              {q.context && (
                <p className="text-[11px] text-text-3 mt-2 pt-2 border-t border-border">
                  {q.context}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
