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
// card. Renders nothing for empty/zero data — caller decides what to show.
export function Sparkline({
  data,
  width = 100,
  height = 24,
  className = '',
  color = 'currentColor',
  ariaLabel = 'trend',
}: SparklineProps) {
  if (!data || data.length === 0) return null;

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
