// PR #82 — Sprint 7.7: 12-feature grid.
// PR Sprint 7.19 — landing v3.1 (PRODUCTION): cut from 12 to 6
// + grouped into two columns ("Create" / "Decide") per the
// production copy spec. Why fewer:
//   - 12 cards turned this section into a feature list nobody
//     reads. 6 lets each one earn attention.
//   - The cut features (Carousel Generator, Reel Scripts,
//     Calendar, Positioning Benchmark, Blind Spots, Decision
//     Log) live on the roadmap section or inside their parent
//     modules; visitors who care reach them on /features later.
//   - Grouping by intent ("Create" = ship content / "Decide" =
//     ship strategy) gives the visitor a mental model in two
//     buckets instead of a flat shelf.
interface Feature {
  title: string;
  body: string;
}

const CREATE_FEATURES: Feature[] = [
  {
    title: 'Brand Bible',
    body: 'Voice, pillars, audience, and positioning. One living document that powers every draft.',
  },
  {
    title: 'Voice Fingerprint',
    body: 'Helm learns from your likes, dislikes, and quotes to write content that sounds like you.',
  },
  {
    title: 'Multi-platform Drafts',
    body: 'One brief, six platform-native outputs. X, LinkedIn, Threads, Instagram, Facebook, Reddit.',
  },
];

const DECIDE_FEATURES: Feature[] = [
  {
    title: 'Priority Matrix',
    body: "Impact × Effort scoring on every strategic move you're considering this quarter.",
  },
  {
    title: 'Audience Research',
    body: 'Reddit and forum mining. Pain points ranked. Direct quotes. One click to turn any insight into a post.',
  },
  {
    title: 'Performance Memory',
    body: 'Tag every post Worked or Flopped. Helm learns what your audience converts on over time.',
  },
];

export function LandingFeatures() {
  return (
    <section
      id="features"
      className="py-14 md:py-20 px-4 md:px-8 border-t border-border"
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

        <div className="space-y-10">
          <FeatureGroup label="Create" features={CREATE_FEATURES} />
          <FeatureGroup label="Decide" features={DECIDE_FEATURES} />
        </div>
      </div>
    </section>
  );
}

function FeatureGroup({
  label,
  features,
}: {
  label: string;
  features: Feature[];
}) {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-accent mb-4">
        {label}
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {features.map((f) => (
          <div
            key={f.title}
            className="bg-bg-elev/60 border border-border rounded-2xl p-5"
          >
            <h3 className="font-display text-base font-light mb-2 text-text-1">
              {f.title}
            </h3>
            <p className="text-sm text-text-2 leading-relaxed">{f.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
