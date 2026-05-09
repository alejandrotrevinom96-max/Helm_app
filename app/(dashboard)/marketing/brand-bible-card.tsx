'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';
import { BrandBibleModal } from './brand-bible-modal';
import { showToast } from '@/components/toast/toast';
import type { BrandBible } from '@/lib/types/brand';
import type { VoiceFingerprint } from '@/lib/types/voice';

export interface BrandProject {
  id: string;
  name: string;
  brandUrl: string | null;
  brandContext: BrandBible | null;
  // PR #50 — Sprint 6.8.1: optional fingerprint passed from the
  // parent server component. When present, the card renders a
  // dedicated Voice Fingerprint section + a "Re-analyze" button.
  // Optional so legacy usages of <BrandBibleCard> don't have to
  // change shape if the fingerprint isn't ready yet.
  voiceFingerprint?: VoiceFingerprint | null;
  voiceFingerprintUpdatedAt?: string | null;
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

        {/* PR #50 — Sprint 6.8.1: Voice Fingerprint section.
            Pre-PR-50 the fingerprint was computed (Sprint 6.8) +
            persisted (projects.voice_fingerprint) but invisible
            to the founder. Now they can see the patterns Helm
            inferred from their Quote Vault, plus a Re-analyze
            button to refresh after editing quotes. */}
        <VoiceFingerprintSection
          projectId={project.id}
          fingerprint={project.voiceFingerprint ?? null}
          updatedAt={project.voiceFingerprintUpdatedAt ?? null}
        />

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

// PR #50 — Sprint 6.8.1: Voice Fingerprint display.
//
// Renders the 5 abstract pattern arrays (structural / vocabulary /
// signature / tone / avoid) as labeled chip groups, plus a small
// "derived from N quotes · last updated X ago" caption and a
// Re-analyze button that re-triggers /api/marketing/voice/analyze.
//
// When no fingerprint exists yet (project < 3 quotes or never
// analyzed), the section is a CTA stub pointing at the Quote
// Vault. We show it in both states because the founder learning
// "where to add quotes" is half the value.
function VoiceFingerprintSection({
  projectId,
  fingerprint,
  updatedAt,
}: {
  projectId: string;
  fingerprint: VoiceFingerprint | null;
  updatedAt: string | null;
}) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const handleReanalyze = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const res = await fetch('/api/marketing/voice/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(
          (data as { error?: string }).error ??
            'Could not re-analyze voice',
          'error'
        );
        return;
      }
      showToast('Voice fingerprint updated', 'sparkle');
      // Server already revalidatePath'd /marketing/generate; the
      // refresh below picks up the new fingerprint on this page.
      router.refresh();
    } catch {
      showToast('Could not re-analyze voice', 'error');
    } finally {
      setRefreshing(false);
    }
  };

  // Empty state — quotes haven't reached the threshold or analyze
  // never ran. Same layout footprint so the card doesn't reflow
  // when the fingerprint becomes available.
  if (!fingerprint) {
    return (
      <div className="mb-4">
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3">
            Voice fingerprint
          </div>
        </div>
        <p className="text-xs text-text-2 leading-relaxed">
          Add 3+ quotes to your Quote Vault and Helm will derive an
          abstract voice fingerprint (structure, vocabulary, tone)
          that the writer uses without copying your exact words.
        </p>
      </div>
    );
  }

  return (
    <div className="mb-4">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3">
          Voice fingerprint
        </div>
        <button
          type="button"
          onClick={handleReanalyze}
          disabled={refreshing}
          className="text-[10px] text-accent hover:underline disabled:opacity-50 whitespace-nowrap"
          title="Re-run Opus voice analysis on the current Quote Vault"
        >
          {refreshing ? 'Analyzing…' : '↻ Re-analyze'}
        </button>
      </div>
      <p className="text-[10px] text-text-3 mb-3">
        Derived from {fingerprint.sourceQuotesCount} quote
        {fingerprint.sourceQuotesCount === 1 ? '' : 's'}
        {updatedAt && (
          <>
            {' '}· updated {formatRelativeShort(updatedAt)}
          </>
        )}
      </p>
      <div className="space-y-2">
        <FingerprintChips
          label="Structure"
          items={fingerprint.structuralPatterns}
        />
        <FingerprintChips
          label="Vocabulary"
          items={fingerprint.vocabularyTraits}
        />
        <FingerprintChips
          label="Signature"
          items={fingerprint.signaturePhrasings}
        />
        <FingerprintChips label="Tone" items={fingerprint.toneCharacteristics} />
        <FingerprintChips
          label="Avoid"
          items={fingerprint.avoidPatterns}
          tone="warn"
        />
      </div>
    </div>
  );
}

function FingerprintChips({
  label,
  items,
  tone = 'neutral',
}: {
  label: string;
  items: string[];
  tone?: 'neutral' | 'warn';
}) {
  if (!items || items.length === 0) return null;
  const chipClass =
    tone === 'warn'
      ? 'bg-amber-500/10 border-amber-500/30 text-amber-500'
      : 'bg-bg-elev/60 border-border text-text-2';
  return (
    <div>
      <div className="text-[9px] font-mono uppercase tracking-wider text-text-3 mb-1">
        {label}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item, i) => (
          <span
            key={i}
            className={`text-[11px] px-2 py-0.5 rounded-full border ${chipClass} max-w-full`}
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

// Compact "2h ago / 3d ago" formatter — avoids pulling date-fns
// just for one timestamp. Falls back to a date string for things
// older than a week.
function formatRelativeShort(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const min = 60 * 1000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) return 'just now';
  if (diff < hour) return `${Math.round(diff / min)}m ago`;
  if (diff < day) return `${Math.round(diff / hour)}h ago`;
  if (diff < 7 * day) return `${Math.round(diff / day)}d ago`;
  return new Date(iso).toLocaleDateString();
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
