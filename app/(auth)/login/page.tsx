'use client';

import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const handleGithubLogin = async () => {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes: 'read:user user:email repo',
      },
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6 relative overflow-hidden">
      <div
        aria-hidden
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-accent-glow blur-[140px] opacity-25 -z-10 pointer-events-none"
      />

      <div className="glass-elevated rounded-2xl max-w-md w-full p-8 md:p-12">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-3 mb-8">
            <svg viewBox="0 0 32 32" className="w-10 h-10" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <circle cx="16" cy="16" r="14" />
              <circle cx="16" cy="16" r="3" fill="var(--accent)" stroke="none" />
              <line x1="16" y1="2" x2="16" y2="8" />
              <line x1="16" y1="24" x2="16" y2="30" />
              <line x1="2" y1="16" x2="8" y2="16" />
              <line x1="24" y1="16" x2="30" y2="16" />
            </svg>
            <span className="font-display text-3xl font-medium">Helm</span>
          </div>
          <h1 className="font-display text-3xl md:text-4xl font-light leading-tight mb-3">
            Welcome back, <em className="editorial-italic">founder.</em>
          </h1>
          <p className="text-text-2 text-sm">
            Sign in with GitHub to access your command center.
          </p>
        </div>

        <button
          onClick={handleGithubLogin}
          className="w-full bg-[image:var(--accent-grad)] text-white py-3 px-6 rounded-lg font-medium flex items-center justify-center gap-3 shadow-editorial hover:shadow-editorial-lg hover:-translate-y-0.5 transition-all"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
          </svg>
          Continue with GitHub
        </button>

        <p className="text-center text-text-3 text-xs mt-6">
          We&apos;ll scan your public + private repos to detect your SaaS projects.
          Your data is encrypted and never shared.
        </p>
      </div>
    </div>
  );
}
