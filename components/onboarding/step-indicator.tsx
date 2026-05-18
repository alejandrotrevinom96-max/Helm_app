'use client';

// PR Sprint onboarding-wow — Cambio C.
//
// Shared step progress indicator for the wizard pages
// (/onboarding/project, /onboarding/brand, /onboarding/wow).
// Three steps total in this flow — the indicator surfaces
// where the founder is right now + how much is left.
//
// Render shape:
//   [1 ✓] [2 (active)] [3]
// Steps before `current` get a ✓ checkmark. The current step
// is highlighted with the accent color. Future steps are
// dimmed numbers.
//
// Reuses the platform-* tokens already in globals.css so it
// visually matches the marketing sub-nav + page eyebrows.

interface Props {
  current: 1 | 2 | 3 | 4;
  total?: number;
  // Optional labels per step. When provided, the indicator
  // surfaces a tiny caption under the active step. Useful for
  // disambiguating which step is which on a brand-new flow.
  labels?: string[];
}

export function StepIndicator({ current, total = 3, labels }: Props) {
  const steps = Array.from({ length: total }, (_, i) => i + 1);
  return (
    <nav
      aria-label="Onboarding progress"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        marginBottom: '24px',
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        fontSize: '11px',
        letterSpacing: '0.15em',
        textTransform: 'uppercase',
      }}
    >
      {steps.map((n, idx) => {
        const isDone = n < current;
        const isActive = n === current;
        const isFuture = n > current;
        return (
          <div
            key={n}
            style={{ display: 'flex', alignItems: 'center', gap: '12px' }}
          >
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                color: isActive
                  ? 'var(--accent)'
                  : isDone
                    ? 'var(--text-2)'
                    : 'var(--text-3)',
                opacity: isFuture ? 0.6 : 1,
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  border: '1px solid',
                  borderColor: isActive
                    ? 'var(--accent)'
                    : isDone
                      ? 'var(--text-2)'
                      : 'var(--border)',
                  background: isActive
                    ? 'rgba(249,115,22,0.10)'
                    : 'transparent',
                  fontSize: '11px',
                }}
              >
                {isDone ? '✓' : n}
              </span>
              {/* PR Sprint onboarding-wow polish — pre-fix the
                  label span echoed the step number for every
                  non-active, non-labeled step. Combined with the
                  circle (which already shows `n` for future
                  steps) you got "3 3" / "2 2". Now: render the
                  active "(active)" caption, an explicit label
                  when provided, OR nothing — the numbered circle
                  alone is sufficient indication for future
                  steps. */}
              {(isActive || labels?.[idx]) && (
                <span>
                  {isActive ? `${n} (active)` : labels![idx]}
                </span>
              )}
            </div>
            {idx < steps.length - 1 && (
              <span
                aria-hidden
                style={{
                  width: '20px',
                  height: '1px',
                  background: 'var(--border)',
                }}
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}
