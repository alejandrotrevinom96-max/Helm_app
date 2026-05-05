interface Step {
  num: string;
  title: string;
  body: string;
  duration: string;
}

const STEPS: Step[] = [
  {
    num: '1',
    title: 'Sign in with GitHub',
    body: 'One click. No password. No form to fill out.',
    duration: '~5 seconds',
  },
  {
    num: '2',
    title: 'We scan your repos',
    body: 'Helm reads your vercel.json, package.json, and env files to detect what stack each project uses.',
    duration: '~10 seconds',
  },
  {
    num: '3',
    title: 'Connect Vercel + Supabase + Meta',
    body: 'Three OAuth clicks. We auto-match repos to Vercel projects to Supabase databases. No manual mapping.',
    duration: '~60 seconds',
  },
  {
    num: '4',
    title: 'See your dashboard',
    body: 'Real metrics. Real numbers. Real-time.',
    duration: 'Instant',
  },
];

export function LandingSetup() {
  return (
    <section id="how" className="max-w-6xl mx-auto px-4 md:px-8 py-20 md:py-24">
      <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-accent mb-3">
        // the magic
      </div>

      <h2 className="font-display text-3xl md:text-5xl font-light mb-4 max-w-3xl leading-[1.05] tracking-tight">
        From signup to insights
        <br />
        <em className="editorial-italic">in 90 seconds.</em>
      </h2>

      <p className="text-base md:text-lg text-text-2 max-w-2xl mb-12 md:mb-16 leading-relaxed">
        Most &ldquo;all-in-one&rdquo; tools demand 30 minutes of OAuth dancing.
        We built Helm differently. Connect once with GitHub — we figure out
        the rest.
      </p>

      <div className="grid md:grid-cols-4 gap-6 md:gap-8">
        {STEPS.map((s) => (
          <div key={s.num}>
            <div className="font-display text-5xl text-accent/30 mb-3 leading-none">
              {s.num}
            </div>
            <h4 className="font-medium text-base mb-2">{s.title}</h4>
            <p className="text-sm text-text-2 mb-3 leading-relaxed">{s.body}</p>
            <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3">
              {s.duration}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
