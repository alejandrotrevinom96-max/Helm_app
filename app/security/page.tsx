// PR #39 — Sprint 6.5: public security disclosure policy.
//
// Linked from the landing footer + .well-known/security.txt so
// researchers have a clear, advertised path to report findings
// instead of cold-DMing on Reddit asking for cash before sharing
// (which was the trigger for Sprint 6.5 in the first place).
//
// We deliberately don't run a paid bounty yet — at our scale that
// invites noise more than signal. The page commits to:
//   - 7 day acknowledgement
//   - 14 day triage
//   - 30 day fix for critical, 60 for moderate
//   - public credit (hall of fame) for valid responsible reports
//   - a safe-harbor clause so good-faith researchers don't worry
//     about legal blowback
//
// Update SLAs only with intent — they're a real commitment.

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Security · Helm',
  description:
    'Vulnerability disclosure policy and reporting channel for Helm.',
};

export default function SecurityPage() {
  return (
    <main className="max-w-2xl mx-auto px-6 py-20 md:py-24">
      <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-3 mb-4">
        Security
      </div>
      <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight mb-6">
        Responsible disclosure
      </h1>
      <p className="text-base text-text-2 leading-relaxed mb-8">
        Helm handles your brand data, OAuth tokens, and access to your
        social platforms. We take security seriously and depend on
        responsible researchers to keep us honest.
      </p>

      <h2 className="font-display text-2xl mt-12 mb-3 font-light">
        Reporting a vulnerability
      </h2>
      <p className="text-text-2 leading-relaxed mb-3">
        Email{' '}
        <a
          href="mailto:security@trythelm.com"
          className="text-accent hover:underline"
        >
          security@trythelm.com
        </a>{' '}
        with:
      </p>
      <ul className="list-disc list-inside space-y-1 text-text-2 leading-relaxed mb-6">
        <li>A clear description of the issue</li>
        <li>Steps to reproduce, or a minimal proof-of-concept</li>
        <li>Affected URL(s) or endpoint(s)</li>
        <li>Impact assessment (what could an attacker do?)</li>
      </ul>
      <p className="text-text-3 text-sm leading-relaxed">
        Please do <strong>not</strong> open a public GitHub issue, post
        on social media, or DM us asking for a bounty before sharing
        details. We will not engage with reports that demand payment
        before disclosure.
      </p>

      <h2 className="font-display text-2xl mt-12 mb-3 font-light">
        What to expect
      </h2>
      <ul className="list-disc list-inside space-y-2 text-text-2 leading-relaxed">
        <li>Acknowledgement within 7 days.</li>
        <li>Triage and validation within 14 days.</li>
        <li>
          Fix within 30 days for critical and 60 days for moderate
          severity. Some classes of issue may take longer; we&apos;ll
          tell you the timeline.
        </li>
        <li>
          Public credit on the security hall of fame (coming soon) for
          valid first reports of unpatched issues.
        </li>
      </ul>

      <h2 className="font-display text-2xl mt-12 mb-3 font-light">
        Bounty program
      </h2>
      <p className="text-text-2 leading-relaxed">
        We don&apos;t currently run a paid bug bounty. We deeply
        appreciate responsible disclosure and will publicly credit
        researchers who report valid issues. We may add a paid program
        as the user base grows.
      </p>

      <h2 className="font-display text-2xl mt-12 mb-3 font-light">
        Out of scope
      </h2>
      <ul className="list-disc list-inside space-y-2 text-text-2 leading-relaxed">
        <li>
          Findings from automated scanners without a working
          proof-of-concept.
        </li>
        <li>
          Reports that boil down to &ldquo;the site is missing a
          security header.&rdquo; We cover the important ones; if you
          find a genuine missing protection, the impact section of
          your report is what matters.
        </li>
        <li>Social engineering of Helm staff or users.</li>
        <li>
          Physical attacks on infrastructure (we run on Vercel and
          Supabase — their infra is theirs).
        </li>
        <li>Denial-of-service via volumetric load.</li>
        <li>
          Self-XSS or attacks that require an attacker to already
          control the victim&apos;s browser.
        </li>
        <li>
          Issues requiring outdated browsers (anything older than the
          latest two stable releases of Chrome, Firefox, Safari, Edge).
        </li>
      </ul>

      <h2 className="font-display text-2xl mt-12 mb-3 font-light">
        Safe harbor
      </h2>
      <p className="text-text-2 leading-relaxed mb-3">
        We will not pursue legal action against researchers who:
      </p>
      <ul className="list-disc list-inside space-y-2 text-text-2 leading-relaxed">
        <li>
          Make a good-faith effort to avoid privacy violations, data
          destruction, and service disruption.
        </li>
        <li>
          Only access the minimum data necessary to demonstrate the
          issue.
        </li>
        <li>
          Don&apos;t exfiltrate, retain, or share data found while
          testing.
        </li>
        <li>
          Give us reasonable time to remediate before any public
          disclosure.
        </li>
      </ul>

      <p className="text-text-3 text-xs mt-12 pt-6 border-t border-border">
        Last updated: 2026-05-08. We&apos;ll bump this date whenever
        the policy materially changes.
      </p>
    </main>
  );
}
