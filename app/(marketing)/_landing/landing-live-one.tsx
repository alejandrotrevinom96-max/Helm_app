// PR Sprint 7.25 Phase 7 — landing redesign ("The Live One").
//
// Replaces the 14-section v3.1 landing (LandingHero + LandingProblem
// + LandingFeatures + ...) with a tighter 5-section design that
// matches the platform redesign visual language:
//
//   1. Hero — eyebrow pill, Instrument Serif italic gradient h1
//      with embedded compass, lead, primary + ghost CTA, ticker.
//   2. #live — "While you read this, Helm is reading the internet"
//      side-by-side live feed + audience map, plus a 4-tile counter
//      row beneath it.
//   3. #demo — a terminal-style "type a URL" demo strip.
//   4. #three — three-pillar showcase (Marketing / Research /
//      Strategy) with per-color glow + channel-logos scrolling band.
//   5. #pricing — concentric-ring CTA band with progress bar
//      sourced from getSpotsCount.
//   + Footer columns.
//
// The old _landing components stay on disk (LandingHero,
// LandingFeatures, etc.) but no caller imports them — a revert PR
// just swaps the import in app/(marketing)/page.tsx back to
// `./landing-page`.
//
// AmbientBackground wraps the whole page so the deep-navy canvas
// + radial gradient bloom + dot-grid + cursor-glow lay underneath
// every section. The component pins data-theme='dark' on its root
// even though the global theme is now dark-only (Phase 7 fix);
// keeps the visual identical if a future toggle returns.
import Link from 'next/link';
import { AmbientBackground } from '@/components/ui/ambient-background';
import { getSpotsCount, LIFETIME_SPOT_TOTAL } from './spots-count';
import { DemoUrlForm } from './demo-url-form';

const TICKER_ITEMS: Array<{
  src: 'reddit' | 'hn' | 'ih' | 'x';
  label: string;
  text: string;
}> = [
  { src: 'reddit', label: 'r/ecommerce', text: "the onboarding is fine, the problem is I don't know what to post first." },
  { src: 'hn', label: 'show hn', text: 'Customers keep telling me my landing page is "vague but cool." Need to be less vague.' },
  { src: 'ih', label: 'milestones', text: 'Hit $4k MRR. People love the product but I have no idea how to talk about it.' },
  { src: 'reddit', label: 'r/Entrepreneur', text: 'Anyone else finds writing the captions harder than building the entire app?' },
  { src: 'x', label: '@founder', text: 'Day 41 of trying to write a tweet about my product without sounding like a LinkedIn ghoul.' },
  { src: 'reddit', label: 'r/marketing', text: 'For B2C: do you actually post at the "optimal time" or whenever you have content ready?' },
  { src: 'hn', label: 'comments', text: 'I think most indie hackers should spend 80% on distribution. Most spend 0%.' },
  { src: 'ih', label: 'forum', text: 'How do you not sound like every other AI tool when describing your AI tool?' },
];

const FEED_ROWS: Array<{
  src: 'reddit' | 'hn' | 'ih' | 'x';
  chip: string;
  label: string;
  quote: string;
  tags: string[];
  when: string;
}> = [
  { src: 'reddit', chip: 'RD', label: 'r/ecommerce', quote: "the onboarding is fine, the problem is I don't know what to post first.", tags: ['#cadence', '#voice'], when: '4m' },
  { src: 'hn', chip: 'HN', label: 'show hn', quote: 'Customers keep telling me my landing page is "vague but cool." Need to be less vague.', tags: ['#positioning'], when: '11m' },
  { src: 'ih', chip: 'IH', label: 'milestones', quote: 'Hit $4k MRR. People love the product but I have no idea how to talk about it.', tags: ['#voice', '#audience'], when: '23m' },
  { src: 'reddit', chip: 'RD', label: 'r/Entrepreneur', quote: 'Anyone else finds writing the captions harder than building the entire app?', tags: ['#cadence'], when: '38m' },
  { src: 'x', chip: 'X', label: '@founder', quote: 'Day 41 of trying to write a tweet about my product without sounding like a LinkedIn ghoul.', tags: ['#voice'], when: '1h' },
];

