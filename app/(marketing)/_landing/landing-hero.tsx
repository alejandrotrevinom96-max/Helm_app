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
// PR #36 — Sprint 6.2.2: input also accepts an Instagram handle
// (@yourhandle, instagram.com/yourhandle). Backend detects the
// type, scrapes accordingly, and returns `source` so the preview
// card can hint when data is thinner ("Read from Instagram bio").
//
// PR #36 — Sprint 6.2.3: manual description fallback. Two testers
// reported the scraper failing (Meta login wall, dead URL, blocked
// bot) and had no recourse. Solution: when the API returns an
// error, the error block surfaces a "✏ Describe your brand
// manually instead" link. Click it → the URL row swaps for a
// textarea (in-place, same card) with a CONCRETE example as the
// placeholder so users learn what specificity looks like. Submit
// posts `{ description }` to the same endpoint and renders the
// same preview shape, with "Generated from your description"
// instead of a URL.
//
// PR #38 — Sprint 6.4: copy pivot. Pre-PR-38 the H1 closed with
// "Posted automatically." — that promised native auto-publishing
// to Meta, which is blocked behind App Review (requires MX fiscal
// address the user doesn't have, 4–6 week timeline). New pitch is
// "Ship it your way." + a 1-tap share affordance that works TODAY
// across every platform via Web Share API. Auto-post to Meta
// stays on the roadmap as V3 — the share button buys us the
// shipping window. Subhead also reframed: instead of "Schedules
// and publishes to Meta" we now say "1 tap to share to Instagram,
// Facebook, X, anywhere".
//
// Implementation notes:
//   - One client-side fetch to /api/public/preview-bible. That
//     route handles rate limits, URL validation, anti-SSRF, IG
//     scraping, description path, and Haiku.
//   - "Try another →" resets to state 1 (URL mode) without a page
//     reload, regardless of which mode generated the preview.
//   - The preview CTA passes ?url= to /signup so the new account
//     can auto-generate the full bible from the same URL. For
//     description-mode previews there's no URL to pass; the user
//     re-enters context inside /onboarding.
//
// Copy decisions:
//   - Tagline: "Brand-aware content that sounds like you. Posted
//     automatically." — last line in italics for the editorial feel.
//   - Pre-headline pill: "Free for first 20 founders".
//   - Description placeholder is a SPECIFIC Shopify-flavored
//     example, not a generic "Describe your business". The example
//     teaches the user what good input looks like (concrete who +
//     concrete what + concrete why).
import Link from 'next/link';
import { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  Lock,
  Pencil,
  Sparkles,
} from 'lucide-react';

interface PreviewData {
  archetype: string;
  voice: string;
  pillars: string[];
  audience: string;
  oneLiner: string;
}

// PR #36 — Sprint 6.2.2 added 'instagram'; Sprint 6.2.3 adds
// 'description' (no scrape, founder typed the brand context).
type PreviewSource = 'website' | 'instagram' | 'description';

const DESCRIPTION_MIN_CHARS = 30;
const DESCRIPTION_MAX_CHARS = 1000;

// PR #36 Sprint 6.2.3 — concrete placeholder. The whole point of
// not using "Describe your business" is that an example teaches
// the user the shape of useful input: who, what, why, and an
// audience-specifying detail (here, "$10k–$100k/mo").
const DESCRIPTION_PLACEHOLDER =
  'We help small Shopify founders stop losing money to chargebacks. AI flags risky orders before fulfillment, with a one-line reason for each flag. Built for stores doing $10k–$100k/mo.';

