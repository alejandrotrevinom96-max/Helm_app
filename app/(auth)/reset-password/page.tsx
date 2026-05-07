'use client';

// PR #33 — Sprint 6.1: reset password page.
//
// Landed on after the user clicks the reset link from their email.
// At this point Supabase has already exchanged the recovery token
// for a session via its own SSR helper — we can call updateUser
// directly. If the user lands here without a session, redirect to
// /forgot-password.
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

const PASSWORD_MIN = 8;

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Confirm we have a session — landing here without one means the
  // token didn't exchange. Better to bounce than fail mysteriously.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!cancelled && !session) {
        router.replace('/forgot-password?error=session_missing');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < PASSWORD_MIN) {
      setError(`Password must be at least ${PASSWORD_MIN} characters.`);
      return;
    }
    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({
      password,
    });
    if (updateError) {
      setError(updateError.message);
      setSubmitting(false);
      return;
    }
    setDone(true);
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6 relative overflow-hidden">
      <div
        aria-hidden
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-accent-glow blur-[140px] opacity-25 -z-10 pointer-events-none"
      />
      <div className="glass-elevated rounded-2xl max-w-md w-full p-8 md:p-10">
        {done ? (
          <div className="text-center">
            <h1 className="font-display text-2xl font-light mb-2">
              Password updated
            </h1>
            <p className="text-sm text-text-2 mb-6">
              You can now sign in with your new password.
            </p>
            <Link
              href="/login"
              className="text-sm text-accent hover:underline"
            >
              Continue to sign in
            </Link>
          </div>
        ) : (
          <>
            <div className="text-center mb-6">
              <h1 className="font-display text-2xl font-light mb-2">
                Choose a new password
              </h1>
              <p className="text-sm text-text-2">
                At least {PASSWORD_MIN} characters.
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
                  New password
                </label>
                <input
                  type="password"
                  required
                  minLength={PASSWORD_MIN}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm outline-none focus:border-accent"
                  autoComplete="new-password"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2 block">
                  Confirm password
                </label>
                <input
                  type="password"
                  required
                  minLength={PASSWORD_MIN}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm outline-none focus:border-accent"
                  autoComplete="new-password"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full px-4 py-2.5 bg-accent text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                Update password
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
