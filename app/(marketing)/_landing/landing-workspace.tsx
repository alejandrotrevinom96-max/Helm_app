import { GlassCard } from '@/components/ui/glass-card';

interface Feature {
  num: string;
  title: string;
  headline: string;
  body: string;
  tags: string[];
}

const FEATURES: Feature[] = [
  {
    num: '01',
    title: 'Analytics',
    headline: 'See everything that matters',
    body: 'Visitors from Vercel, signups from Supabase, ad spend from Meta — cross-referenced into MRR, CAC, and LTV. Calculated automatically. No spreadsheets.',
    tags: ['vercel', 'supabase', 'meta-ads'],
  },
  {
    num: '02',
    title: 'Marketing',
    headline: 'Brand-aware content that sounds like you',
    body: 'Multi-draft posts scored 0-100 against your brand bible. 12 archetypes, voice spectrum, quote vault. Schedule to Instagram, Facebook, LinkedIn, Threads, and Reddit — each one gets brand-tuned copy. Drift detection alerts when your brand starts wandering.',
    tags: ['brand-bible', 'consistency-score', 'quote-vault'],
  },
  {
    num: '03',
    title: 'Research',
    headline: 'Find pain. Find users.',
    body: 'Scans Reddit, Hacker News, Indie Hackers, and Google Trends for signals matching your niche. Auto-configures sources based on your brand bible. Get pinged when someone describes the problem you solve.',
    tags: ['reddit-api', 'hn-api', 'opus-synthesis'],
  },
  {
    num: '04',
    title: 'Compass',
    headline: 'Score your startup like a VC',
    body: 'Helm analyzes your project across 5 dimensions (Validation, Strategy, Execution, Traction, Market) and scores it 0-100 with specific recommendations on how to improve. Backed by peer-reviewed VC research — not vibes.',
    tags: ['opus-analysis', 'vc-research', 'weak-dim-detection'],
  },
];

export function LandingWorkspace() {
  return (
    <section
      id="features"
      className="max-w-6xl mx-auto px-4 md:px-8 py-20 md:py-24"
    >
      <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-accent mb-3">
        // the workspace
      </div>

      <h2 className="font-display text-3xl md:text-5xl font-light mb-4 max-w-3xl leading-[1.05] tracking-tight">
        Four tabs.
        <br />
        <em className="editorial-italic">One source of truth.</em>
      </h2>

      <p className="text-base md:text-lg text-text-2 max-w-2xl mb-12 md:mb-16 leading-relaxed">
        Helm replaces the chaos of context-switching with a unified workspace
        built around the actual jobs of an indie hacker — including strategy
        scoring backed by VC research.
      </p>

      <div className="space-y-6 md:space-y-8">
        {FEATURES.map((f) => (
          <GlassCard key={f.num} className="p-6 md:p-10">
            <div className="grid md:grid-cols-3 gap-6 md:gap-8 items-start">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
                  {f.num} / {f.title}
                </div>
                <h3 className="font-display text-2xl md:text-3xl font-light leading-tight">
                  {f.headline}
                </h3>
              </div>

              <div className="md:col-span-2">
                <p className="text-text-2 leading-relaxed mb-4">{f.body}</p>
                <div className="flex flex-wrap gap-2">
                  {f.tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-[10px] font-mono px-2 py-1 rounded bg-bg-elev text-text-3 border border-border"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </GlassCard>
        ))}
      </div>
    </section>
  );
}
