// PR #29 — Sprint 5.1: Terms of Service.
//
// Required by Meta App Review (Terms of Service URL field). Same
// editorial-glass treatment as the Privacy page; content covers the
// platform-compliance disclaimers Meta cares about: don't impersonate,
// don't spam, don't violate third-party platform rules.
import Link from 'next/link';

export const metadata = {
  title: 'Terms of Service — Helm',
  description: 'Terms governing your use of Helm.',
};

export default function TermsPage() {
  const updated = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="max-w-3xl mx-auto px-6 py-16 text-text-2">
      <Link
        href="/"
        className="text-xs text-text-3 hover:text-text-1 inline-block mb-8"
      >
        ← Back to home
      </Link>

      <h1 className="font-display text-4xl font-light mb-2 text-text-1">
        Terms of Service
      </h1>
      <p className="text-sm text-text-3 mb-10">Last updated: {updated}</p>

      <div className="space-y-8 text-sm leading-relaxed">
        <section>
          <h2 className="font-display text-2xl font-light mb-3 text-text-1">
            1. Acceptance of Terms
          </h2>
          <p>
            By using Helm at trythelm.com, you agree to these Terms of
            Service. If you don&apos;t agree, don&apos;t use the service.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-light mb-3 text-text-1">
            2. Description of Service
          </h2>
          <p>Helm is a marketing automation platform that helps founders:</p>
          <ul className="list-disc list-outside pl-5 space-y-1 mt-2">
            <li>Generate brand-aligned social media content using AI</li>
            <li>
              Schedule and auto-publish posts to connected social platforms
            </li>
            <li>Analyze brand consistency across channels</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-light mb-3 text-text-1">
            3. Account Registration
          </h2>
          <ul className="list-disc list-outside pl-5 space-y-1">
            <li>You must be 18 or older to use Helm</li>
            <li>You&apos;re responsible for maintaining account security</li>
            <li>One account per person</li>
            <li>You must provide accurate information</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-light mb-3 text-text-1">
            4. Acceptable Use
          </h2>
          <p>You agree NOT to:</p>
          <ul className="list-disc list-outside pl-5 space-y-1 mt-2">
            <li>Generate or post illegal, harmful, or hateful content</li>
            <li>Impersonate others or misrepresent affiliations</li>
            <li>Spam, harass, or abuse social media platforms</li>
            <li>
              Violate any third-party platform&apos;s terms (Meta, etc.)
            </li>
            <li>Reverse engineer or attempt to circumvent rate limits</li>
            <li>
              Use the service for automated bulk content unrelated to your
              brand
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-light mb-3 text-text-1">
            5. Content Ownership
          </h2>
          <ul className="list-disc list-outside pl-5 space-y-1">
            <li>You retain all rights to content you create with Helm</li>
            <li>
              You grant Helm a license to process your content for service
              delivery
            </li>
            <li>
              You&apos;re responsible for ensuring you have rights to all
              content you publish
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-light mb-3 text-text-1">
            6. Third-Party Integrations
          </h2>
          <p>
            When you connect third-party services (Meta, fal.ai, etc.):
          </p>
          <ul className="list-disc list-outside pl-5 space-y-1 mt-2">
            <li>
              You agree to those services&apos; terms in addition to Helm&apos;s
            </li>
            <li>
              You authorize Helm to act on your behalf within granted
              permissions
            </li>
            <li>
              You&apos;re responsible for compliance with each platform&apos;s
              rules
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-light mb-3 text-text-1">
            7. Pricing & Payment
          </h2>
          <ul className="list-disc list-outside pl-5 space-y-1">
            <li>
              Helm is currently free for early adopters (first 20 founders)
            </li>
            <li>Future pricing will be announced 30 days in advance</li>
            <li>Image generation costs (fal.ai) are passed through at cost</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-light mb-3 text-text-1">
            8. Service Availability
          </h2>
          <ul className="list-disc list-outside pl-5 space-y-1">
            <li>We strive for 99% uptime but make no guarantees</li>
            <li>Scheduled maintenance will be announced in advance</li>
            <li>
              We&apos;re not liable for missed posts due to third-party
              platform outages
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-light mb-3 text-text-1">
            9. Termination
          </h2>
          <ul className="list-disc list-outside pl-5 space-y-1">
            <li>You can delete your account at any time from Settings</li>
            <li>We may suspend accounts that violate these terms</li>
            <li>Upon termination, data is deleted within 30 days</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-light mb-3 text-text-1">
            10. Disclaimers
          </h2>
          <ul className="list-disc list-outside pl-5 space-y-1">
            <li>Helm is provided &ldquo;as is&rdquo; without warranties</li>
            <li>
              AI-generated content may contain errors — review before
              publishing
            </li>
            <li>We&apos;re not responsible for content you publish</li>
            <li>We don&apos;t guarantee social media performance results</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-light mb-3 text-text-1">
            11. Limitation of Liability
          </h2>
          <p>
            To the maximum extent permitted by law, Helm&apos;s liability is
            limited to fees paid in the prior 12 months (or $100, whichever
            is greater).
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-light mb-3 text-text-1">
            12. Changes to Terms
          </h2>
          <p>
            We may update these Terms. Continued use after changes
            constitutes acceptance.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-light mb-3 text-text-1">
            13. Governing Law
          </h2>
          <p>
            These Terms are governed by the laws of Mexico, where Helm
            operates.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-light mb-3 text-text-1">
            14. Contact
          </h2>
          <p>
            Questions about these Terms:{' '}
            <a
              href="mailto:legal@trythelm.com"
              className="text-accent hover:underline"
            >
              legal@trythelm.com
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
