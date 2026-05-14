'use client';

// PR Sprint 7.19 — visible progress during structured draft
// generation.
//
// Pre-fix: clicking "Generate N drafts" disabled the button +
// flipped its label to "Generating N drafts…" — then nothing
// for ~35 seconds. The page felt frozen.
//
// This component renders inline below the Generate button while
// generation is in flight:
//
//   ┌─────────────────────────────────────────┐
//   │  ✦  Writing your drafts...              │
//   │     ████████░░░░░░░░░░░░  ~25s left     │
//   │                                         │
//   │  ✓  Analyzing brand voice               │
//   │  ◌  Writing content        ← animated   │
//   │  ◌  Generating images                   │
//   └─────────────────────────────────────────┘
//
// Phases tick over as elapsed time crosses each threshold. We
// don't get real progress from the backend (the
// /api/ai/generate-structured endpoint is a single POST that
// resolves at the end), so this is a time-driven animation
// keyed off the same `estimatedSeconds` the caller already
// surfaces in the UI.
//
// Visual contract:
//   - Glass surface, no modal (doesn't block the rest of the
//     dashboard).
//   - Muted copy — the user shouldn't feel alarmed by the wait.
//   - The progress bar fills linearly toward the estimate.
//     If generation runs over, the bar caps at 95% and the time
//     remaining swaps to "almost done…" so we don't promise a
//     completion the backend can't keep.

import { useEffect, useState } from 'react';

interface Props {
  /** Total estimated seconds. Used to space the phases + fill
   * the progress bar. */
  estimatedSeconds: number;
  /** True when the brief includes an image-generating type
   * (carousel / photo / single_image). Removes the "Generating
   * images" step from the list when false. */
  includeImages: boolean;
}

interface PhaseDef {
  /** Stable id used to render the row. */
  id: string;
  /** Label rendered next to the icon. */
  label: string;
  /** Fraction of total estimated time at which this phase
   * starts. The next phase's `startFrac` is implicitly the end
   * of this one. */
  startFrac: number;
}

export function GenerationProgress({
  estimatedSeconds,
  includeImages,
}: Props) {
  const [elapsed, setElapsed] = useState(0);

  // Tick every 250ms — smooth enough for the bar to look
  // alive, infrequent enough that we don't burn CPU on the
  // user's tab.
  useEffect(() => {
    const start = Date.now();
    const id = window.setInterval(() => {
      setElapsed((Date.now() - start) / 1000);
    }, 250);
    return () => window.clearInterval(id);
  }, []);

  // Phase definitions — fractions of total estimate so the
  // sequence stretches/compresses gracefully with whatever
  // estimatedSeconds was passed in. The "almost done" tail is
  // always the final 15% of the estimate.
  const phases: PhaseDef[] = [
    { id: 'brand', label: 'Analyzing brand voice', startFrac: 0 },
    { id: 'writing', label: 'Writing content', startFrac: 0.18 },
    ...(includeImages
      ? [{ id: 'images', label: 'Generating images', startFrac: 0.6 }]
      : []),
    { id: 'finalize', label: 'Almost done…', startFrac: 0.85 },
  ];

  // Active phase = the highest one whose startFrac threshold
  // has been crossed.
  const frac =
    estimatedSeconds > 0 ? elapsed / estimatedSeconds : 0;
  const activeIdx = (() => {
    let idx = 0;
    for (let i = 0; i < phases.length; i++) {
      if (frac >= phases[i].startFrac) idx = i;
    }
    return idx;
  })();

  // Progress bar: caps at 95% so we never promise completion
  // before the POST actually resolves. The remaining 5% fills
  // when the parent unmounts this component (which it does on
  // resolution).
  const barPct = Math.min(95, Math.max(2, frac * 100));

  // Time remaining: floor the seconds, clamp at 0. If we've
  // run past the estimate, swap to a tail message.
  const remaining = Math.max(0, Math.ceil(estimatedSeconds - elapsed));
  const remainingLabel =
    elapsed >= estimatedSeconds ? 'almost done…' : `~${remaining}s left`;

  return (
    <div
      role="status"
      aria-live="polite"
      className="glass rounded-xl p-4 mt-3"
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className="text-base text-accent animate-pulse"
          aria-hidden="true"
        >
          ✦
        </span>
        <span className="text-sm font-medium text-text-1">
          Writing your drafts…
        </span>
      </div>

      {/* Progress bar */}
      <div
        className="w-full h-1.5 rounded-full bg-bg-elev overflow-hidden mb-1"
        aria-hidden="true"
      >
        <div
          className="h-full bg-[image:var(--accent-grad)] rounded-full"
          style={{
            width: `${barPct}%`,
            transition: 'width 250ms linear',
          }}
        />
      </div>
      <div className="text-[11px] font-mono text-text-3 mb-3">
        {remainingLabel}
      </div>

      {/* Step list */}
      <ul className="space-y-1.5">
        {phases.map((p, i) => {
          const isDone = i < activeIdx;
          const isActive = i === activeIdx;
          return (
            <li
              key={p.id}
              className={`flex items-center gap-2 text-xs ${
                isActive
                  ? 'text-text-1'
                  : isDone
                    ? 'text-text-2'
                    : 'text-text-3'
              }`}
            >
              <StepIcon
                state={isDone ? 'done' : isActive ? 'active' : 'pending'}
              />
              <span>{p.label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StepIcon({ state }: { state: 'done' | 'active' | 'pending' }) {
  if (state === 'done') {
    return (
      <span
        className="inline-block w-4 h-4 rounded-full bg-success/15 text-success flex-shrink-0 text-center"
        aria-hidden="true"
        style={{ lineHeight: '1rem', fontSize: '10px' }}
      >
        ✓
      </span>
    );
  }
  if (state === 'active') {
    return (
      <span
        className="inline-block w-4 h-4 rounded-full border-2 border-accent border-t-transparent animate-spin flex-shrink-0"
        aria-hidden="true"
      />
    );
  }
  return (
    <span
      className="inline-block w-4 h-4 rounded-full border border-border flex-shrink-0"
      aria-hidden="true"
    />
  );
}
