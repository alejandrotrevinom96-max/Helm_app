// PR #82 — Sprint 7.7: 12-feature grid.
//
// Lives after the personas section because the visitor has just
// self-identified — now they want to know the depth. Layout: 4×3
// on desktop (lg), 2-col on tablet, single on mobile. Each card is
// title + one-sentence value, no icons (the section above already
// did the visual punch).
//
// Source: each card maps to a shipped feature in the codebase. If
// a feature is gated behind a future release (HeyGen video,
// per-platform analytics), it does NOT appear here — those live in
// the Roadmap section. Cards lying about shipping status erodes
// trust faster than not listing them at all.
interface Feature {
  title: string;
  body: string;
}

const FEATURES: Feature[] = [
  {
    title: 'Brand Bible',
    body: 'Voice, pillars, audience, and positioning — all in one living document that powers every draft.',
  },
  {
    title: 'Voice Fingerprint',
    body: 'Helm learns from your likes, dislikes, and quotes to write content that sounds like you.',
  },
  {
    title: 'Multi-platform Drafts',
    body: 'Instagram, X, LinkedIn, Threads, Facebook, Reddit. One brief, multiple platform-native outputs.',
  },
  {
    title: 'Carousel Generator',
    body: '5–8 slide carousels with cover, value slides, and CTA. Flux generates images on-demand.',
  },
  {
    title: 'Reel Scripts',
    body: 'Hook + beats + on-screen text. HeyGen video integration coming v3.0.',
  },
  {
    title: 'Calendar & Scheduling',
    body: 'Drag-drop your posts across days. Schedule once, publish forever.',
  },
  {
    title: 'Priority Matrix',
    body: 'Impact × Effort scoring on every strategic move you could make this quarter.',
  },
  {
    title: 'Positioning Benchmark',
    body: 'Auto-scan competitors. Identify market gaps. Find your moat in 30 seconds.',
  },
  {
    title: 'Blind Spots Detector',
    body: '6 frameworks scan credibility, pricing, audience fit, content gaps, social proof, and platform scatter.',
  },
  {
    title: 'Decision Log',
    body: 'Pre-decision alignment scoring. Outcome tracking. Pattern detection across all your strategic moves.',
  },
  {
    title: 'Audience Research',
    body: 'Reddit + forum mining. Pain points ranked by frequency. Direct quotes. One-click "Generate post" from any insight.',
  },
  {
    title: 'Performance Memory',
    body: 'Every post tagged Worked or Flopped. Helm learns what converts for your audience over time.',
  },
];

export function LandingFeatures() {
  return (
    <section
      id="features"
      className="py-24 px-4 md:px-8 border-t border-border"
    >
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12 md:mb-16">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-3 mb-3">
            Everything in one place
          </div>
          <h2 className="font-display text-4xl md:text-5xl tracking-tight font-light">
            Everything in one workspace.
          </h2>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="bg-bg-elev/60 border border-border rounded-2xl p-5"
            >
              <h3 className="font-display text-base font-light mb-2 text-text-1">
                {f.title}
              </h3>
              <p className="text-sm text-text-2 leading-relaxed">
                {f.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
