import Link from 'next/link';
import { ThemeToggle } from '@/components/ui/theme-toggle';

export default function LandingPage() {
  return (
    <div className="min-h-screen relative overflow-hidden">
      <div
        aria-hidden
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-accent-glow blur-[120px] opacity-30 -z-10 pointer-events-none"
      />

      <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-glass bg-bg/70 border-b border-border">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2.5">
            <svg viewBox="0 0 32 32" className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <circle cx="16" cy="16" r="14" />
              <circle cx="16" cy="16" r="3" fill="var(--accent)" stroke="none" />
              <line x1="16" y1="2" x2="16" y2="8" />
              <line x1="16" y1="24" x2="16" y2="30" />
              <line x1="2" y1="16" x2="8" y2="16" />
              <line x1="24" y1="16" x2="30" y2="16" />
            </svg>
            <span className="font-display text-xl font-medium">Helm</span>
          </div>
          <div className="flex items-center gap-4">
            <ThemeToggle />
            <Link
              href="/login"
              className="bg-[image:var(--accent-grad)] text-white px-5 py-2 rounded-lg text-sm font-medium transition-transform hover:-translate-y-0.5"
            >
              Sign in →
            </Link>
          </div>
        </div>
      </nav>

      <section className="pt-32 md:pt-40 pb-24 md:pb-32 px-4 md:px-8 max-w-6xl mx-auto">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 glass rounded-full mb-8 text-sm text-text-2">
          <span className="w-1.5 h-1.5 rounded-full bg-success animate-[pulse-dot_2s_ease-in-out_infinite]" />
          Now in private beta · Early access for indie hackers
        </div>

        <h1 className="font-display text-display-xl font-light leading-[0.95] tracking-tight mb-8 max-w-5xl">
          The command center<br />
          for indie hackers <em className="editorial-italic">who ship.</em>
        </h1>

        <p className="text-lg md:text-xl text-text-2 max-w-2xl mb-10 md:mb-12 leading-relaxed">
          Stop juggling Vercel, Supabase, Meta Ads, and 7 other tabs. Helm pulls every signal
          from your micro-SaaS into one dashboard — analytics, marketing, research, validation.
          Connect with GitHub, see results in 90 seconds.
        </p>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/login"
            className="bg-[image:var(--accent-grad)] text-white px-7 py-3 rounded-lg font-medium inline-flex items-center gap-2 shadow-editorial hover:shadow-editorial-lg hover:-translate-y-0.5 transition-all"
          >
            Get started free
            <span>→</span>
          </Link>
          <Link
            href="/login"
            className="text-text-2 hover:text-text-1 hover:bg-surface-1 px-7 py-3 rounded-lg font-medium inline-flex items-center gap-2 transition-colors"
          >
            Sign in
          </Link>
        </div>
      </section>
    </div>
  );
}
