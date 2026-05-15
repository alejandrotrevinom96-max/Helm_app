// PR Sprint 7.25 Phase 9 — unified Helm loaders.
//
// Two complementary loaders pulled from the design-system mockups
// "01 — Ship's Wheel" and "05 — Pulse Mark":
//
//   <ShipsWheelLoader />
//     Definite-work loader. A compass wheel with 8 spokes / 8 dots,
//     a gradient progress arc that rotates around the outer ring.
//     Use when there's a finite job in flight (slide image batch,
//     single Flux call, brand-bible build).
//
//   <PulseMarkLoader />
//     Indefinite-listening loader. The Helm compass mark with
//     concentric pulses radiating outward (blue → purple → orange
//     fade). Use for "scanning / listening / queued" states where
//     duration is open-ended (HeyGen video queued, Research scan,
//     audience listening).
//
// Both respect prefers-reduced-motion: animations stop but the
// gradient + composition stay so the loader still reads as "this
// is happening". Both accept an optional `label` and `subLabel`
// for inline context; pass nothing for an icon-only badge.
'use client';

import type { CSSProperties } from 'react';

interface LoaderProps {
  /** Primary text below the icon (e.g. "Charting your brand"). */
  label?: string;
  /** Secondary text below the label (e.g. "8 slides"). */
  subLabel?: string;
  /** Total visual diameter in px. Default 132 for ShipsWheel, 64
   *  for PulseMark. The mark scales proportionally. */
  size?: number;
  /** Stack the icon + labels vertically (default true). When
   *  false the labels sit to the right of the icon — useful as
   *  an inline replacement for a button label. */
  vertical?: boolean;
  /** Pass-through className for the outer wrapper. */
  className?: string;
}

export function ShipsWheelLoader({
  label,
  subLabel,
  size = 132,
  vertical = true,
  className = '',
}: LoaderProps) {
  // The SVG draws on a 132 viewBox; we scale via CSS width/height
  // so the geometry stays pixel-aligned at any output size.
  return (
    <div
      className={`helm-loader helm-loader-vertical-${vertical ? '1' : '0'} ${className}`.trim()}
      role="status"
      aria-live="polite"
      aria-label={label ?? 'Working'}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 132 132"
        className="helm-loader-wheel"
        aria-hidden
      >
        <defs>
          <linearGradient id="helm-wheel-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#3B82F6" />
            <stop offset="40%" stopColor="#8B5CF6" />
            <stop offset="100%" stopColor="#F97316" />
          </linearGradient>
        </defs>
        {/* Subtle outer track ring */}
        <circle
          cx="66"
          cy="66"
          r="54"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth="2"
          fill="none"
        />
        {/* Static spokes + outer dots — wrapped in a <g> so the
            JS spin keyframe rotates the whole assembly. */}
        <g className="helm-loader-wheel-static">
          <circle
            cx="66"
            cy="66"
            r="14"
            fill="url(#helm-wheel-grad)"
            opacity="0.9"
          />
          <circle cx="66" cy="66" r="6" fill="#F8FAFC" />
          {/* 8 spokes radiating from r=52 to r=80, every 45°.
              Pre-computed coordinates from the mockup so the
              spokes hit the outer dots exactly. */}
          <line x1="80" y1="66" x2="120" y2="66" stroke="rgba(255,255,255,0.45)" strokeWidth="1.6" strokeLinecap="round" />
          <line x1="75.9" y1="75.9" x2="104.2" y2="104.2" stroke="rgba(255,255,255,0.45)" strokeWidth="1.6" strokeLinecap="round" />
          <line x1="66" y1="80" x2="66" y2="120" stroke="rgba(255,255,255,0.45)" strokeWidth="1.6" strokeLinecap="round" />
          <line x1="56.1" y1="75.9" x2="27.8" y2="104.2" stroke="rgba(255,255,255,0.45)" strokeWidth="1.6" strokeLinecap="round" />
          <line x1="52" y1="66" x2="12" y2="66" stroke="rgba(255,255,255,0.45)" strokeWidth="1.6" strokeLinecap="round" />
          <line x1="56.1" y1="56.1" x2="27.8" y2="27.8" stroke="rgba(255,255,255,0.45)" strokeWidth="1.6" strokeLinecap="round" />
          <line x1="66" y1="52" x2="66" y2="12" stroke="rgba(255,255,255,0.45)" strokeWidth="1.6" strokeLinecap="round" />
          <line x1="75.9" y1="56.1" x2="104.2" y2="27.8" stroke="rgba(255,255,255,0.45)" strokeWidth="1.6" strokeLinecap="round" />
          {/* 8 outer dots */}
          <circle cx="126" cy="66" r="3" fill="rgba(255,255,255,0.6)" />
          <circle cx="108.4" cy="108.4" r="3" fill="rgba(255,255,255,0.6)" />
          <circle cx="66" cy="126" r="3" fill="rgba(255,255,255,0.6)" />
          <circle cx="23.6" cy="108.4" r="3" fill="rgba(255,255,255,0.6)" />
          <circle cx="6" cy="66" r="3" fill="rgba(255,255,255,0.6)" />
          <circle cx="23.6" cy="23.6" r="3" fill="rgba(255,255,255,0.6)" />
          <circle cx="66" cy="6" r="3" fill="rgba(255,255,255,0.6)" />
          <circle cx="108.4" cy="23.6" r="3" fill="rgba(255,255,255,0.6)" />
        </g>
        {/* Gradient progress arc — animated via stroke-dashoffset
            spinning around the ring. r=54 → circumference=339. We
            paint a 152-unit arc and slide the start point so it
            chases its own tail. */}
        <g className="helm-loader-wheel-arc">
          <circle
            cx="66"
            cy="66"
            r="54"
            stroke="url(#helm-wheel-grad)"
            strokeWidth="3"
            fill="none"
            strokeDasharray="152 339"
            strokeLinecap="round"
          />
        </g>
      </svg>
      {(label || subLabel) && (
        <div className="helm-loader-labels">
          {label && <div className="helm-loader-label">{label}</div>}
          {subLabel && <div className="helm-loader-sublabel">{subLabel}</div>}
        </div>
      )}
    </div>
  );
}

