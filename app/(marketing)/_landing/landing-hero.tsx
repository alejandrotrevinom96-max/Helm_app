import Link from 'next/link';

export function LandingHero() {
  return (
    <section className="pt-32 md:pt-40 pb-24 md:pb-32 px-4 md:px-8 max-w-6xl mx-auto relative">
      <div
        aria-hidden
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-accent-glow blur-[120px] opacity-30 -z-10 pointer-events-none"
      />

      {/* Status pill — pulsing green dot signals "live", not "coming soon" */}
      <div className="inline-flex items-center gap-2 px-3 py-1.5 glass rounded-full mb-8 text-sm text-text-2">
        <span className="w-1.5 h-1.5 rounded-full bg-success animate-[pulse-dot_2s_ease-in-out_infinite]" />
        Now live · v1.0 · Free for first 20 founders
      </div>

      <h1 className="font-display text-display-xl font-light leading-[0.95] tracking-tight mb-8 max-w-5xl">
        The command center<br />
        for indie hackers <em className="editorial-italic">who ship.</em>
      </h1>

      <p className="text-lg md:text-xl text-text-2 max-w-2xl mb-10 md:mb-12 leading-relaxed">
        Stop juggling Vercel, Supabase, Meta Ads, and 7 other tabs. Helm pulls every signal
        from your micro-SaaS into one dashboard — analytics, marketing, research, validation,
        and strategy scoring. Connect with GitHub, see results in 90 seconds.
      </p>

      <div className="flex flex-wrap gap-3 mb-12">
        <Link
          href="/login"
          className="bg-[image:var(--accent-grad)] text-white px-7 py-3 rounded-lg font-medium inline-flex items-center gap-2 shadow-editorial hover:shadow-editorial-lg hover:-translate-y-0.5 transition-all"
        >
          Get early access
          <span>→</span>
        </Link>
        <a
          href="#how"
          className="text-text-2 hover:text-text-1 hover:bg-surface-1 px-7 py-3 rounded-lg font-medium inline-flex items-center gap-2 transition-colors"
        >
          How it works
        </a>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-text-3 font-mono uppercase tracking-[0.1em]">
        <span>⊘ Privacy-first</span>
        <span>✦ 90-second setup</span>
        <span>○ Built by indie hackers</span>
      </div>
    </section>
  );
}
