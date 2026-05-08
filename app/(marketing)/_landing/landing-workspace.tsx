// PR #34 — Sprint 6.2: replaced the v1 features-card grid with a
// linear "How it works" timeline. Same file path so the route
// group keeps its existing structure; the export is renamed to
// LandingHowItWorks and aliased as LandingWorkspace for back-compat.
//
// PR #38 — Sprint 6.4: step 4 reframed. Pre-PR-38 we promised
// "Helm publishes when scheduled" — that hinges on Meta App
// Review (blocked). New copy: "Schedule or share now — 1 tap to
// Instagram, Facebook, anywhere." with the V3 auto-post promise
// kept as a teaser so early adopters know what's coming.

interface Step {
  number: string;
  title: string;
  description: string;
}

// PR #41 — Sprint 6.6: step rewrite. Out: 4 em-dashes, "AI extracts"
// AI-talk, "From X to Y in minutes" cliché. In: imperative voice
// in step titles, plain prose in descriptions, parens where the
// em-dashes used to gloss, honest about Meta App Review as a
// blocker on step 04 (versus the previous "auto-post coming in
// V3" hand-wave).
const STEPS: Step[] = [
  {
    number: '01',
    title: 'Paste your website',
    description:
      "Or your Instagram handle. Helm reads what's there. You saw the preview already, that's the actual product.",
  },
  {
    number: '02',
    title: 'Get your brand bible',
    description:
      "Helm pulls your archetype, voice, content pillars, and audience into one document. We also generate 12 images so you can verify the visual direction matches what you had in mind. Edit anything that's off. Save it.",
  },
  {
    number: '03',
    title: "Write posts that don't sound generic",
    description:
      'Type what you want to talk about. Helm writes 3 drafts for each platform you pick (Instagram, Facebook, LinkedIn, Threads, Reddit), each leaning into a different angle of your brand. Pick the one that lands.',
  },
  {
    number: '04',
    title: 'Schedule or share',
    description:
      "Drop drafts on the calendar at your audience's golden times, or tap share and post wherever you want. Native auto-post to Meta ships in v3 (we're waiting on Meta's review).",
  },
];

function LandingHowItWorks() {
  return (
    <section
      id="how-it-works"
      className="py-24 px-4 md:px-8 border-t border-border bg-bg-elev/30"
    >
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-12 md:mb-16">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-3 mb-3">
            How it works
          </div>
          <h2 className="font-display text-4xl md:text-5xl tracking-tight font-light leading-tight">
            Four steps. No sales call.
          </h2>
        </div>

        {/* hairline-separated panels — editorial layout, no shadows */}
        <div className="space-y-px bg-border rounded-2xl overflow-hidden">
          {STEPS.map((step) => (
            <div
              key={step.number}
              className="bg-bg p-6 md:p-8 flex gap-5 md:gap-6 items-start"
            >
              <div className="font-display text-3xl md:text-4xl text-accent font-light shrink-0 w-12">
                {step.number}
              </div>
              <div className="flex-1">
                <h3 className="font-display text-lg md:text-xl mb-2 font-light">
                  {step.title}
                </h3>
                <p className="text-sm md:text-base text-text-2 leading-relaxed">
                  {step.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export { LandingHowItWorks };
export const LandingWorkspace = LandingHowItWorks;
