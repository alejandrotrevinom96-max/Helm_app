// PR #29 — Sprint 5.1: Privacy Policy.
//
// Required by Meta App Review for any app that requests pages_*,
// instagram_*, or business_management scopes. The URL is referenced
// in the Meta App settings → Privacy Policy URL.
//
// Style: keep it readable on the dark editorial-glass theme. We
// don't load the @tailwindcss/typography plugin, so headings + lists
// get explicit utility classes. Content is human-written, not boiler-
// plate generator output — Meta reviewers read these.
import Link from 'next/link';

export const metadata = {
  title: 'Privacy Policy — Helm',
  description:
    'How Helm collects, uses, and protects your information.',
};

export default function PrivacyPage() {
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
        Privacy Policy
      </h1>
      <p className="text-sm text-text-3 mb-10">Last updated: {updated}</p>

      <div className="space-y-8 text-sm leading-relaxed">
        <section>
          <h2 className="font-display text-2xl font-light mb-3 text-text-1">
            1. Introduction
          </h2>
          <p>
            Helm (&ldquo;we&rdquo;, &ldquo;our&rdquo;, &ldquo;us&rdquo;)
            is a marketing automation platform for indie founders. This
            Privacy Policy explains how we collect, use, and protect
            your information when you use Helm at trythelm.com.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-light mb-3 text-text-1">
            2. Information We Collect
          </h2>
          <h3 className="font-medium text-text-1 mt-4 mb-2">
            2.1 Information you provide
          </h3>
          <ul className="list-disc list-outside pl-5 space-y-1">
            <li>Account information: email, name, password (hashed)</li>
            <li>Project information: brand bibles, content, scheduled posts</li>
            <li>
              Integration credentials: OAuth tokens for connected services
              (encrypted at rest with AES-256-GCM)
            </li>
          </ul>

          <h3 className="font-medium text-text-1 mt-4 mb-2">
            2.2 Information from third-party services
          </h3>
          <p>
            When you connect Meta (Facebook + Instagram), we receive:
          </p>
          <ul className="list-disc list-outside pl-5 space-y-1 mt-2">
            <li>Your Facebook Page name and ID</li>
            <li>Your Instagram Business account username and ID</li>
            <li>
              A Page Access Token, encrypted at rest, used solely to publish
              content you create through Helm
            </li>
          </ul>
          <p className="mt-2">
            We do <strong>not</strong> access your personal Facebook profile,
            friends list, or private messages.
          </p>

          <h3 className="font-medium text-text-1 mt-4 mb-2">
            2.3 Automatically collected
          </h3>
          <ul className="list-disc list-outside pl-5 space-y-1">
            <li>Usage data: pages visited, features used, timestamps</li>
            <li>Technical data: browser type, device type, IP address</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-light mb-3 text-text-1">
            3. How We Use Your Information
          </h2>
          <ul className="list-disc list-outside pl-5 space-y-1">
            <li>To provide and maintain the Helm service</li>
            <li>
              To publish content to your connected social accounts on your
              behalf
            </li>
            <li>To analyze your existing content for brand bible auto-generation</li>
            <li>To improve our AI models (anonymized data only)</li>
            <li>To communicate with you about your account</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-light mb-3 text-text-1">
            4. How We Share Your Information
          </h2>
          <p>
            We do <strong>not</strong> sell your personal information. We
            share data only with:
          </p>
          <ul className="list-disc list-outside pl-5 space-y-1 mt-2">
            <li>
              <strong>Service providers:</strong> Anthropic (AI), fal.ai
              (image generation), Vercel (hosting), Supabase (database)
            </li>
            <li>
              <strong>Connected platforms:</strong> Meta, when you authorize
              posting
            </li>
            <li>
              <strong>Legal compliance:</strong> when required by law
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-light mb-3 text-text-1">
            5. Data Security
          </h2>
          <ul className="list-disc list-outside pl-5 space-y-1">
            <li>OAuth tokens encrypted with AES-256-GCM at rest</li>
            <li>HTTPS/TLS for all data in transit</li>
            <li>Database access restricted to authorized personnel</li>
            <li>Regular security audits</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-light mb-3 text-text-1">
            6. Your Rights
          </h2>
          <ul className="list-disc list-outside pl-5 space-y-1">
            <li>
              <strong>Access:</strong> view all data we have about you
            </li>
            <li>
              <strong>Delete:</strong> request deletion of your account and
              data
            </li>
            <li>
              <strong>Disconnect:</strong> revoke any third-party integration
              at any time
            </li>
            <li>
              <strong>Export:</strong> download your data in JSON format
            </li>
          </ul>
          <p className="mt-2">
            Contact us at{' '}
            <a
              href="mailto:privacy@trythelm.com"
              className="text-accent hover:underline"
            >
              privacy@trythelm.com
            </a>{' '}
            to exercise these rights.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-light mb-3 text-text-1">
            7. Meta Platform Compliance
          </h2>
          <p>If you connect Meta (Facebook / Instagram):</p>
          <ul className="list-disc list-outside pl-5 space-y-1 mt-2">
            <li>
              We only access data necessary for the auto-posting feature
            </li>
            <li>We do not store your Meta personal profile data</li>
            <li>
              Page Access Tokens are encrypted and used solely for
              publishing content you create
            </li>
            <li>
              You can disconnect at any time from{' '}
              <strong>Settings → Integrations</strong>
            </li>
            <li>
              Disconnecting deletes all stored Meta credentials within 24
              hours
            </li>
          </ul>
          <p className="mt-2">
            To revoke Helm&apos;s access from Meta directly, visit{' '}
            <a
              href="https://www.facebook.com/settings?tab=business_tools"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              Facebook Settings → Business Integrations
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-light mb-3 text-text-1">
            8. Data Retention
          </h2>
          <ul className="list-disc list-outside pl-5 space-y-1">
            <li>Account data: retained while your account is active</li>
            <li>Deleted accounts: data removed within 30 days</li>
            <li>OAuth tokens: revoked and deleted upon disconnection</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-light mb-3 text-text-1">
            9. Children&apos;s Privacy
          </h2>
          <p>
            Helm is not intended for users under 18. We do not knowingly
            collect data from children.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-light mb-3 text-text-1">
            10. Changes to This Policy
          </h2>
          <p>
            We may update this Privacy Policy. Material changes will be
            notified via email at least 30 days before taking effect.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-light mb-3 text-text-1">
            11. Contact Us
          </h2>
          <p>For privacy questions, contact:</p>
          <ul className="list-disc list-outside pl-5 space-y-1 mt-2">
            <li>
              Email:{' '}
              <a
                href="mailto:privacy@trythelm.com"
                className="text-accent hover:underline"
              >
                privacy@trythelm.com
              </a>
            </li>
            <li>
              Website:{' '}
              <a
                href="https://trythelm.com"
                className="text-accent hover:underline"
              >
                trythelm.com
              </a>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
