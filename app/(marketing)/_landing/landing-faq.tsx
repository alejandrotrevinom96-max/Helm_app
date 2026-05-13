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

const FAQ: { q: string; a: string }[] = [
  {
    q: 'Is this just another AI writing tool?',
    a: 'No. Helm is a marketing OS — strategy, research, content, publishing, and analytics in one workspace. AI is the engine, not the product.',
  },
  {
    q: 'Does Helm replace Buffer / Hootsuite?',
    a: 'For most solo founders and small teams, yes. Helm handles drafts, scheduling, and publishing across 6+ platforms. Plus you get strategic dashboards, audience research, and voice learning that Buffer doesn’t offer.',
  },
  {
    q: "What's the difference between Helm and ChatGPT?",
    a: 'ChatGPT writes generic content. Helm writes content in YOUR voice using your brand bible, voice fingerprint, and audience pain points loaded automatically. Plus it publishes, schedules, and tracks performance.',
  },
  {
    q: 'How does voice fingerprint work?',
    a: 'Helm learns from your likes/dislikes on past drafts and your Quote Vault entries. After 5 reactions, the system starts personalizing tone, structure, and word choice.',
  },
  {
    q: 'Can I use Helm for multiple brands?',
    a: 'Yes. Helm isolates projects completely. Each brand has its own bible, voice, audience, content history, and integrations.',
  },
  {
    q: 'When will Meta Ads / Instagram publishing ship?',
    a: 'v3.5 on our roadmap. We’re prioritizing publishing platforms first (X, LinkedIn shipped; Threads + Reddit next in v3.0). Then Meta auto-publishing + Ads Manager integration come together in v3.5.',
  },
  {
    q: 'Is my data safe?',
    a: 'Yes. Tokens are AES-256-GCM encrypted. Your content stays in your Helm workspace. We never train on your data.',
  },
  {
    q: 'What if I want to leave?',
    a: 'Export everything as JSON or CSV. Delete your account in one click. No lock-in.',
  },
];

export function LandingFAQ() {
  return (
    <section
      id="faq"
      className="py-24 px-4 md:px-8 border-t border-border"
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
