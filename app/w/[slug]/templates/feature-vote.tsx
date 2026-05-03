'use client';

import { useState } from 'react';
import { SuccessState, type PublicPageData } from './_shared';

export function FeatureVoteTemplate({
  slug,
  page,
}: {
  slug: string;
  page: PublicPageData;
}) {
  const [email, setEmail] = useState('');
  const [votes, setVotes] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const config = page.templateConfig ?? {};
  const subtitle = config.subtitle ?? page.subtitle ?? '';
  const ctaText = config.ctaText ?? page.ctaText ?? 'Submit votes';
  const features = config.features ?? [];
  const maxVotes = config.maxVotesPerUser ?? 3;

  const toggleVote = (id: string) => {
    if (votes.includes(id)) {
      setVotes(votes.filter((v) => v !== id));
    } else if (votes.length < maxVotes) {
      setVotes([...votes, id]);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (votes.length === 0) {
      setError('Pick at least one feature');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/w/${slug}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          responses: { votes },
          template: 'feature-vote',
        }),
      });
      if (res.ok) setSubmitted(true);
      else {
        const data = await res.json();
        setError(data.error || 'Could not submit');
      }
    } catch {
      setError('Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <SuccessState
        heading="Votes submitted"
        message="We'll keep you posted on what we build."
      />
    );
  }

  return (
    <div className="min-h-screen px-4 py-12">
      <div className="max-w-2xl mx-auto">
        <h1 className="font-display text-display-md font-light tracking-tight mb-3">
          {page.title}
        </h1>
        {subtitle && (
          <p className="text-text-2 mb-2 leading-relaxed text-lg">{subtitle}</p>
        )}
        <p className="text-text-3 text-sm mb-8">
          Pick up to {maxVotes} · {votes.length}/{maxVotes} selected
        </p>

        <div className="space-y-3 mb-8">
          {features.map((f) => {
            const isSelected = votes.includes(f.id);
            const isDisabled = !isSelected && votes.length >= maxVotes;
            return (
              <button
                type="button"
                key={f.id}
                onClick={() => toggleVote(f.id)}
                disabled={isDisabled}
                className={`w-full text-left p-4 rounded-xl border transition-colors ${
                  isSelected
                    ? 'border-accent bg-accent-soft'
                    : isDisabled
                      ? 'border-border opacity-40 cursor-not-allowed'
                      : 'border-border hover:border-border-bright'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`w-5 h-5 rounded-full border-2 flex-shrink-0 mt-0.5 flex items-center justify-center ${
                      isSelected ? 'border-accent bg-accent' : 'border-border'
                    }`}
                  >
                    {isSelected && (
                      <svg
                        className="w-3 h-3 text-white"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={3}
                      >
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <div>
                    <div className="font-medium text-text-1">{f.title}</div>
                    <div className="text-sm text-text-2 mt-1">{f.description}</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <form onSubmit={submit} className="space-y-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            className="w-full bg-bg-elev border border-border rounded-lg px-4 py-3 text-base outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={loading || votes.length === 0}
            className="w-full px-6 py-3 bg-[image:var(--accent-grad)] text-white font-medium rounded-lg disabled:opacity-50 transition-transform hover:-translate-y-0.5"
          >
            {loading ? 'Submitting…' : ctaText}
          </button>
          {error && <p className="text-danger text-sm">{error}</p>}
        </form>
      </div>
    </div>
  );
}
