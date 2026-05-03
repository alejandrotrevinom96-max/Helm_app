'use client';

import { useState } from 'react';
import { SuccessState, type PublicPageData } from './_shared';

export function Survey5QTemplate({
  slug,
  page,
}: {
  slug: string;
  page: PublicPageData;
}) {
  const [email, setEmail] = useState('');
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const config = page.templateConfig ?? {};
  const subtitle = config.subtitle ?? page.subtitle ?? '';
  const ctaText = config.ctaText ?? page.ctaText ?? 'Submit answers';
  const questions = config.questions ?? [];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const responses: Record<string, string> = {};
      questions.forEach((_q, i) => {
        responses[`q${i}`] = answers[i] ?? '';
      });
      const res = await fetch(`/api/w/${slug}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          responses,
          template: 'survey-5q',
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
        heading="Thanks for your answers"
        message="Your input shapes what we build next."
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
          <p className="text-text-2 mb-10 leading-relaxed text-lg">{subtitle}</p>
        )}

        <form onSubmit={submit} className="space-y-6">
          {questions.map((q, i) => (
            <div key={i}>
              <label className="block text-sm text-text-1 mb-2">
                <span className="text-text-3 mr-2 font-mono">{i + 1}.</span>
                {q}
              </label>
              <textarea
                value={answers[i] ?? ''}
                onChange={(e) => setAnswers({ ...answers, [i]: e.target.value })}
                required
                rows={3}
                className="w-full bg-bg-elev border border-border rounded-lg px-4 py-3 text-sm outline-none focus:border-accent resize-none"
              />
            </div>
          ))}

          <div className="pt-4 border-t border-border">
            <label className="block text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
              Your email (optional, for follow-up)
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-bg-elev border border-border rounded-lg px-4 py-3 text-base outline-none focus:border-accent"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
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
