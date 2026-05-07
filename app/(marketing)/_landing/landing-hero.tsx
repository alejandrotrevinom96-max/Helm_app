'use client';

// PR #34 — Sprint 6.2: landing hero rebuild with viral URL preview.
//
// The hero is the conversion engine. Three states:
//   1. INPUT  — user types their URL, clicks "See your brand".
//   2. LOADING — single button + spinner; honest "~30s" copy.
//   3. PREVIEW — AI-rendered card showing archetype + voice +
//      pillars + audience + one-liner. Lock teaser ("12 more pillars
//      + writing rules") drives signup.
//
// Implementation notes:
//   - One client-side fetch to /api/public/preview-bible. That route
//     handles rate limits, URL validation, anti-SSRF, and Haiku.
//   - "Try another →" resets to state 1 without a page reload.
//   - The preview CTA passes ?url= to /signup so the new account
//     can auto-generate the full bible from the same URL.
//
// Copy decisions baked into this PR:
//   - Tagline: "Brand-aware content that sounds like you. Posted
//     automatically." — last line in italics for the editorial feel.
//   - Pre-headline pill: "Free for first 20 founders" — matches the
//     CTA section, no "now live" timestamping.
import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight, Loader2, Lock, Sparkles } from 'lucide-react';

interface PreviewData {
  archetype: string;
  voice: string;
  pillars: string[];
  audience: string;
  oneLiner: string;
}

export function LandingHero() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scrapedUrl, setScrapedUrl] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);

  const handlePreview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    setPreview(null);
    try {
      const res = await fetch('/api/public/preview-bible', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong');
        return;
      }
      setPreview(data.preview);
      setScrapedUrl(data.url);
      setRemaining(
        typeof data.remainingRequests === 'number'
          ? data.remainingRequests
          : null
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setPreview(null);
    setScrapedUrl(null);
    setUrl('');
    setError(null);
  };

  return (
    <section className="pt-32 md:pt-36 pb-20 md:pb-24 px-4 md:px-8 max-w-5xl mx-auto relative">
      {/* Subtle accent halo behind the hero — softer than the v1
          glow so the page reads as editorial, not AI-tool. */}
      <div
        aria-hidden
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[500px] bg-accent-glow blur-[140px] opacity-20 -z-10 pointer-events-none"
      />

      <div className="text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 mb-6 bg-bg-elev/60 border border-border rounded-full">
          <span className="w-1.5 h-1.5 rounded-full bg-success animate-[pulse-dot_2s_ease-in-out_infinite]" />
          <span className="text-xs font-mono uppercase tracking-[0.15em] text-text-3">
            Free for first 20 founders
          </span>
        </div>

        <h1 className="font-display text-5xl md:text-6xl lg:text-7xl font-light tracking-tight leading-[1.05] mb-6">
          Brand-aware content
          <br />
          that sounds like <em className="editorial-italic">you</em>.
          <br />
          <span className="text-text-3">Posted automatically.</span>
        </h1>

        <p className="text-base md:text-lg text-text-2 max-w-2xl mx-auto mb-10 leading-relaxed">
          AI reads your existing brand. Generates posts that fit your voice.
          Schedules and publishes to Meta. Built for founders who ship.
        </p>

        {!preview ? (
          <form
            onSubmit={handlePreview}
            className="max-w-xl mx-auto"
            aria-label="Generate a brand preview from your website"
          >
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="yoursite.com"
                disabled={loading}
                className="flex-1 px-4 py-3 bg-bg-elev border border-border rounded-lg text-base outline-none focus:border-accent disabled:opacity-50 placeholder:text-text-3"
                autoComplete="url"
                inputMode="url"
              />
              <button
                type="submit"
                disabled={loading || !url.trim()}
                className="px-6 py-3 bg-accent text-white rounded-lg font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2 whitespace-nowrap"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Reading…
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    See your brand
                  </>
                )}
              </button>
            </div>
            <p className="text-xs text-text-3 mt-3">
              Free preview · No signup needed · ~30 seconds
            </p>
            {error && (
              <div className="mt-4 p-3 bg-danger/10 border border-danger/30 rounded-lg text-sm text-danger">
                {error}
              </div>
            )}
          </form>
        ) : (
          <div className="max-w-2xl mx-auto bg-bg-elev/60 border border-border rounded-2xl p-6 md:p-8 text-left">
            <div className="flex items-center justify-between mb-5 gap-3">
              <div className="min-w-0">
                <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-1">
                  Brand bible · Preview
                </div>
                <div
                  className="text-sm text-accent truncate"
                  title={scrapedUrl ?? ''}
                >
                  {scrapedUrl}
                </div>
              </div>
              <button
                type="button"
                onClick={reset}
                className="text-xs text-text-3 hover:text-text-1 whitespace-nowrap"
              >
                Try another →
              </button>
            </div>

            {/* Pull-quote one-liner — the most click-worthy thing in
                the preview, so it leads. */}
            {preview.oneLiner && (
              <h3 className="font-display text-xl md:text-2xl mb-6 leading-snug">
                &ldquo;{preview.oneLiner}&rdquo;
              </h3>
            )}

            <div className="grid grid-cols-2 gap-5 mb-6 text-sm">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-1.5">
                  Archetype
                </div>
                <div className="font-medium text-text-1">
                  {preview.archetype || '—'}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-1.5">
                  Voice
                </div>
                <div className="font-medium text-text-1">
                  {preview.voice || '—'}
                </div>
              </div>
              <div className="col-span-2">
                <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-1.5">
                  Audience
                </div>
                <div>{preview.audience || '—'}</div>
              </div>
              {preview.pillars.length > 0 && (
                <div className="col-span-2">
                  <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
                    Pillars (preview)
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {preview.pillars.map((p, i) => (
                      <span
                        key={i}
                        className="px-3 py-1 bg-accent/10 text-accent rounded-full text-xs"
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 p-4 bg-bg/60 border border-border rounded-lg">
              <Lock className="w-5 h-5 text-text-3 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">
                  12 more dimensions, writing rules, and sample posts
                </div>
                <div className="text-xs text-text-3">
                  Sign up free to unlock the full bible.
                </div>
              </div>
            </div>

            <Link
              href={`/signup${scrapedUrl ? `?url=${encodeURIComponent(scrapedUrl)}` : ''}`}
              className="mt-5 w-full inline-flex items-center justify-center gap-2 px-6 py-3 bg-accent text-white rounded-lg font-medium hover:opacity-90 transition-opacity"
            >
              See full bible
              <ArrowRight className="w-4 h-4" />
            </Link>

            {typeof remaining === 'number' && remaining < 3 && (
              <p className="text-xs text-text-3 mt-3 text-center">
                {remaining} free preview{remaining === 1 ? '' : 's'} left
                this hour.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
