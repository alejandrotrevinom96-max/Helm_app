'use client';

// PR #33 — Sprint 6.1: login page expanded.
//
// Pre-PR-33 the only sign-in option was "Continue with GitHub". User
// feedback was "nuestro signup al momento es únicamente por medio de
// GitHub. Hay que poner OAuth de Google o registrarse con mail +
// password." This page now supports all three.
//
// Layout matches the editorial-glass aesthetic: glass-elevated card,
// accent-glow blob, font-display heading. Existing GitHub users hit
// the same button — back-compat preserved.
import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Mail } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { OAuthButtons } from '../_oauth-buttons';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(
    // ?error=auth_failed lands here from the callback handler when
    // an OAuth round-trip fails. Surface it so the user knows why.
    searchParams.get('error') === 'auth_failed'
      ? 'Sign-in failed. Try again.'
      : searchParams.get('error') === 'no_code'
        ? 'OAuth flow returned no authorization code. Try again.'
        : null
  );

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (signInError) {
      setError(signInError.message);
      setSubmitting(false);
      return;
    }
    // The middleware will route us correctly based on whether the
    // user has finished onboarding. router.refresh() makes server
    // components re-fetch with the new session.
    router.push('/');
    router.refresh();
  };

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
            Welcome back, <em className="editorial-italic">founder.</em>
          </h1>
          <p className="text-text-2 text-sm">
            Sign in to your command center.
          </p>
        </div>

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

        <form onSubmit={handleEmailLogin} className="space-y-3">
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
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 block">
                Password
              </label>
              <Link
                href="/forgot-password"
                className="text-xs text-text-3 hover:text-accent"
              >
                Forgot?
              </Link>
            </div>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm outline-none focus:border-accent"
              placeholder="••••••••"
              autoComplete="current-password"
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
            Sign in
          </button>
        </form>

        <div className="text-center pt-5 mt-5 border-t border-border text-sm text-text-3">
          New to Helm?{' '}
          <Link href="/signup" className="text-accent hover:underline">
            Create account
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  // useSearchParams must be inside a Suspense boundary in Next 15.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
