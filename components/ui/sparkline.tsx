interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  className?: string;
  color?: string;
  ariaLabel?: string;
}

// Tiny inline SVG sparkline. Normalises against the local max so a sparse
// series still reads as a trend; absolute values belong elsewhere on the
// card. Renders nothing for empty data, and renders an em-dash for
// 1–2 data points so a one-day blip doesn't get drawn as a "trend".
//
// PR #83 — Sprint 7.8: the 1-2-point case used to render anyway (the
// polyline would collapse to a dot or a flat line). On the analytics
// page that read as "we have data" when really we had a single
// snapshot. Showing an em-dash makes the founder ask the right
// question ("we don't have enough history yet").
export function Sparkline({
  data,
  width = 100,
  height = 24,
  className = '',
  color = 'currentColor',
  ariaLabel = 'trend',
}: SparklineProps) {
  if (!data || data.length === 0) return null;
  if (data.length < 3) {
    return (
      <span
        className="inline-block text-text-3 text-sm font-mono leading-none align-middle"
        style={{ minWidth: width, minHeight: height, lineHeight: `${height}px` }}
        aria-label={ariaLabel}
        role="img"
      >
        —
      </span>
    );
  }

  const max = Math.max(...data, 1);
  const points = data
    .map((v, i) => {
      const x = (i / Math.max(data.length - 1, 1)) * width;
      const y = height - (v / max) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label={ariaLabel}
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
