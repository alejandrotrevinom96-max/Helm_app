'use client';

import { useState } from 'react';

export function WaitlistForm({ pageId, ctaText }: { pageId: string; ctaText: string }) {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const res = await fetch('/api/waitlist-pages/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageId, email }),
    });
    if (res.ok) setSubmitted(true);
    setLoading(false);
  };

  if (submitted) {
    return (
      <div className="glass-elevated rounded-2xl p-8 max-w-md mx-auto">
        <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-success-soft border border-success/20 flex items-center justify-center">
          <svg
            className="w-6 h-6 text-success"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="text-2xl font-display font-light mb-2">You&apos;re in.</p>
        <p className="text-text-2 text-sm">We&apos;ll email you when we have updates.</p>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col sm:flex-row gap-2 max-w-md mx-auto glass-elevated rounded-2xl p-1.5"
    >
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        className="flex-1 bg-transparent border-none outline-none px-4 py-2 text-text-1 placeholder:text-text-3"
      />
      <button
        type="submit"
        disabled={loading}
        className="bg-[image:var(--accent-grad)] text-white px-5 py-2 rounded-xl font-medium disabled:opacity-50 transition-transform hover:-translate-y-0.5"
      >
        {loading ? '...' : ctaText}
      </button>
    </form>
  );
}