export function PulseMarkLoader({
  label,
  subLabel,
  size = 64,
  vertical = true,
  className = '',
}: LoaderProps) {
  // Three concentric pulse rings + the static compass mark in
  // the middle. CSS keyframe `helm-pulse` does scale + opacity +
  // border-color shift (blue → purple → orange) on each ring,
  // with staggered delays so the pulses overlap.
  return (
    <div
      className={`helm-loader helm-loader-vertical-${vertical ? '1' : '0'} ${className}`.trim()}
      role="status"
      aria-live="polite"
      aria-label={label ?? 'Listening'}
    >
      <div
        className="helm-pulse-stack"
        style={{ width: size, height: size } as CSSProperties}
        aria-hidden
      >
        <span className="helm-pulse-ring" />
        <span className="helm-pulse-ring" />
        <span className="helm-pulse-ring" />
        <svg
          className="helm-pulse-mark"
          width={size * 0.55}
          height={size * 0.55}
          viewBox="0 0 32 32"
          fill="none"
        >
          <defs>
            <linearGradient id="helm-pulse-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#60A5FA" />
              <stop offset="50%" stopColor="#A78BFA" />
              <stop offset="100%" stopColor="#FB923C" />
            </linearGradient>
          </defs>
          <circle
            cx="16"
            cy="16"
            r="11.2"
            stroke="url(#helm-pulse-grad)"
            strokeWidth="1.8"
            fill="none"
          />
          <circle cx="16" cy="16" r="3.2" fill="url(#helm-pulse-grad)" />
          <path
            d="M16 1.6V8.4 M16 23.6V30.4 M1.6 16H8.4 M23.6 16H30.4 M6 6L10.7 10.7 M21.3 21.3L26 26 M26 6L21.3 10.7 M10.7 21.3L6 26"
            stroke="url(#helm-pulse-grad)"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </div>
      {(label || subLabel) && (
        <div className="helm-loader-labels">
          {label && <div className="helm-loader-label">{label}</div>}
          {subLabel && <div className="helm-loader-sublabel">{subLabel}</div>}
        </div>
      )}
    </div>
  );
}
