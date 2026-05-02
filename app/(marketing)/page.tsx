import Link from 'next/link';

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-xl bg-bg/70 border-b border-border">
        <div className="max-w-6xl mx-auto px-8 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2.5">
            <svg viewBox="0 0 32 32" className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <circle cx="16" cy="16" r="14"/>
              <circle cx="16" cy="16" r="3" fill="#ff6b35" stroke="none"/>
              <line x1="16" y1="2" x2="16" y2="8"/>
              <line x1="16" y1="24" x2="16" y2="30"/>
              <line x1="2" y1="16" x2="8" y2="16"/>
              <line x1="24" y1="16" x2="30" y2="16"/>
            </svg>
            <span className="font-display text-xl font-medium">Helm</span>
          </div>
          <Link href="/login" className="bg-accent text-bg px-5 py-2 rounded-lg text-sm font-medium">
            Sign in →
          </Link>
        </div>
      </nav>

      <section className="pt-40 pb-32 px-8 max-w-6xl mx-auto">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 border border-border-bright rounded-full bg-bg-elev mb-8 text-sm text-text-dim">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          Now in private beta · Early access for indie hackers
        </div>

        <h1 className="font-display text-6xl md:text-8xl font-normal leading-[0.95] tracking-tight mb-8 max-w-4xl">
          The command center<br />
          for indie hackers <em className="text-accent italic font-light">who ship.</em>
        </h1>

        <p className="text-xl text-text-dim max-w-2xl mb-12 leading-relaxed">
          Stop juggling Vercel, Supabase, Meta Ads, and 7 other tabs. Helm pulls every signal
          from your micro-SaaS into one dashboard — analytics, marketing, research, validation.
          Connect with GitHub, see results in 90 seconds.
        </p>

        <div className="flex gap-3">
          <Link href="/login" className="bg-accent text-bg px-6 py-3 rounded-lg font-medium inline-flex items-center gap-2">
            Get started free
            <span>→</span>
          </Link>
        </div>
      </section>
    </div>
  );
}
