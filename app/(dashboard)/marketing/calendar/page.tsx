// PR #22 shell. Real calendar functionality lands in Sprint 2 — for
// now this is just a "coming soon" placeholder so the sub-tab is
// navigable and users see the roadmap.
export default function CalendarPage() {
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
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        <h2 className="font-display text-2xl font-light mb-2">
          Content Calendar
        </h2>
        <p className="text-text-2 max-w-md mx-auto">
          A unified calendar view of all your scheduled posts across platforms.
          Edit, reschedule, or cancel with a click.
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
              title: 'Visual calendar',
              desc: 'Week and month views of all scheduled posts',
            },
            {
              title: 'Quick edit',
              desc: 'Click any post to edit content, time, or platforms',
            },
            {
              title: 'Smart suggestions',
              desc:
                'Helm suggests optimal posting times based on your audience',
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
