'use client';

// PR Sprint 7.25 Phase 8 — interactive demo input on the landing.
//
// The terminal-style "$ helm read https://..." box is now an actual
// controlled <input>. Submitting it (Enter or click "Read brand →")
// hands the URL off to the signup flow via the existing ?url= query
// param the signup page already parses (see app/(auth)/signup/page
// .tsx — it stashes the value in sessionStorage with key
// `helm:pendingBrandUrl` so the post-confirmation onboarding picks
// it up and auto-fires the brand-bible builder).
//
// We keep it as a tiny CLIENT component instead of leaking 'use
// client' onto the whole landing — landing-live-one.tsx needs to
// stay a server component so getSpotsCount() (a DB hit) can run
// SSR-only, and the ambient/page-head/sections don't need any
// client JS.
import { useRouter } from 'next/navigation';
import { useState } from 'react';

function normaliseUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Accept naked domains ("foo.com") and silently upgrade. Founders
  // type domains way more often than full URLs in a hero CTA.
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const u = new URL(withScheme);
    if (!u.hostname.includes('.')) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function DemoUrlForm() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const normalised = normaliseUrl(value);
    if (!normalised) {
      setError('Enter a real URL (e.g. yourbrand.com)');
      return;
    }
    setSubmitting(true);
    router.push(`/signup?url=${encodeURIComponent(normalised)}`);
  };

  return (
    <form className="landing-demo-shell" onSubmit={submit} noValidate>
      <span className="prompt">$</span>
      <span className="cmd-prefix">helm read</span>
      <input
        className="cmd-input"
        type="text"
        inputMode="url"
        autoComplete="url"
        spellCheck={false}
        placeholder="https://your-brand.com"
        aria-label="Your brand URL"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          if (error) setError(null);
        }}
        disabled={submitting}
      />
      <button
        type="submit"
        className="send"
        disabled={submitting || value.trim().length === 0}
      >
        {submitting ? 'Reading…' : 'Read brand'}
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M3 8h10M9 4l4 4-4 4"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {error && (
        <span
          role="alert"
          className="cmd-error"
          // Inline because there's no other consumer of this color
          // mix in the landing — the validation message is the only
          // place it shows up.
          style={{ color: 'var(--d-red-2)' }}
        >
          {error}
        </span>
      )}
    </form>
  );
}
