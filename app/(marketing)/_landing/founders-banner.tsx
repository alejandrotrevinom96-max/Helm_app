// PR Sprint 7.19 — landing v3.1 (PRODUCTION).
//
// Top banner that sits above the nav with the scarcity hook:
//
//   "Free during beta. The first 50 founders lock in lifetime
//   pricing."
//
// Server component (no interactivity). Renders on every page
// load so the scarcity signal is the FIRST thing a visitor sees,
// not buried in the hero or pricing section.

export function FoundersBanner() {
  return (
    <div className="bg-accent/8 border-b border-accent/20 px-4 py-2 text-center">
      <p className="text-xs md:text-sm text-text-2 max-w-3xl mx-auto leading-relaxed">
        Free during beta.{' '}
        <span className="text-text-1 font-medium">
          The first 50 founders lock in lifetime pricing.
        </span>
      </p>
    </div>
  );
}
