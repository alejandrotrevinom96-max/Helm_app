// PR #34 — Sprint 6.2: replaced the v1 "7 tabs" problem section
// with the 3-pillars layout.
//
// We keep the file name (landing-problem.tsx) so the route group's
// layout / git history doesn't churn — the export is renamed to
// LandingPillars and re-exported as LandingProblem for the existing
// landing-page.tsx import. Component itself is the new pillars
// section.
import { Megaphone, Search, Compass } from 'lucide-react';

interface Pillar {
  icon: typeof Megaphone;
  label: string;
  title: string;
  description: string;
  features: string[];
}

// PR #41 — Sprint 6.6: pillar copy rewrite. Out: parallel one-word
// titles ("Generate. Schedule. Share." / "Find pain. Find users." /
// "Score your startup like a VC.") that read as ChatGPT pattern
// matching, plus VC-aimed framing on Compass that addresses the
// wrong audience. In: situation-specific titles that name a real
// founder moment, body copy in one consistent voice across all
// three tools, bullets as present-tense verbs instead of feature
// nouns. Compass renamed to "Strategy" because that's what the
// product is — "compass" was the metaphor, "strategy" is the noun.
const PILLARS: Pillar[] = [
  {
    icon: Megaphone,
    label: 'Marketing',
    title: 'Stop staring at the empty caption box',
    description:
      "Helm reads your website or Instagram, learns how you actually sound, then writes posts that match. You review, you tap to share, you go back to building. The calendar tells you when your audience is actually online (not when LinkedIn says they are).",
    features: [
      'Reads your existing brand from a URL',
      'Validates the visual style with 12 image options',
      'Writes for Instagram, Facebook, LinkedIn, Threads, Reddit',
      'Calendar shows your real golden times',
      'One tap to share anywhere',
      'Native auto-post to Meta arriving in v3',
    ],
  },
  {
    icon: Search,
    label: 'Research',
    title: 'Read where your customers actually complain',
    description:
      'Reddit threads at 2am, Hacker News flame wars, Indie Hackers lurkers asking for the thing you build. Helm pulls real complaints and questions from where your audience hangs out, not from a generic SEO tool.',
    features: [
      'Pulls posts from Reddit, Hacker News, Indie Hackers',
      'Tracks Google Trends for your topic',
      'Builds an audience profile from real conversations',
      'Saves what matters so you can reference it later',
    ],
  },
  {
    icon: Compass,
    label: 'Strategy',
    title: 'Spot the gap before you waste a quarter',
    description:
      "You're guessing what to build next. Helm runs a strategy review on what you already have, finds the gaps that will hurt you in 6 months, and tells you what to fix first. No VC theater, no 40-slide framework. Just where you're weak and what to do.",
    features: [
      'Reviews your current strategy across 8 dimensions',
      'Flags the weak spots most founders miss',
      'Compares your positioning to actual competitors',
      'Tells you the next thing worth working on',
    ],
  },
];

function LandingPillars() {
  return (
    <section
      id="pillars"
      className="py-24 px-4 md:px-8 border-t border-border"
    >
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12 md:mb-16">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-3 mb-3">
            What&apos;s inside
          </div>
          <h2 className="font-display text-4xl md:text-5xl tracking-tight font-light">
            Three tools that work together
          </h2>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {PILLARS.map((pillar) => {
            const Icon = pillar.icon;
            return (
              <div
                key={pillar.label}
                className="bg-bg-elev/60 border border-border rounded-2xl p-7 flex flex-col"
              >
                <div className="w-11 h-11 bg-accent/10 rounded-xl flex items-center justify-center mb-5">
                  <Icon className="w-5 h-5 text-accent" />
                </div>
                <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
                  {pillar.label}
                </div>
                <h3 className="font-display text-xl mb-3 font-light">
                  {pillar.title}
                </h3>
                <p className="text-sm text-text-2 leading-relaxed mb-5">
                  {pillar.description}
                </p>
                <ul className="space-y-1.5 mt-auto">
                  {pillar.features.map((f, i) => (
                    <li
                      key={i}
                      className="text-sm text-text-2 flex items-start gap-2"
                    >
                      <span className="text-accent mt-1">·</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// Re-export under the legacy name so landing-page.tsx imports keep
// working without churn. Both names point to the same component.
export { LandingPillars };
export const LandingProblem = LandingPillars;
