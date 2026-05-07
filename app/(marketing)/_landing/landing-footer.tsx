import Link from 'next/link';

export function LandingFooter() {
  return (
    <>
      <section
        id="pricing"
        className="max-w-6xl mx-auto px-4 md:px-8 py-24 md:py-32 text-center"
      >
        <h2 className="font-display text-4xl md:text-6xl font-light mb-6 leading-tight tracking-tight">
          Stop switching.
          <br />
          <em className="editorial-italic">Start shipping.</em>
        </h2>

        <p className="text-base md:text-lg text-text-2 max-w-xl mx-auto mb-10 leading-relaxed">
          Helm v1.0 is live. Free for the first 20 founders. Pricing TBD
          after real-world feedback.
        </p>

        <Link
          href="/login"
          className="inline-flex items-center gap-2 bg-[image:var(--accent-grad)] text-white px-8 py-4 rounded-lg font-medium text-base md:text-lg shadow-editorial hover:shadow-editorial-lg hover:-translate-y-0.5 transition-all"
        >
          Get early access
          <span>→</span>
        </Link>
      </section>

      <footer className="border-t border-border">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-8 md:py-12 flex flex-wrap justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="font-display text-xl font-medium">Helm</span>
            <span className="text-xs text-text-3">© 2026</span>
          </div>

          <div className="flex flex-wrap gap-4 md:gap-6 text-sm text-text-3">
            <a href="#features" className="hover:text-text-1">
              Features
            </a>
            <a href="#how" className="hover:text-text-1">
              How it works
            </a>
            {/* PR #29 — required by Meta App Review (Privacy Policy +
                Terms of Service URLs surfaced from a public page). */}
            <Link href="/privacy" className="hover:text-text-1">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-text-1">
              Terms
            </Link>
            <Link href="/login" className="hover:text-text-1">
              Sign in
            </Link>
          </div>

          <div className="text-xs text-text-3">
            Built by indie hackers, for indie hackers.
          </div>
        </div>
      </footer>
    </>
  );
}
