const TABS = [
  { name: 'vercel.com/analytics', color: 'bg-black' },
  { name: 'supabase.com/users', color: 'bg-emerald-700' },
  { name: 'business.meta.com', color: 'bg-blue-700' },
  { name: 'predis.ai/calendar', color: 'bg-purple-700' },
  { name: 'dashboard.stripe.com', color: 'bg-violet-700' },
  { name: 'mail.google.com', color: 'bg-red-700' },
];

export function LandingProblem() {
  return (
    <section
      id="problem"
      className="max-w-6xl mx-auto px-4 md:px-8 py-20 md:py-24"
    >
      <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-accent mb-3">
        // the problem
      </div>

      <h2 className="font-display text-3xl md:text-5xl font-light mb-12 max-w-3xl leading-[1.05] tracking-tight">
        Building is hard.
        <br />
        <span className="text-text-2">
          Watching it grow shouldn&apos;t be.
        </span>
      </h2>

      <div className="grid md:grid-cols-2 gap-12 items-center">
        {/* Scattered tabs visualization. Pure CSS — no images so it
            renders instantly and adapts to theme without asset swaps. */}
        <div className="relative h-72 md:h-80">
          {TABS.map((tab, i) => (
            <div
              key={tab.name}
              className={`absolute px-3 py-1.5 ${tab.color} text-white text-xs rounded font-mono shadow-lg whitespace-nowrap`}
              style={{
                top: `${(i * 50) % 240}px`,
                left: `${(i * 60) % 180}px`,
                transform: `rotate(${(i % 2 === 0 ? -1 : 1) * (3 + i)}deg)`,
              }}
            >
              {tab.name}
            </div>
          ))}
        </div>

        <div>
          <h3 className="font-display text-2xl md:text-3xl font-light mb-4">
            7 tabs open.
            <br />
            <span className="text-text-3">Zero clarity.</span>
          </h3>
          <p className="text-text-2 leading-relaxed">
            The average indie hacker burns{' '}
            <strong className="text-text-1">2.4 hours per week</strong> just
            switching between tools. That&apos;s 125 hours a year you
            could&apos;ve spent shipping features, talking to users, or — wild
            idea — sleeping.
          </p>
        </div>
      </div>
    </section>
  );
}
