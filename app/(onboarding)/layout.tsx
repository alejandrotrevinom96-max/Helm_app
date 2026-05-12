// PR #74 — Sprint 7.2B: 5-step wizard layout (no sidebar).
//
// This layout wraps every route under the (onboarding) route group:
//   /onboarding/welcome
//   /onboarding/project
//   /onboarding/brand
//   /onboarding/research
//   /onboarding/first-content
//
// Route groups are transparent for URL resolution, so the URLs
// keep their `/onboarding/...` prefix while bypassing the
// (dashboard) layout — that's how we get the no-sidebar effect
// without changing any href in the app.
//
// The existing `app/(dashboard)/onboarding/page.tsx` stays put
// and now does a thin redirect into this group (see that file's
// PR #74 comment). New signups arriving via /auth/callback hit
// the dashboard /onboarding first, get redirected to /welcome.
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { OnboardingProgressBar } from '@/components/onboarding/progress-bar';

export default async function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Auth gate — every wizard step needs a session. We do this in
  // the layout (not each page) so a session-loss mid-flow bounces
  // to /login cleanly instead of crashing on a downstream Supabase
  // call.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 shrink-0">
            {/* Inline SVG instead of /public/logo.svg — public/ only
                has security.txt. The mark matches the one used on the
                signup page (concentric circle + cross hairs). */}
            <svg
              viewBox="0 0 32 32"
              className="w-7 h-7 text-text-1"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              aria-hidden
            >
              <circle cx="16" cy="16" r="14" />
              <circle
                cx="16"
                cy="16"
                r="3"
                fill="var(--accent)"
                stroke="none"
              />
              <line x1="16" y1="2" x2="16" y2="8" />
              <line x1="16" y1="24" x2="16" y2="30" />
              <line x1="2" y1="16" x2="8" y2="16" />
              <line x1="24" y1="16" x2="30" y2="16" />
            </svg>
            <span className="font-display text-xl font-light">Helm</span>
          </div>
          <OnboardingProgressBar />
        </div>
      </header>

      <main className="flex-1 px-6 py-10 md:py-16">
        <div className="max-w-2xl mx-auto">{children}</div>
      </main>

      <footer className="border-t border-border px-6 py-4 text-center">
        <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3">
          Helm onboarding · skip anytime · everything is editable later
        </p>
      </footer>
    </div>
  );
}
