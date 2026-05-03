'use client';

import { Line, LineChart, ResponsiveContainer } from 'recharts';

export function Sparkline({
  data,
  className,
}: {
  data: number[];
  className?: string;
}) {
  const chartData = data.map((value, i) => ({ value, i }));
  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--accent)"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
