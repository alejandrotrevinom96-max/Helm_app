export function SetupIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 160" className={className} fill="none">
      <rect
        x="20"
        y="40"
        width="60"
        height="80"
        rx="8"
        stroke="var(--border-bright)"
        strokeWidth="1.5"
      />
      <rect
        x="120"
        y="40"
        width="60"
        height="80"
        rx="8"
        stroke="var(--border-bright)"
        strokeWidth="1.5"
      />
      <path
        d="M 80 80 L 120 80"
        stroke="var(--accent)"
        strokeWidth="1.5"
        strokeDasharray="4 4"
      />
      <circle cx="100" cy="80" r="6" fill="var(--accent)" />
      <circle cx="50" cy="60" r="3" fill="var(--text-3)" />
      <circle cx="50" cy="80" r="3" fill="var(--text-3)" />
      <circle cx="50" cy="100" r="3" fill="var(--text-3)" />
      <circle cx="150" cy="60" r="3" fill="var(--text-3)" />
      <circle cx="150" cy="80" r="3" fill="var(--text-3)" />
      <circle cx="150" cy="100" r="3" fill="var(--text-3)" />
    </svg>
  );
}
