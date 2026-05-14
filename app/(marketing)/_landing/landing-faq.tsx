'use client';

// PR #82 — Sprint 7.7: FAQ section.
//
// 8 questions, each rendered as a native <details> element so the
// section degrades gracefully without JavaScript and the user can
// open multiple at once. The first question stays closed by default
// — opening the first one for the user implies "this is the thing
// you'll click first", which is rarely correct. Let the visitor
// pick.
//
// Question selection: each item kills a specific objection the
// audit + early-user calls surfaced:
//   - "another AI writing tool?" → category disambiguation
//   - "replaces Buffer?" → competitor positioning
//   - "vs ChatGPT?" → category disambiguation (different lens)
//   - "voice fingerprint?" → demystify the proprietary IP
//   - "multiple brands?" → multi-tenant question, agencies care
//   - "Meta Ads when?" → roadmap expectations
//   - "data safe?" → security gate
//   - "exit?" → lock-in fear
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

// PR Sprint 7.19 — landing v3.1 (PRODUCTION). Answers rewritten
// per the brief: cleaner sentences, no em-dashes, lead with the
// concrete answer then explain. Kept the question phrasings the
// founder's audit landed on (those are the questions visitors
// actually ask) and replaced the bodies.
const FAQ: { q: string; a: string }[] = [
  {
    q: 'Is this just another AI writing tool?',
    a: "No. ChatGPT writes generic posts. Helm writes posts that sound like you, because it learns your voice from your past content, your brand bible, and what you've marked as Worked or Flopped. It also publishes them, schedules them, and tells you what converts.",
  },
  {
    q: 'Does Helm replace Buffer or Hootsuite?',
    a: 'Yes, for solo founders and small teams. Helm handles drafting, scheduling, and publishing across X and LinkedIn today. Threads, Reddit, Instagram, and Facebook are on the roadmap. If you need enterprise team workflows or approval chains, Buffer might still be a better fit.',
  },
  {
    q: "What's the difference between Helm and ChatGPT?",
    a: 'ChatGPT is a smart assistant that forgets you every conversation. Helm remembers your voice, your audience, your brand pillars, and what worked last time. Then it publishes the result. ChatGPT writes. Helm ships.',
  },
  {
    q: 'How does voice fingerprint work?',
    a: "Connect your existing accounts, or paste in a few posts you've written. Helm extracts the patterns: phrases, rhythm, hooks, tone. It uses them as constraints on every draft. The more you mark posts as Worked or Flopped, the sharper it gets.",
  },
  {
    q: 'Can I use Helm for multiple brands?',
    a: "Yes. Each project is fully isolated. Separate brand bible, voice fingerprint, audience, and calendar. No bleed between brands. Useful if you're running multiple SaaS, or doing fractional marketing for clients.",
  },
  {
    q: 'When will Meta Ads and Instagram publishing ship?',
    a: 'Instagram and Facebook publishing land in v3.5. Meta Ads Manager integration is on the same release: campaign creation, budget editing, pause and resume, and cross-referencing ad performance with organic content.',
  },
  {
    q: 'Is my data safe?',
    a: "Yes. Your content, voice data, and audience research stay yours. We use Supabase with row-level security, encrypted at rest. We don't train on your data. The Security page has the specifics.",
  },
  {
    q: 'What if I want to leave?',
    a: 'Export everything in one click. Drafts, calendar, brand bible, research, decision log. JSON or markdown. No lock-in, no exit fees, no "we own your account" clauses. You leave with what you brought.',
  },
];

export function LandingFAQ() {
  return (
    <section
      id="faq"
      className="py-14 md:py-20 px-4 md:px-8 border-t border-border"
    >
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-12">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-3 mb-3">
            FAQ
          </div>
          <h2 className="font-display text-4xl md:text-5xl tracking-tight font-light">
            Questions you might have.
          </h2>
        </div>

        <div className="space-y-2">
          {FAQ.map((item, i) => (
            <FAQItem key={i} q={item.q} a={item.a} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FAQItem({ q, a }: { q: string; a: string }) {
  // Use React state instead of <details> so the chevron can rotate
  // in lockstep with the open state. <details> chevrons can't be
  // styled to follow `open` reliably across browsers.
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-bg-elev/60 border border-border rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-bg-elev/80 transition-colors"
      >
        <span className="font-medium text-text-1">{q}</span>
        <ChevronDown
          className={`w-4 h-4 text-text-3 shrink-0 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>
      {open && (
        <div className="px-5 pb-5 text-sm text-text-2 leading-relaxed">
          {a}
        </div>
      )}
    </div>
  );
}