export function LandingHero() {
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [showDescription, setShowDescription] = useState(false);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scrapedUrl, setScrapedUrl] = useState<string | null>(null);
  const [source, setSource] = useState<PreviewSource | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);

  const descriptionLen = description.trim().length;
  const descriptionReady = descriptionLen >= DESCRIPTION_MIN_CHARS;

  const handlePreview = async (e: React.FormEvent) => {
    e.preventDefault();

    // Per-mode guard. The submit button is also disabled in these
    // cases; this is the belt-and-braces version.
    if (showDescription) {
      if (!descriptionReady) return;
    } else {
      if (!url.trim()) return;
    }

    setLoading(true);
    setError(null);
    setPreview(null);
    setSource(null);
    try {
      const res = await fetch('/api/public/preview-bible', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // PR #36 Sprint 6.2.3 — body shape is mode-driven. The
        // backend treats `description` as authoritative when
        // present (skips URL/IG path entirely).
        body: JSON.stringify(
          showDescription
            ? { description: description.trim() }
            : { input: url.trim() }
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong');
        return;
      }
      setPreview(data.preview);
      setScrapedUrl(data.url ?? null);
      setSource(
        data.source === 'instagram' ||
          data.source === 'website' ||
          data.source === 'description'
          ? data.source
          : null
      );
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
    setSource(null);
    setUrl('');
    setDescription('');
    setShowDescription(false);
    setError(null);
  };

  // PR #36 Sprint 6.2.3 — fallback from URL mode into description
  // mode. We keep the user's URL string in state so they can flip
  // back via "Back to URL" without retyping.
  const switchToDescription = () => {
    setShowDescription(true);
    setError(null);
  };

  const switchToUrl = () => {
    setShowDescription(false);
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

        {/* PR #41 — Sprint 6.6: H1 rewrite to confessional 3-line opener.
            PR #82 — Sprint 7.7: positioning shift to "Marketing OS" — same
            confessional tone but compressed into a category-naming move.
            H2 carries the emotional anchor ("ship") that runs through the
            footer + roadmap copy. The original URL-preview state machine
            below is preserved verbatim — it's the conversion engine
            (PR #34 + #36) and we don't touch its strings. */}
        <h1 className="font-display text-5xl md:text-6xl lg:text-7xl font-light tracking-tight leading-[1.05] mb-4">
          Your Marketing OS.
        </h1>
        <h2 className="font-display text-2xl md:text-3xl lg:text-4xl font-light tracking-tight leading-tight text-text-3 mb-8">
          Built for the people who&apos;d rather ship.
        </h2>

        <p className="text-base md:text-lg text-text-2 max-w-2xl mx-auto mb-10 leading-relaxed">
          Helm replaces 7 marketing tabs with one workspace. Voice-aware
          drafts, multi-platform publishing, and strategic clarity — all
          in one place.
        </p>

        {!preview ? (
          <form
            onSubmit={handlePreview}
            className="max-w-xl mx-auto"
            aria-label={
              showDescription
                ? 'Generate a brand preview from your description'
                : 'Generate a brand preview from your website'
            }
          >
            {!showDescription ? (
              <>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    // PR #36 — accept either signal. autoComplete
                    // stays url-flavored because most users will
                    // type a domain; inputMode dropped to default
                    // so the on-screen keyboard shows @ on mobile.
                    placeholder="yoursite.com or @yourhandle"
                    disabled={loading}
                    className="flex-1 px-4 py-3 bg-bg-elev border border-border rounded-lg text-base outline-none focus:border-accent disabled:opacity-50 placeholder:text-text-3"
                    autoComplete="off"
                    spellCheck={false}
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
                        See what Helm sees
                      </>
                    )}
                  </button>
                </div>
                <p className="text-xs text-text-3 mt-3">
                  Works with any website or Instagram. Takes 30 seconds.
                </p>
              </>
            ) : (
              <>
                {/* PR #36 Sprint 6.2.3 — description mode. Same
                    card, swapped input. The placeholder IS the
                    teacher: a concrete example beats a generic
                    prompt every time. */}
                <textarea
                  value={description}
                  onChange={(e) =>
                    setDescription(
                      e.target.value.slice(0, DESCRIPTION_MAX_CHARS)
                    )
                  }
                  placeholder={DESCRIPTION_PLACEHOLDER}
                  disabled={loading}
                  rows={5}
                  className="w-full px-4 py-3 bg-bg-elev border border-border rounded-lg text-base outline-none focus:border-accent disabled:opacity-50 placeholder:text-text-3 resize-none leading-relaxed"
                  autoComplete="off"
                  spellCheck
                  autoFocus
                />
                <div className="flex items-center justify-between mt-2 mb-3 text-xs">
                  <button
                    type="button"
                    onClick={switchToUrl}
                    disabled={loading}
                    className="inline-flex items-center gap-1 text-text-3 hover:text-text-1 disabled:opacity-50"
                  >
                    <ArrowLeft className="w-3 h-3" />
                    Back to URL
                  </button>
                  <span
                    className={
                      descriptionReady ? 'text-text-2' : 'text-text-3'
                    }
                  >
                    {descriptionReady
                      ? `${descriptionLen}/${DESCRIPTION_MAX_CHARS}`
                      : `${descriptionLen}/${DESCRIPTION_MIN_CHARS} minimum`}
                  </span>
                </div>
                <button
                  type="submit"
                  disabled={loading || !descriptionReady}
                  className="w-full px-6 py-3 bg-accent text-white rounded-lg font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Reading…
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      See what Helm sees
                    </>
                  )}
                </button>
                <p className="text-xs text-text-3 mt-3">
                  Be specific. Who you help, what you do, who it&apos;s for.
                  Takes about 30 seconds.
                </p>
              </>
            )}

            {error && (
              <div className="mt-4 p-3 bg-danger/10 border border-danger/30 rounded-lg text-sm text-danger text-left">
                <div>{error}</div>
                {/* PR #36 Sprint 6.2.3 — fallback link only shows
                    in URL mode. Once the user is in description
                    mode, an error there is about THEIR text and a
                    "describe instead" link would be circular. */}
                {!showDescription && (
                  <button
                    type="button"
                    onClick={switchToDescription}
                    className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-danger hover:underline"
                  >
                    <Pencil className="w-3 h-3" />
                    Describe your brand manually instead
                  </button>
                )}
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
                {/* PR #36 Sprint 6.2.3 — description previews
                    don't have a URL to display, so the slot
                    becomes a status line instead. */}
                {source === 'description' ? (
                  <div className="text-sm text-accent truncate">
                    Generated from your description
                  </div>
                ) : (
                  <div
                    className="text-sm text-accent truncate"
                    title={scrapedUrl ?? ''}
                  >
                    {scrapedUrl}
                  </div>
                )}
                {/* PR #36 — IG previews are noticeably thinner than
                    website ones (bio + stats only). Tell the user
                    instead of letting them wonder. */}
                {source === 'instagram' && (
                  <div className="text-[10px] text-text-3 mt-1">
                    Read from Instagram bio · limited data
                  </div>
                )}
                {source === 'description' && (
                  <div className="text-[10px] text-text-3 mt-1">
                    No website scraped · based on your text
                  </div>
                )}
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

            {/* PR #36 Sprint 6.2.3 — only website/IG previews can
                pass a URL to /signup for re-scan. Description
                previews don't have a URL; user re-enters context
                during onboarding. */}
            <Link
              href={`/signup${
                scrapedUrl && source !== 'description'
                  ? `?url=${encodeURIComponent(scrapedUrl)}`
                  : ''
              }`}
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
