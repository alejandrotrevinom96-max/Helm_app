'use client';

import { useState } from 'react';
import { SuccessState, type PublicPageData } from './_shared';

export function MinimalTemplate({ slug, page }: { slug: string; page: PublicPageData }) {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const config = page.templateConfig ?? {};
  const subtitle = config.subtitle ?? page.subtitle ?? '';
  const ctaText = config.ctaText ?? page.ctaText ?? 'Join waitlist';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/w/${slug}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, template: 'minimal' }),
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
        heading="You're on the list"
        message="We'll be in touch when we launch."
      />
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="max-w-lg w-full">
        <h1 className="font-display text-display-md font-light tracking-tight text-center mb-3">
          {page.title}
        </h1>
        {subtitle && (
          <p className="text-text-2 text-center mb-8 leading-relaxed">{subtitle}</p>
        )}
        <form onSubmit={submit} className="flex flex-col sm:flex-row gap-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            className="flex-1 bg-bg-elev border border-border rounded-lg px-4 py-3 text-base outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-3 bg-[image:var(--accent-grad)] text-white font-medium rounded-lg disabled:opacity-50 transition-transform hover:-translate-y-0.5"
          >
            {loading ? 'Joining…' : ctaText}
          </button>
        </form>
        {error && <p className="text-danger text-sm mt-3 text-center">{error}</p>}
      </div>
    </div>
  );
}
