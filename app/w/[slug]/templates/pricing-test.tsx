'use client';

import { useState } from 'react';
import { SuccessState, type PublicPageData } from './_shared';

export function PricingTestTemplate({
  slug,
  page,
}: {
  slug: string;
  page: PublicPageData;
}) {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const config = page.templateConfig ?? {};
  const subtitle = config.subtitle ?? page.subtitle ?? '';
  const price = config.pricePerMonth ?? 19;
  const variant = config.priceVariant ?? 'a';
  const discount = config.discountPct ?? 50;
  const discountedPrice = Math.round(price * (1 - discount / 100));
  const ctaText = config.ctaText ?? page.ctaText ?? `Reserve at $${discountedPrice}/mo`;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/w/${slug}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          responses: { commit: true, price, variant, discountedPrice },
          template: 'pricing-test',
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
        heading="Your spot is reserved"
        message={`Founding member rate of $${discountedPrice}/mo locked in.`}
      />
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="max-w-lg w-full text-center">
        <h1 className="font-display text-display-md font-light tracking-tight mb-3">
          {page.title}
        </h1>
        {subtitle && (
          <p className="text-text-2 mb-8 leading-relaxed">{subtitle}</p>
        )}

        <div className="glass rounded-2xl p-8 mb-8">
          <div className="flex items-baseline justify-center gap-2 mb-2">
            <span className="text-text-3 line-through text-2xl">${price}</span>
            <span className="font-display text-6xl font-light tracking-tight">
              ${discountedPrice}
            </span>
            <span className="text-text-2">/mo</span>
          </div>
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-accent">
            Founding member · {discount}% off forever
          </div>
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
            disabled={loading}
            className="w-full px-6 py-3 bg-[image:var(--accent-grad)] text-white font-medium rounded-lg disabled:opacity-50 transition-transform hover:-translate-y-0.5"
          >
            {loading ? 'Reserving…' : ctaText}
          </button>
          <p className="text-xs text-text-3">
            No charge today. We&apos;ll email when we launch.
          </p>
          {error && <p className="text-danger text-sm">{error}</p>}
        </form>
      </div>
    </div>
  );
}