const CHANNELS: Array<[string, string]> = [
  ['IG', 'writes for Instagram'],
  ['FB', 'writes for Facebook'],
  ['IN', 'writes for LinkedIn'],
  ['@', 'writes for Threads'],
  ['RD', 'writes for Reddit'],
  ['X', 'writes for X'],
  ['TT', 'writes for TikTok'],
];

// SVG of the brand compass — embedded inline so we don't ship a
// dependency on a separate file for a 7-line vector.
function CompassSvg({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden
    >
      <circle cx="16" cy="16" r="11.2" stroke="#F5F7FF" strokeWidth="1.8" />
      <circle cx="16" cy="16" r="3.2" fill="#F97316" />
      <path
        d="M16 1.6V8.4 M16 23.6V30.4 M1.6 16H8.4 M23.6 16H30.4 M6 6L10.7 10.7 M21.3 21.3L26 26 M26 6L21.3 10.7 M10.7 21.3L6 26"
        stroke="#F5F7FF"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ArrowSvg() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3 8h10M9 4l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TickSvg() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 12.5l4.5 4.5L19 7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Procedurally-generated dot map for the audience panel. Same
// pattern as the mockup (160 dots in a 4:3 grid stepping with a
// prime offset so the rows look organic) without the 290 hand-typed
// <circle> tags.
function DotMap() {
  const dots: Array<{ cx: number; cy: number }> = [];
  for (let i = 0; i < 220; i++) {
    const cx = (i * 47) % 800;
    const cy = ((i * 31) % 360) + 40;
    dots.push({ cx, cy });
  }
  return (
    <svg viewBox="0 0 800 450" preserveAspectRatio="xMidYMid meet" aria-hidden>
      <g fill="rgba(255, 255, 255, 0.1)">
        {dots.map((d, i) => (
          <circle key={i} cx={d.cx} cy={d.cy} r="1.4" />
        ))}
      </g>
    </svg>
  );
}

export async function LandingLiveOne() {
  const { claimed, left } = await getSpotsCount();
  // Render the doubled track so the keyframe -50% scroll seamlessly
  // wraps. Each child is rendered twice — once visible, once for the
  // wrap continuation.
  const tickerDoubled = [...TICKER_ITEMS, ...TICKER_ITEMS];
  const channelsDoubled = [...CHANNELS, ...CHANNELS, ...CHANNELS];

  return (
    <AmbientBackground accentTint="default">
      {/* Sticky nav */}
      <div className="landing-nav-wrap">
        <nav className="landing-nav">
          <Link href="/" className="landing-nav-brand">
            <span className="wheel">
              <CompassSvg size={26} />
            </span>
            <span className="name">Helm</span>
            <span className="live-dot">
              live · {claimed} in
            </span>
          </Link>
          <div className="landing-nav-links">
            <a href="#live">Live</a>
            <a href="#demo">Demo</a>
            <a href="#three">What</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQ</a>
          </div>
          <Link href="/signup" className="landing-nav-cta">
            Start free <ArrowSvg />
          </Link>
        </nav>
      </div>

      {/* Hero */}
      <section className="landing-hero">
        <div className="landing-hero-eyebrow">
          <span className="dot">{claimed}</span>
          <span>
            {claimed === 0
              ? `Pre-launch · the first ${LIFETIME_SPOT_TOTAL} founders lock in free`
              : `${claimed} founders joined · the first ${LIFETIME_SPOT_TOTAL} are free`}
          </span>
        </div>
        <h1>
          <span className="line">
            <span className="grad">Marketing that</span>
          </span>
          <span className="line">
            <em>
              steers
              <span className="compass" aria-hidden>
                <CompassSvg size={56} />
              </span>
              itself.
            </em>
          </span>
        </h1>
        <p className="lead">
          Paste your URL. Helm reads your brand, watches where your audience
          actually complains, writes posts that sound like you, and tells you
          which strategy gap to close first. Three tools. One surface.
          Marketing on autopilot — kind of.
        </p>
        <div className="landing-hero-ctas">
          <Link href="/signup" className="landing-btn landing-btn-primary">
            Start free in 30s <ArrowSvg />
          </Link>
          <a href="#demo" className="landing-btn landing-btn-ghost">
            See it work →
          </a>
        </div>
        <div className="landing-hero-undersig">
          no_card_needed · works_from_any_URL · <b>open_in_30s</b>
        </div>
      </section>

      {/* Ticker — listening now */}
      <div className="landing-ticker" aria-label="Conversations Helm is listening to">
        <span className="label">Listening now</span>
        <div className="landing-ticker-track">
          {tickerDoubled.map((item, i) => (
            <span key={i} className="landing-ticker-item">
              <span className={`landing-ticker-src landing-ticker-src-${item.src}`}>
                {item.label}
              </span>
              <span>{item.text}</span>
            </span>
          ))}
        </div>
      </div>

      {/* #live — research listening */}
      <section id="live" className="landing-section">
        <div className="landing-section-head">
          <span className="landing-eyebrow">live · research</span>
          <h2 className="landing-h2">
            While you read this,{' '}
            <span className="accent-green">Helm is reading the internet</span>{' '}
            for you.
          </h2>
          <p className="landing-intro">
            Reddit at 2am, Hacker News threads, Indie Hackers milestones, X
            founders. Real complaints from the rooms your customers actually
            sit in — not a keyword tool. The feed below auto-refreshes as new
            posts come in.
          </p>
        </div>

        <div className="landing-live-grid">
          <div className="landing-live-panel">
            <div className="landing-live-panel-head">
              <span className="dots">
                <i />
                <i />
                <i />
              </span>
              <span className="ttl">helm · research · listening</span>
              <span style={{ color: 'var(--text-3)' }}>reddit · hn · ih · x</span>
              <span className="live-tag">LIVE</span>
            </div>
            <div className="landing-feed">
              {FEED_ROWS.map((row, i) => (
                <div key={i} className={`landing-feed-row ${row.src}`}>
                  <div className="src-chip">{row.chip}</div>
                  <div>
                    <div className="quote">&ldquo;{row.quote}&rdquo;</div>
                    <div className="meta">
                      <span>
                        <b>{row.label}</b>
                      </span>
                      {row.tags.map((t) => (
                        <span key={t}>{t}</span>
                      ))}
                    </div>
                  </div>
                  <div className="when">{row.when}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="landing-live-panel landing-audience">
            <h3>Where your people actually hang out.</h3>
            <div className="sub">
              Helm pulls live conversation from the places that match your
              audience — not a keyword tool.
            </div>
            <div className="map">
              <DotMap />
              <div className="ping ping-1" />
              <div className="ping ping-2" />
              <div className="ping ping-3" />
              <div className="ping ping-4" />
            </div>
            <div className="landing-audience-legend">
              <div className="li reddit">
                <i />
                r/ecommerce · 24 threads watched
              </div>
              <div className="li hn">
                <i />
                HN · 6 active discussions
              </div>
              <div className="li ih">
                <i />
                Indie Hackers · 12 builders
              </div>
              <div className="li x">
                <i />X · 38 voices in your niche
              </div>
            </div>
          </div>
        </div>

        <div className="landing-counter-row">
          <div className="landing-counter-tile">
            <div className="num">
              {claimed}
              <span className="suffix">/{LIFETIME_SPOT_TOTAL}</span>
            </div>
            <div className="lbl">founders joined</div>
          </div>
          <div className="landing-counter-tile">
            <div className="num">8</div>
            <div className="lbl">strategy dimensions reviewed</div>
          </div>
          <div className="landing-counter-tile">
            <div className="num">7</div>
            <div className="lbl">channels covered out of the box</div>
          </div>
          <div className="landing-counter-tile">
            <div className="num">
              12<span className="suffix">s</span>
            </div>
            <div className="lbl">avg time from URL to brand bible</div>
          </div>
        </div>
      </section>

      {/* #demo */}
      <section id="demo" className="landing-section">
        <div className="landing-section-head">
          <span className="landing-eyebrow">interactive · 12 seconds</span>
          <h2 className="landing-h2">
            Type a URL.{' '}
            <span className="accent">Watch your brand bible write itself.</span>
          </h2>
          <p className="landing-intro">
            No upload, no setup, no sales call. Helm reads the public surface
            of your brand — site, products, photos — and produces a working
            bible in twelve seconds.
          </p>
        </div>
        <div className="landing-demo">
          {/* PR Sprint 7.25 Phase 8 — replaced the static
              terminal placeholder with a real controlled input.
              Submitting hands the URL to /signup?url=<encoded>
              and the existing signup → onboarding flow auto-
              fires the brand-bible builder once the email is
              confirmed (see app/(auth)/signup/page.tsx, key
              `helm:pendingBrandUrl`). */}
          <DemoUrlForm />
        </div>
      </section>

      {/* #three — pillars */}
      <section id="three" className="landing-section">
        <div className="landing-section-head">
          <span className="landing-eyebrow">what&apos;s inside</span>
          <h2 className="landing-h2">
            Three tools that <span className="accent-fire">compound</span>.
          </h2>
          <p className="landing-intro">
            Most marketing software is a scheduler with a chatbot on top.
            Helm is the other direction — research and strategy first, posts
            as the output.
          </p>
        </div>

        <div className="landing-pillars">
          <div className="landing-pillar landing-pillar-marketing">
            <div className="landing-pillar-num">01 / Marketing</div>
            <div className="landing-pillar-icon" aria-hidden>
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 20h9M4 20l1-4 11-11 3 3-11 11-4 1z" />
              </svg>
            </div>
            <h3>Stop staring at the empty caption box.</h3>
            <p>
              Helm reads your site, learns how you actually sound, then drafts
              3 angles per platform. You review, tap, share.
            </p>
            <ul>
              <li>
                <span className="tick">
                  <TickSvg />
                </span>
                Reads your brand from a URL or Instagram
              </li>
              <li>
                <span className="tick">
                  <TickSvg />
                </span>
                Writes for IG, FB, LinkedIn, Threads, X, Reddit
              </li>
              <li>
                <span className="tick">
                  <TickSvg />
                </span>
                Calendar shows your audience&apos;s real golden times
              </li>
              <li>
                <span className="tick">
                  <TickSvg />
                </span>
                One tap to share, anywhere
              </li>
            </ul>
          </div>

          <div className="landing-pillar landing-pillar-research">
            <div className="landing-pillar-num">02 / Research</div>
            <div className="landing-pillar-icon" aria-hidden>
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M19.07 4.93A10 10 0 1 0 22 12" />
                <path d="M16.24 7.76A6 6 0 1 0 18 12" />
                <path d="M12 12L22 2" />
              </svg>
            </div>
            <h3>Read where your customers actually complain.</h3>
            <p>
              Live posts from Reddit, HN, Indie Hackers, product forums and
              Google Trends — surfaced as quotes you can answer or write back
              to.
            </p>
            <ul>
              <li>
                <span className="tick">
                  <TickSvg />
                </span>
                Pulls live posts from Reddit, HN, IH
              </li>
              <li>
                <span className="tick">
                  <TickSvg />
                </span>
                Tracks Google Trends for your topic
              </li>
              <li>
                <span className="tick">
                  <TickSvg />
                </span>
                Builds an audience profile from real talk
              </li>
              <li>
                <span className="tick">
                  <TickSvg />
                </span>
                Saves what matters for later
              </li>
            </ul>
          </div>

          <div className="landing-pillar landing-pillar-strategy">
            <div className="landing-pillar-num">03 / Strategy</div>
            <div className="landing-pillar-icon" aria-hidden>
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M15.5 8.5l-2 5-5 2 2-5 5-2z" />
              </svg>
            </div>
            <h3>Spot the gap before you waste a quarter.</h3>
            <p>
              Helm reviews what you already have across 8 dimensions, flags
              weak spots, and tells you the next thing worth working on.
            </p>
            <ul>
              <li>
                <span className="tick">
                  <TickSvg />
                </span>
                Reviews positioning, voice, cadence, distribution
              </li>
              <li>
                <span className="tick">
                  <TickSvg />
                </span>
                Flags the weak spots most founders miss
              </li>
              <li>
                <span className="tick">
                  <TickSvg />
                </span>
                Compares you to actual competitors
              </li>
              <li>
                <span className="tick">
                  <TickSvg />
                </span>
                Tells you the next thing worth working on
              </li>
            </ul>
          </div>
        </div>

        <div className="landing-channels-band">
          <div className="landing-channels-track">
            {channelsDoubled.map(([glyph, label], i) => (
              <span key={i} className="landing-channel">
                <span className="glyph">{glyph}</span>
                <span>{label}</span>
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* #pricing */}
      <section id="pricing" className="landing-section">
        <div className="landing-cta-band">
          <div className="ring ring-1" aria-hidden />
          <div className="ring ring-2" aria-hidden />
          <div className="ring ring-3" aria-hidden />
          <span className="landing-eyebrow">pricing · early</span>
          <h2 className="landing-h2">
            <span className="accent">Free</span>
            <br />
            for the next {left} founders.
          </h2>
          <p className="landing-intro">
            We just launched. The first {LIFETIME_SPOT_TOTAL} founders get
            full access while we ship rough edges. Pricing arrives once Helm
            is obviously worth paying for. No card today.
          </p>
          <div className="landing-hero-ctas" style={{ marginTop: '28px' }}>
            <Link href="/signup" className="landing-btn landing-btn-primary">
              Claim your spot <ArrowSvg />
            </Link>
            <a href="#three" className="landing-btn landing-btn-ghost">
              Read the manifesto
            </a>
          </div>
          <div className="progress">
            <span>
              {claimed} / {LIFETIME_SPOT_TOTAL} spots
            </span>
            <div className="bar">
              <div
                style={{
                  width: `${Math.round((claimed / LIFETIME_SPOT_TOTAL) * 100)}%`,
                }}
              />
            </div>
            <span>{left} left</span>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <div className="landing-footer-grid">
            <div>
              <div className="landing-footer-brand">
                <CompassSvg size={22} />
                <span>Helm</span>
              </div>
              <p className="landing-footer-tag">
                The marketing OS for people who built the product first.
                Live, listening, writing — while you ship.
              </p>
            </div>
            <div>
              <h5>Product</h5>
              <ul>
                <li>
                  <a href="#three">Marketing</a>
                </li>
                <li>
                  <a href="#live">Research</a>
                </li>
                <li>
                  <a href="#three">Strategy</a>
                </li>
                <li>
                  <Link href="/signup">Brand bibles</Link>
                </li>
              </ul>
            </div>
            <div>
              <h5>Company</h5>
              <ul>
                <li>
                  <Link href="/blog">Manifesto</Link>
                </li>
                <li>
                  <Link href="/blog">Changelog</Link>
                </li>
                <li>
                  <a href="#pricing">Roadmap</a>
                </li>
                <li>
                  <Link href="/signup">Contact</Link>
                </li>
              </ul>
            </div>
            <div>
              <h5>Legal</h5>
              <ul>
                <li>
                  <Link href="/privacy">Privacy</Link>
                </li>
                <li>
                  <Link href="/terms">Terms</Link>
                </li>
                <li>
                  <Link href="/security">Security</Link>
                </li>
              </ul>
            </div>
          </div>
          <div className="landing-footer-bottom">
            <span>© Helm 2026 · trythelm.com</span>
            <span>live · listening · {new Date().toISOString().slice(0, 10)}</span>
          </div>
        </div>
      </footer>
    </AmbientBackground>
  );
}
