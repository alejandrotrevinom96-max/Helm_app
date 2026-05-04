'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';
import { BrandBibleModal } from './brand-bible-modal';
import type { BrandBible } from '@/lib/types/brand';

export interface BrandProject {
  id: string;
  name: string;
  brandUrl: string | null;
  brandContext: BrandBible | null;
}

export function BrandBibleCard({ project }: { project: BrandProject }) {
  const [showModal, setShowModal] = useState(false);
  const bible = project.brandContext;
  const completion = bible?.meta?.completionScore ?? 0;

  // Empty state — never run discovery for this project.
  if (!bible || !bible.meta) {
    return (
      <>
        <GlassCard className="p-5 mb-6">
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
            Brand bible
          </div>
          <h3 className="font-display text-xl font-light mb-2">
            Set up your brand bible
          </h3>
          <p className="text-sm text-text-2 mb-4">
            Helm needs to understand your brand to write posts that sound like
            you. We&apos;ll analyze your URL and ask a few questions to fill in
            gaps.
          </p>
          <Button onClick={() => setShowModal(true)}>
            Start brand discovery →
          </Button>
        </GlassCard>
        {showModal && (
          <BrandBibleModal
            project={project}
            startInDiscover
            onClose={() => setShowModal(false)}
          />
        )}
      </>
    );
  }

  return (
    <>
      <GlassCard className="p-5 mb-6">
        <div className="flex justify-between items-start mb-3 gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-1">
              Brand bible
            </div>
            <h3 className="font-display text-xl font-light">
              {bible.identity?.name || project.name}
              {bible.archetype?.primary && (
                <span className="text-text-3 text-base font-normal ml-2 capitalize">
                  · {bible.archetype.primary}
                </span>
              )}
            </h3>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="text-xs text-accent hover:underline whitespace-nowrap"
          >
            Edit →
          </button>
        </div>

        <div className="mb-4">
          <div className="flex justify-between items-center mb-1">
            <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3">
              Completeness
            </span>
            <span className="text-xs text-text-1 font-medium">
              {completion}%
            </span>
          </div>
          <div className="h-1 bg-border rounded-full overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-500"
              style={{ width: `${completion}%` }}
            />
          </div>
          {completion < 70 && (
            <p className="text-[10px] text-text-3 mt-1">
              Helm writes better posts when your bible is more complete.{' '}
              <button
                onClick={() => setShowModal(true)}
                className="text-accent hover:underline"
              >
                Refine →
              </button>
            </p>
          )}
        </div>

        {bible.voice && (
          <div className="mb-4">
            <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3 mb-2">
              Voice
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <SpectrumBar label="Casual / Formal" value={bible.voice.formal} />
              <SpectrumBar
                label="Playful / Serious"
                value={bible.voice.serious}
              />
              <SpectrumBar label="Reserved / Bold" value={bible.voice.bold} />
              <SpectrumBar
                label="Traditional / Innovative"
                value={bible.voice.innovative}
              />
            </div>
          </div>
        )}

        {bible.pillars && bible.pillars.length > 0 && (
          <div className="mb-4">
            <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3 mb-2">
              Pillars
            </div>
            <div className="flex flex-wrap gap-2">
              {bible.pillars.map((p, i) => (
                <span
                  key={i}
                  className="text-xs px-2 py-1 rounded-full bg-accent-soft text-accent"
                  title={p.description}
                >
                  {p.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {bible.audience?.primary?.description && (
          <div className="mb-4">
            <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3 mb-2">
              Audience
            </div>
            <p className="text-sm text-text-1">
              {bible.audience.primary.description}
            </p>
            {bible.audience.primary.painPoints &&
              bible.audience.primary.painPoints.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {bible.audience.primary.painPoints.slice(0, 3).map((p, i) => (
                    <li
                      key={i}
                      className="text-xs text-text-2 flex items-start gap-2"
                    >
                      <span className="text-accent">•</span>
                      <span>{p.pain}</span>
                    </li>
                  ))}
                </ul>
              )}
          </div>
        )}

        {bible.nonNegotiables && bible.nonNegotiables.length > 0 && (
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3 mb-2">
              Never
            </div>
            <ul className="space-y-1">
              {bible.nonNegotiables.slice(0, 3).map((n, i) => (
                <li
                  key={i}
                  className="text-xs text-text-2 flex items-start gap-2"
                >
                  <span className="text-danger">×</span>
                  <span>{n}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </GlassCard>

      {showModal && (
        <BrandBibleModal
          project={project}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
}

// Tiny dot-on-track display of a 0-10 voice score. We map 0..10 → 0..100%
// horizontally; the dot sits on a single track without a gradient because
// the spectrum is symmetric (both extremes are valid choices).
function SpectrumBar({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(100, (value / 10) * 100));
  return (
    <div>
      <div className="text-[10px] text-text-3 mb-1">{label}</div>
      <div className="h-1 bg-border rounded-full relative">
        <div
          className="absolute top-1/2 w-2 h-2 bg-accent rounded-full"
          style={{ left: `${pct}%`, transform: 'translate(-50%, -50%)' }}
        />
      </div>
    </div>
  );
}
