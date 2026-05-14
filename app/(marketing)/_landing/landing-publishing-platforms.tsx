// PR #82 — Sprint 7.7: publishing platforms grid.
//
// Sits after the 3-pillar solution section. Job-to-be-done: prove
// the "publish everywhere" claim before the reader gets to the
// who-it's-for section. Status badges (Live / Coming) double as
// roadmap honesty — visitors learn upfront which platforms ship
// today vs. v3.0 vs. v3.5, which reduces "is this vaporware?"
// friction.
//
// Source of truth: the platform list mirrors what the
// /api/marketing/library publisher dispatch supports (PR #65/66
// shipped X + LinkedIn; PR #78 staged Threads scopes; the
// remaining four are roadmap). Keep this list in sync with
// lib/meta/publisher.ts when new platforms ship.
const PLATFORMS: {
  name: string;
  status: 'live' | 'coming';
  release?: string;
  description: string;
}[] = [
  {
    name: 'X (Twitter)',
    status: 'live',
    description: 'Auto-publish single tweets and 2–8 tweet threads',
  },
  {
    name: 'LinkedIn',
    status: 'live',
    description: 'Text posts and single-image posts via UGC API',
  },
  {
    name: 'Threads',
    status: 'coming',
    release: 'v3.0',
    description: 'Text + photo posts via Meta Graph API',
  },
  {
    name: 'Reddit',
    status: 'coming',
    release: 'v3.0',
    description: 'Subreddit-aware posting with mod-safe formatting',
  },
  {
    name: 'Instagram',
    status: 'coming',
    release: 'v3.5',
    description: 'Direct publishing via Meta Graph API',
  },
  {
    name: 'Facebook',
    status: 'coming',
    release: 'v3.5',
    description: 'Pages + reels auto-publishing',
  },
];

export function LandingPublishingPlatforms() {
  return (
    <section
      id="publishing-platforms"
      className="py-14 md:py-20 px-4 md:px-8 border-t border-border"
    >
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12 md:mb-16">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-3 mb-3">
            Where you publish
          </div>
          <h2 className="font-display text-4xl md:text-5xl tracking-tight font-light mb-3">
            Publish where your audience lives.
          </h2>
          <p className="text-base md:text-lg text-text-2 max-w-2xl mx-auto">
            Connect once. Helm handles the rest.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {PLATFORMS.map((p) => {
            const isLive = p.status === 'live';
            return (
              <div
                key={p.name}
                className="bg-bg-elev/60 border border-border rounded-2xl p-5 flex flex-col gap-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-display text-lg font-light">
                    {p.name}
                  </h3>
                  <StatusBadge live={isLive} release={p.release} />
                </div>
                <p className="text-sm text-text-2 leading-relaxed">
                  {p.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function StatusBadge({
  live,
  release,
}: {
  live: boolean;
  release?: string;
}) {
  if (live) {
    return (
      <span className="inline-flex items-center gap-1.5 shrink-0 text-[10px] font-mono uppercase tracking-[0.15em] px-2 py-1 rounded bg-emerald-500/15 text-emerald-500 border border-emerald-500/30">
        <span
          className="w-1.5 h-1.5 rounded-full bg-emerald-500"
          aria-hidden
        />
        Live
      </span>
    );
  }
  return (
    <span className="inline-flex items-center shrink-0 text-[10px] font-mono uppercase tracking-[0.15em] px-2 py-1 rounded bg-amber-500/15 text-amber-500 border border-amber-500/30">
      {release ? `Coming ${release}` : 'Coming soon'}
    </span>
  );
}
