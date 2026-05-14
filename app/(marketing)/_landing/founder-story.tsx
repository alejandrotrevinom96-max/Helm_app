// PR Sprint 7.19 — landing v3.1 (PRODUCTION).
//
// "Why I built this" founder story section. Lands between the
// roadmap (the "built in public" claim) and pricing (the "first
// 50 founders" anchor), so the visitor moves from product →
// transparency → human → commit-or-leave.
//
// Implementation notes:
//   - No real photo asset yet. Renders a circular initial-tile
//     as a placeholder. Swap to an <Image> when a portrait
//     lands in /public.
//   - Signature line uses Alex's actual X handle so curiosity
//     clicks land on the canonical "built in public" feed.

export function FounderStory() {
  return (
    <section
      id="why"
      className="py-14 md:py-20 px-4 md:px-8 border-t border-border"
    >
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-10 md:mb-12">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-3 mb-3">
            Why this exists
          </div>
          <h2 className="font-display text-4xl md:text-5xl tracking-tight font-light">
            Why I built this.
          </h2>
        </div>

        <div className="space-y-5 text-base md:text-lg text-text-2 leading-relaxed">
          <p>
            I&apos;m Alex. Before Helm, I was a solo founder opening 7 tabs
            to publish one tweet.
          </p>
          <p>Every tool was good. Together, they were insane.</p>
          <p>
            Helm is the tool I wanted to exist. I&apos;m building it in
            public. Every commit, every decision, every flop.
          </p>
          <p className="text-text-1 font-medium">
            If you&apos;ve ever opened 7 tabs to ship one post, this is for
            you.
          </p>
        </div>

        {/* Signature line */}
        <div className="mt-10 flex items-center justify-center gap-3">
          <div
            aria-hidden
            className="w-10 h-10 rounded-full bg-[image:var(--accent-grad)] text-white font-display font-medium flex items-center justify-center text-base"
          >
            A
          </div>
          <div className="text-sm">
            <span className="text-text-1 font-medium">Alex</span>
            <span className="text-text-3 mx-2">·</span>
            <a
              href="https://x.com/alex_trev2"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              @alex_trev2
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
