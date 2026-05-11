'use client';

// PR #57 — Sprint 7.0.1: single pain-point chip in the /research grid.
//
// Each card surfaces what Haiku extracted: theme, how often it
// appeared, a verbatim sample quote, the platform it came from, and
// an actionable angle. The "Generate post →" link pre-fills the
// composer with the angle + quote so the founder can act
// immediately.
import Link from 'next/link';
import { GlassCard } from '@/components/ui/glass-card';

export interface PainPoint {
  theme: string;
  frequency: number;
  sampleQuote: string;
  platform: string;
  isOnDomain?: boolean;
  actionableAngle: string;
}

interface Props {
  painPoint: PainPoint;
  projectId: string;
}

export function PainPointCard({ painPoint, projectId }: Props) {
  const { theme, frequency, sampleQuote, platform, actionableAngle } =
    painPoint;

  // Pre-fill prompt for the composer. Keep it short — the composer
  // already pulls full brand context, this is just the seed.
  const promptText = [
    `Address this audience pain: "${theme}".`,
    actionableAngle,
    `Real quote from community: "${sampleQuote}"`,
  ]
    .filter(Boolean)
    .join(' ');
  const href = `/marketing/generate?projectId=${encodeURIComponent(projectId)}&prompt=${encodeURIComponent(promptText)}`;

  return (
    <GlassCard className="p-4">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <h3 className="font-display text-base font-light">{theme}</h3>
        <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3 shrink-0">
          mentioned {frequency}×
        </span>
      </div>

      <blockquote className="italic text-sm text-text-2 mb-3 border-l-2 border-accent/40 pl-3">
        &ldquo;{sampleQuote}&rdquo;
        <cite className="block text-[11px] font-mono text-text-3 not-italic mt-1">
          — from {platform}
        </cite>
      </blockquote>

      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-text-3 text-xs flex-1 min-w-0 truncate">
          💡 {actionableAngle}
        </span>
        <Link
          href={href}
          className="text-xs font-mono text-accent hover:opacity-80 shrink-0"
        >
          Generate post →
        </Link>
      </div>
    </GlassCard>
  );
}
