'use client';

// PR #33 — Sprint 6.1: forgot password page.
//
// Email-only flow. We deliberately don't tell the user whether the
// address actually exists in our system — same "if an account
// exists, we sent a link" message either way to avoid leaking
// account enumeration. Supabase honors this on its end.
import { useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      {
        redirectTo: `${window.location.origin}/reset-password`,
      }
    );
    if (resetError) {
      setError(resetError.message);
      setSubmitting(false);
      return;
    }
    setSent(true);
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6 relative overflow-hidden">
      <div
        aria-hidden
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-accent-glow blur-[140px] opacity-25 -z-10 pointer-events-none"
      />
      <div className="glass-elevated rounded-2xl max-w-md w-full p-8 md:p-10">
        {sent ? (
          <div className="text-center">
            <h1 className="font-display text-2xl font-light mb-2">
              Check your email
            </h1>
            <p className="text-sm text-text-2 mb-6">
              If an account exists with <strong>{email}</strong>, we sent
              a reset link.
            </p>
            <Link
              href="/login"
              className="text-sm text-accent hover:underline"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <>
            <div className="text-center mb-6">
              <h1 className="font-display text-2xl font-light mb-2">
                Reset password
              </h1>
              <p className="text-sm text-text-2">
                Enter your email and we&apos;ll send you a reset link.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="p-3 bg-danger/10 border border-danger/30 rounded-lg text-sm text-danger">
                  {error}
                </div>
              )}
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
              <button
                type="submit"
                disabled={submitting}
                className="w-full px-4 py-2.5 bg-accent text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                Send reset link
              </button>
              <div className="text-center text-sm text-text-3 pt-2">
                <Link href="/login" className="hover:text-accent">
                  ← Back to sign in
                </Link>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
