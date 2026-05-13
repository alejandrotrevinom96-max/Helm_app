// PR #82 — Sprint 7.7: persona self-identification section.
//
// 5 cards mapped to the 5 segments the v3.0 positioning explicitly
// names: solo founders, indie hackers, agencies/operators,
// bootstrap SaaS, content creators. Job-to-be-done: the visitor
// scans the cards, recognizes themselves in one, and the framing
// flips from "what is this?" to "this is for me".
//
// Layout: 5 cards in a 3-col grid (last row has 2 + a soft spacer
// on lg, single column on mobile). The cost-anchor on "Bootstrap
// SaaS" ($200 + $100 + $50) is intentional — it's the only card
// with a money number because that's the segment where price is
// the decision lever.
interface Persona {
  title: string;
  body: string;
}

const PERSONAS: Persona[] = [
  {
    title: 'Solo Founders',
    body: "You built the product. You'd rather build the next feature than write another LinkedIn post. Helm writes posts in your voice while you ship.",
  },
  {
    title: 'Indie Hackers',
    body: "You're juggling 4 side projects, 2 day jobs, and 0 time for marketing tools that need their own onboarding. Helm onboards in 5 minutes.",
  },
  {
    title: 'Agencies & Operators',
    body: 'Managing marketing for multiple clients or products? Helm isolates each project completely — one workspace, multiple brands, zero confusion.',
  },
  {
    title: 'Bootstrap SaaS',
    body: '$200/mo for Buffer + $100/mo for ChatGPT + $50/mo for Notion + your time. Helm replaces the stack for less than half.',
  },
  {
    title: 'Content Creators',
    body: 'Your voice is your moat. Helm learns it from your past posts, quotes, and feedback — then writes drafts that sound like you, not like AI.',
  },
];

export function LandingPersonas() {
  return (
    <section
      id="who"
      className="py-24 px-4 md:px-8 border-t border-border"
    >
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12 md:mb-16">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-3 mb-3">
            Who it&apos;s for
          </div>
          <h2 className="font-display text-4xl md:text-5xl tracking-tight font-light leading-tight">
            For solo founders, indie hackers, and one-person
            marketing teams.
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
