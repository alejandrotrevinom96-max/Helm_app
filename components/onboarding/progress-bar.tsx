'use client';

// PR #74 — Sprint 7.2B: top-of-page step indicator for the 5-step
// wizard. Reads the current pathname to figure out which step the
// founder is on; no server roundtrip needed.
//
// Tap-to-go-back is intentionally DISABLED — the wizard is
// linear and skipping forward via the indicator would create
// half-filled state. The "← Atrás" links inside each step page
// handle the back-nav case.
//
// PR Sprint onboarding-wow polish — Cambio B. The new-project
// flow (added in Sprint onboarding-wow) only walks 3 steps
// (project → brand → wow), not the 5-step wizard. Surfacing the
// 5-dot bar there shows "Brand = step 3 of 5" which is wrong
// for that path and confuses the founder. Detect via:
//   - pathname === '/onboarding/wow'           → always new-project
//   - pathname === '/onboarding/brand' AND
//     ?newProject=1 in the query                → brand step of new
//                                                  project flow
// and hide the bar in both cases. The inline <StepIndicator/>
// in the page content carries the progress UI for the
// new-project flow instead.
import { usePathname, useSearchParams } from 'next/navigation';

const STEPS = [
  { key: 'welcome', label: 'Welcome' },
  { key: 'project', label: 'Project' },
  { key: 'brand', label: 'Brand' },
  { key: 'research', label: 'Research' },
  { key: 'first-content', label: 'First post' },
] as const;

export function OnboardingProgressBar() {
  const pathname = usePathname() ?? '';
  const searchParams = useSearchParams();

  // Hide on the new-project flow — the inline StepIndicator in
  // the page content carries the progress UI there.
  const isWowPath = pathname.includes('/onboarding/wow');
  const isNewProjectBrand =
    pathname.includes('/onboarding/brand') &&
    (searchParams?.get('newProject') === '1');
  if (isWowPath || isNewProjectBrand) {
    return null;
  }

  // Match against the segment after /onboarding/. We test the
  // longer keys first so `first-content` doesn't accidentally
  // resolve as `first` if we ever add a step with that prefix.
  const sorted = [...STEPS].sort((a, b) => b.key.length - a.key.length);
  const currentKey =
    sorted.find((s) => pathname.includes(`/onboarding/${s.key}`))?.key ??
    'welcome';
  const currentIndex = STEPS.findIndex((s) => s.key === currentKey);

  return (
    <div
      className="flex items-center gap-1.5"
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={STEPS.length}
      aria-valuenow={currentIndex + 1}
      aria-label={`Step ${currentIndex + 1} of ${STEPS.length}: ${STEPS[currentIndex]?.label}`}
    >
      {STEPS.map((step, i) => {
        const isDone = i < currentIndex;
        const isCurrent = i === currentIndex;
        return (
          <div key={step.key} className="flex items-center gap-1.5">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-mono font-medium transition-colors ${
                isDone
                  ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/40'
                  : isCurrent
                    ? 'bg-accent text-white border border-accent'
                    : 'bg-bg-elev text-text-3 border border-border'
              }`}
              title={step.label}
              aria-hidden
            >
              {isDone ? '✓' : i + 1}
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`w-4 sm:w-6 h-px ${
                  isDone ? 'bg-emerald-500/40' : 'bg-border'
                }`}
                aria-hidden
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
