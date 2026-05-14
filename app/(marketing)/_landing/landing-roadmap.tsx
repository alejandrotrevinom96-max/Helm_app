// PR #82 — Sprint 7.7: public roadmap section.
//
// 3 columns: Current (v2.x open beta — shipped), v3.0 (next), v3.5
// (after). Job-to-be-done: build trust through transparency. Most
// SaaS hide their roadmap; showing it explicitly:
//   1. Sets expectations (Meta Ads is v3.5, not "any day now")
//   2. Makes "we ship in public" land as evidence, not slogan
//   3. Differentiates from Buffer / Hootsuite et al. which never
//      publish what's coming
//
// Layout: 3 cards side-by-side on desktop, stacked on mobile. The
// Current column gets a subtle emerald accent ("you can use this
// today"), v3.0 amber, v3.5 a neutral text-3 tint to signal
// "further out". The Meta Ads sub-bullets in v3.5 are intentionally
// nested — they show the depth that's coming so visitors don't
// dismiss the column as one line of vapor.
const CURRENT: string[] = [
  'Marketing module (drafts + scheduling)',
  'Research module (audience mining)',
  'Compass module (strategic dashboard)',
  'X publishing',
  'LinkedIn publishing',
  'Brand voice learning',
  'Multi-project isolation',
];

const V30: string[] = [
  'Threads auto-publishing',
  'Reddit auto-publishing',
  'AI video integration',
  'Real PDF LinkedIn carousels',
  'Multi-user team support (basic)',
];

// v3.5 items can have nested sub-bullets when a feature has
// meaningful breadth. Meta Ads earns this because the integration
// is non-trivial — campaigns, budgets, pause/resume, performance.
interface RoadmapItem {
  text: string;
  sub?: string[];
}

const V35: RoadmapItem[] = [
  { text: 'Instagram auto-publishing (Meta)' },
  { text: 'Facebook auto-publishing (Meta)' },
  {
    text: 'Meta Ads Manager integration',
    sub: [
      'Create campaigns',
      'Edit budgets & targeting',
      'Pause/resume campaigns',
      'Performance vs. content cross-reference',
    ],
  },
  { text: 'Per-platform analytics deep-dive' },
  { text: 'Advanced team permissions' },
];

export function LandingRoadmap() {
  return (
    <section
      id="roadmap"
      className="py-14 md:py-20 px-4 md:px-8 border-t border-border"
    >
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12 md:mb-16">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-3 mb-3">
            Roadmap
          </div>
          <h2 className="font-display text-4xl md:text-5xl tracking-tight font-light mb-3">
            Built in public. Shipping in public.
          </h2>
          <p className="text-base md:text-lg text-text-2 max-w-2xl mx-auto">
            Here&apos;s what&apos;s live, what&apos;s next, and what&apos;s
            coming.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          <RoadmapColumn
            release="v2.x"
            status="Live now"
            statusTint="emerald"
            label="Current — open beta"
            items={CURRENT.map((text) => ({ text }))}
            shipped
          />
          <RoadmapColumn
            release="v3.0"
            status="Coming soon"
            statusTint="amber"
            label="Next"
            items={V30.map((text) => ({ text }))}
          />
          <RoadmapColumn
            release="v3.5"
            status="On the roadmap"
            statusTint="neutral"
            label="After"
            items={V35}
          />
        </div>
      </div>
    </section>
  );
}

function RoadmapColumn({
  release,
  status,
  statusTint,
  label,
  items,
  shipped,
}: {
  release: string;
  status: string;
  statusTint: 'emerald' | 'amber' | 'neutral';
  label: string;
  items: RoadmapItem[];
  shipped?: boolean;
}) {
  const tintClass =
    statusTint === 'emerald'
      ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30'
      : statusTint === 'amber'
        ? 'bg-amber-500/15 text-amber-500 border-amber-500/30'
        : 'bg-text-3/15 text-text-3 border-border';

  return (
    <div className="bg-bg-elev/60 border border-border rounded-2xl p-6">
      <div className="mb-5">
        <div className="flex items-baseline gap-2 mb-2 flex-wrap">
          <span className="font-display text-xl font-light">
            {release}
          </span>
          <span
            className={`text-[9px] font-mono uppercase tracking-[0.15em] px-2 py-0.5 rounded border ${tintClass}`}
          >
            {status}
          </span>
        </div>
        <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3">
          {label}
        </div>
      </div>

      <ul className="space-y-2.5">
        {items.map((item) => (
          <li key={item.text} className="text-sm">
            <div className="flex items-start gap-2 text-text-2">
              <span
                className={
                  shipped
                    ? 'text-emerald-500 shrink-0'
                    : 'text-text-3 shrink-0'
                }
                aria-hidden
              >
                {shipped ? '✓' : '○'}
              </span>
              <span>{item.text}</span>
            </div>
            {item.sub && (
              <ul className="mt-1.5 ml-6 space-y-1">
                {item.sub.map((s) => (
                  <li
                    key={s}
                    className="text-xs text-text-3 flex items-start gap-2"
                  >
                    <span className="text-text-3 shrink-0">—</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
