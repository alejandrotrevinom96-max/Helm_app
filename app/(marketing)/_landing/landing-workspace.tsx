// PR #34 — Sprint 6.2: replaced the v1 features-card grid with a
// linear "How it works" timeline. Same file path so the route
// group keeps its existing structure; the export is renamed to
// LandingHowItWorks and aliased as LandingWorkspace for back-compat.

interface Step {
  number: string;
  title: string;
  description: string;
}

const STEPS: Step[] = [
  {
    number: '01',
    title: 'Connect your website',
    description:
      'Paste your URL or sign up with Google / GitHub / email. Helm reads your existing brand presence — the same way the landing preview already showed you.',
  },
  {
    number: '02',
    title: 'Auto-generate your brand bible',
    description:
      'AI extracts your archetype, voice, pillars, and audience. Validate visually with a 12-image batch. Refine or accept — it lives with your project.',
  },
  {
    number: '03',
    title: 'Generate posts that actually fit',
    description:
      'Type a topic, AI writes brand-aligned drafts for each platform you choose — Instagram, Facebook, LinkedIn, Threads, Reddit.',
  },
  {
    number: '04',
    title: 'Schedule and ship',
    description:
      'Drag drafts onto the calendar. Pick a golden time. Connect Meta, Helm publishes when scheduled. Stories and Reels work too.',
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
            From website to scheduled posts in minutes
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
