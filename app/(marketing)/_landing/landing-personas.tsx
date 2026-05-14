// PR #82 — Sprint 7.7: persona self-identification section.
// PR Sprint 7.19 — landing v3.1 (PRODUCTION): trimmed from 5
// personas to 3 (Solo Founders / Indie Hackers / Bootstrap
// SaaS). Per the brief: "Cut personas from 5 to 3" + sharper
// ICP framing. Agencies/Operators and Content Creators were
// real fits but diluted the core message; they'll come back as
// /use-cases pages when they earn their own copy. New H2 names
// the antagonist ("Buffer wasn't designed for") so the visitor
// understands the wedge.
interface Persona {
  title: string;
  body: string;
}

const PERSONAS: Persona[] = [
  {
    title: 'Solo Founders',
    body: "You'd rather build the next feature than write another LinkedIn post. Helm writes in your voice while you ship.",
  },
  {
    title: 'Indie Hackers',
    body: 'Four projects, two jobs, zero patience for tools that need their own onboarding. Helm sets up in 5 minutes and stays out of your way.',
  },
  {
    title: 'Bootstrap SaaS',
    body: "You're already paying for Buffer, ChatGPT, Notion, and your time. Helm replaces the stack for one bill and learns your brand on day one.",
  },
];

export function LandingPersonas() {
  return (
    <section
      id="who"
      className="py-14 md:py-20 px-4 md:px-8 border-t border-border"
    >
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12 md:mb-16">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-3 mb-3">
            Who it&apos;s for
          </div>
          <h2 className="font-display text-4xl md:text-5xl tracking-tight font-light leading-tight">
            Built for the people Buffer wasn&apos;t designed for.
          </h2>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {PERSONAS.map((p) => (
            <div
              key={p.title}
              className="bg-bg-elev/60 border border-border rounded-2xl p-6"
            >
              <h3 className="font-display text-lg font-light mb-2">
                {p.title}
              </h3>
              <p className="text-sm text-text-2 leading-relaxed">
                {p.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
