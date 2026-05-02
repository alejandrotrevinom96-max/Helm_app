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
      <div className="bg-bg-elev border border-border rounded-xl p-6 max-w-md mx-auto">
        <p className="text-2xl font-display mb-2">You&apos;re in. ✓</p>
        <p className="text-text-dim text-sm">We&apos;ll email you when we have updates.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex gap-2 max-w-md mx-auto bg-bg-elev border border-border-bright rounded-xl p-1.5">
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        className="flex-1 bg-transparent border-none outline-none px-4 py-2 text-text"
      />
      <button
        type="submit"
        disabled={loading}
        className="bg-accent text-bg px-5 py-2 rounded-lg font-medium disabled:opacity-50"
      >
        {loading ? '...' : ctaText}
      </button>
    </form>
  );
}
