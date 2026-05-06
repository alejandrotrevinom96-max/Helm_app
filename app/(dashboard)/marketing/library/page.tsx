// PR #22 shell. Library = browsable archive of every published post
// with performance ratings, clone, etc. Lands in Sprint 2 alongside
// the Calendar tab.
export default function LibraryPage() {
  return (
    <div className="space-y-8">
      <div className="p-12 border border-dashed border-border rounded-xl text-center">
        <svg
          viewBox="0 0 24 24"
          className="w-12 h-12 text-accent mx-auto mb-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path d="M21 8v13H3V8" />
          <rect x="1" y="3" width="22" height="5" rx="1" />
          <line x1="10" y1="12" x2="14" y2="12" />
        </svg>
        <h2 className="font-display text-2xl font-light mb-2">
          Content Library
        </h2>
        <p className="text-text-2 max-w-md mx-auto">
          Every post you&apos;ve published, organized by project, with
          performance stats and the ability to clone what worked.
        </p>
        <div className="mt-6 inline-flex items-center gap-2 px-3 py-1.5 bg-bg-elev rounded-md">
          <span className="w-2 h-2 bg-accent rounded-full animate-[pulse-dot_2s_ease-in-out_infinite]" />
          <span className="text-xs font-mono uppercase tracking-[0.1em] text-text-2">
            Coming in next sprint
          </span>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3">
          What&apos;s coming
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              title: 'All your posts',
              desc: 'Filter by project, platform, status, or date range',
            },
            {
              title: 'Performance memory',
              desc: 'See which posts worked and learn patterns',
            },
            {
              title: 'Clone & remix',
              desc: 'Duplicate winning posts and adapt for new context',
            },
          ].map((feature) => (
            <div
              key={feature.title}
              className="p-4 border border-border rounded-lg"
            >
              <h4 className="font-medium text-sm mb-1">{feature.title}</h4>
              <p className="text-xs text-text-3">{feature.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
