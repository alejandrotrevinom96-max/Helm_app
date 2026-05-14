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

// PR #82 — Sprint 7.7: pillar copy rewrite to match v3.0 positioning
// (Marketing OS). Out: "Strategy" label (PR #41 had renamed
// Compass → Strategy because "compass" was the metaphor; v3.0
// positioning treats "Compass" as the named module, same as
// "Marketing" and "Research", because the product surfaces it that
// way in the dashboard sub-nav). Each pillar is now: one-sentence
// tagline + 2-paragraph body + 5 features. Tone shifts from "voice
// of the founder" to "voice of the product", because the new copy
// is selling a Marketing OS, not selling a hands-on assistant.
const PILLARS: Pillar[] = [
  {
    icon: Megaphone,
    label: 'Marketing',
    title: 'AI-powered, voice-aware content',
    description:
      'Generate brand-aware drafts in your voice. Schedule across Instagram, X, LinkedIn, Threads, Facebook, and Reddit. Track what works.\n\nYour voice fingerprint, pillars, and brand bible load automatically — every draft sounds like you, not like a marketing intern.',
    features: [
      'Brand-aware drafts',
      'Multi-platform publishing',
      'Calendar + scheduling',
      'Voice fingerprint learning',
      'Performance memory',
    ],
  },
  {
    icon: Search,
    label: 'Research',
    title: 'Pain points from your real audience',
    description:
      'Stop guessing what your audience wants. Helm scans Reddit, forums, and your community to extract pain points, opportunities, and quotes — ranked by frequency and intensity.\n\nEach insight comes with a one-click "Generate post" button that turns audience signal into shipping content.',
    features: [
      'Reddit + forum mining',
      'Pain point ranking',
      'Direct quote extraction',
      'One-click post generation',
    ],
  },
  {
    icon: Compass,
    label: 'Compass',
    title: 'Strategic clarity in 30 seconds',
    description:
      'What should you actually work on this week? Compass scores your moves by Impact × Effort, benchmarks you against competitors, surfaces blind spots, and tracks every strategic decision you make.\n\nNo more "I think we should…" meetings. Just signal-backed direction.',
    features: [
      'Priority Matrix (Impact × Effort)',
      'Positioning Benchmark',
      'Strategic Timeline',
      'Blind Spots Detector',
      'Decision Log',
    ],
  },
];

function LandingPillars() {
  return (
    <section
      id="pillars"
      className="py-14 md:py-20 px-4 md:px-8 border-t border-border"
    >
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12 md:mb-16">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-3 mb-3">
            What&apos;s inside
          </div>
          <h2 className="font-display text-4xl md:text-5xl tracking-tight font-light">
            One workspace. Three modules. Zero context-switching.
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
                <div className="text-sm text-text-2 leading-relaxed mb-5 space-y-3">
                  {pillar.description.split('\n\n').map((para, i) => (
                    <p key={i}>{para}</p>
                  ))}
                </div>
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
