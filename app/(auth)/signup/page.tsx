'use client';

// PR #33 — Sprint 6.1: dedicated signup page.
// PR #34 — Sprint 6.2: pre-fill from ?url= so the landing-page hero
// preview hands off to signup with context. We stash the URL in
// sessionStorage with a short TTL key the dashboard can read after
// the user confirms their email — that's where we'll trigger the
// auto-bible flow once they have a project.
//
// Pre-PR-33 there was no /signup — GitHub OAuth doubled as both
// sign-in and sign-up since the user was created on first OAuth.
// With email/password we need an explicit signup so users can
// register without a third-party account.
//
// On submit we call supabase.auth.signUp + a confirmation email
// is sent (Supabase default). Show a "check your email" success
// state until the user clicks the confirmation link.
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle, Loader2, Mail, Sparkles } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { OAuthButtons } from '../_oauth-buttons';

const PASSWORD_MIN = 8;
// sessionStorage key the post-signup onboarding flow reads to seed
// the auto-bible with the URL the user previewed on the landing.
const PENDING_BRAND_URL_KEY = 'helm:pendingBrandUrl';

function SignupForm() {
  const searchParams = useSearchParams();
  // ?url= comes from the landing-page hero CTA after a successful
  // preview. We display it inline so the user knows the next step
  // already has context, and we stash it for the post-confirmation
  // onboarding to pick up.
  const prefilledUrl = searchParams.get('url')?.trim() ?? null;

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

  // Persist the URL to sessionStorage as soon as we land on /signup
  // so a refresh keeps it available. We also overwrite any stale
  // value from a previous attempt — last URL wins.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (prefilledUrl) {
      try {
        window.sessionStorage.setItem(PENDING_BRAND_URL_KEY, prefilledUrl);
      } catch {
        // Quota or private mode — ignore; we still try to pass the
        // URL through Supabase user_metadata below.
      }
    }
  }, [prefilledUrl]);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < PASSWORD_MIN) {
      setError(`Password must be at least ${PASSWORD_MIN} characters.`);
      return;
    }
    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        // PR #34 — also stash the brand URL in user_metadata so the
        // server-side callback (or a future onboarding step) can
        // read it without depending on browser sessionStorage
        // surviving a different device confirming the email link.
        data: {
          full_name: name.trim(),
          ...(prefilledUrl ? { pending_brand_url: prefilledUrl } : {}),
        },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (signUpError) {
      setError(signUpError.message);
      setSubmitting(false);
      return;
    }
    setSubmittedEmail(email.trim());
    setSubmitting(false);
  };

  if (submittedEmail) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 relative overflow-hidden">
        <div
          aria-hidden
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-accent-glow blur-[140px] opacity-25 -z-10 pointer-events-none"
        />
        <div className="glass-elevated rounded-2xl max-w-md w-full p-8 md:p-10 text-center">
          <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
          <h1 className="font-display text-2xl font-light mb-2">
            Check your email
          </h1>
          <p className="text-sm text-text-2 mb-6">
            We sent a verification link to{' '}
            <strong>{submittedEmail}</strong>. Click it to activate your
            account.
          </p>
          <Link
            href="/login"
            className="text-sm text-accent hover:underline"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6 relative overflow-hidden">
      <div
        aria-hidden
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-accent-glow blur-[140px] opacity-25 -z-10 pointer-events-none"
      />

      <div className="glass-elevated rounded-2xl max-w-md w-full p-8 md:p-10">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-6">
            <svg
              viewBox="0 0 32 32"
              className="w-8 h-8"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <circle cx="16" cy="16" r="14" />
              <circle cx="16" cy="16" r="3" fill="var(--accent)" stroke="none" />
              <line x1="16" y1="2" x2="16" y2="8" />
              <line x1="16" y1="24" x2="16" y2="30" />
              <line x1="2" y1="16" x2="8" y2="16" />
              <line x1="24" y1="16" x2="30" y2="16" />
            </svg>
            <span className="font-display text-2xl font-medium">Helm</span>
          </div>
          <h1 className="font-display text-3xl font-light leading-tight mb-2">
            Create your account
          </h1>
          <p className="text-text-2 text-sm">
            Free for the first 20 founders.
          </p>
        </div>

        {/* PR #34 — context banner when arriving from the landing
            preview. Tells the user their preview URL won't be lost. */}
        {prefilledUrl && (
          <div className="mb-4 p-3 bg-accent/10 border border-accent/30 rounded-lg text-xs text-accent flex items-start gap-2">
            <Sparkles className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              We&apos;ll auto-generate the full brand bible for{' '}
              <strong className="break-all">{prefilledUrl}</strong> right
              after you confirm your email.
            </div>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 bg-danger/10 border border-danger/30 rounded-lg text-sm text-danger">
            {error}
          </div>
        )}

        <OAuthButtons />

        <div className="flex items-center gap-3 my-5">
          <div className="flex-1 h-px bg-border" />
          <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3">
            or
          </span>
          <div className="flex-1 h-px bg-border" />
        </div>

        <form onSubmit={handleSignup} className="space-y-3">
          <div>
            <label className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2 block">
              Name
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm outline-none focus:border-accent"
              placeholder="Your name"
              autoComplete="name"
              maxLength={80}
            />
          </div>
          <div>
            <label className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2 block">
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm outline-none focus:border-accent"
              placeholder="you@example.com"
              autoComplete="email"
            />
          </div>
          <div>
            <label className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2 block">
              Password
            </label>
            <input
              type="password"
              required
              minLength={PASSWORD_MIN}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm outline-none focus:border-accent"
              placeholder={`At least ${PASSWORD_MIN} characters`}
              autoComplete="new-password"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full px-4 py-2.5 bg-accent text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Mail className="w-4 h-4" />
            )}
            Create account
          </button>
        </form>

        <div className="text-center pt-5 mt-5 border-t border-border text-sm text-text-3">
          Already have an account?{' '}
          <Link href="/login" className="text-accent hover:underline">
            Sign in
          </Link>
        </div>

        <p className="text-[10px] text-text-3 text-center pt-4 leading-relaxed">
          By signing up, you agree to our{' '}
          <Link href="/terms" className="underline hover:text-text-2">
            Terms
          </Link>{' '}
          and{' '}
          <Link href="/privacy" className="underline hover:text-text-2">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

// PR #34 — useSearchParams must run inside a Suspense boundary in
// Next 15. Without this Vercel build fails with the bailout error.
export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  );
}
