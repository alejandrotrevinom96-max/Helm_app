'use client';

import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';
import { Skeleton } from '@/components/ui/skeleton';
import { CompassDial } from './compass-dial';
import { DimensionBreakdown } from './dimension-breakdown';
import { ScoreHistory } from './score-history';
import { RecommendationsList } from './recommendations-list';
import { InsightsThesis } from './insights-thesis';
import {
  CompassFormModal,
  type CompassFormData,
} from './compass-form-modal';
import type { CompassReading } from '@/lib/types/compass';

interface HistoryRow {
  id: string;
  totalScore: number;
  band: string;
  dataQuality: number;
  computedBy: string;
  createdAt: string | Date;
}

interface Props {
  project: { id: string; name: string };
  hasMultipleProjects: boolean;
}

export function CompassClient({ project }: Props) {
  const [reading, setReading] = useState<CompassReading | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);
  const [showFormModal, setShowFormModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [latestRes, historyRes] = await Promise.all([
        fetch(`/api/compass/latest?projectId=${project.id}`),
        fetch(`/api/compass/history?projectId=${project.id}`),
      ]);
      const latestData = await latestRes.json();
      const historyData = await historyRes.json();
      setReading(latestData.reading ?? null);
      setHistory(historyData.readings ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const recompute = async (formData: CompassFormData) => {
    setComputing(true);
    setError(null);
    try {
      const res = await fetch('/api/compass/compute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          formData,
          computedBy: 'manual',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.hint ?? data.error ?? 'Compute failed');
        return;
      }
      await fetchData();
      setShowFormModal(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setComputing(false);
    }
  };

  const previousFormData = (reading?.formData as CompassFormData | undefined) ?? {};

  return (
    <div className="p-6 md:p-10 max-w-6xl">
      <div className="flex justify-between items-start mb-8 gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="font-display text-display-lg font-light tracking-tight">
            Compass
          </h1>
          <p className="text-text-2 text-sm mt-1">
            Score your project across 5 dimensions backed by VC research.
          </p>
        </div>
        <Button onClick={() => setShowFormModal(true)} disabled={computing}>
          {computing
            ? 'Computing…'
            : reading
              ? 'Recompute'
              : 'Compute reading'}
        </Button>
      </div>

      {error && (
        <GlassCard className="p-4 mb-6 border border-red-500/40">
          <p className="text-sm text-red-500">⚠ {error}</p>
        </GlassCard>
      )}

      {loading ? (
        <div className="space-y-6">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : !reading ? (
        <GlassCard className="p-8 text-center">
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
            No reading yet
          </div>
          <h2 className="font-display text-2xl font-light mb-3">
            Cast your first compass reading
          </h2>
          <p className="text-sm text-text-2 mb-6 max-w-md mx-auto">
            Helm will analyze your project across 5 dimensions: Validation,
            Strategy, Execution, Traction, and Market. Most data is auto-pulled
            from your Helm data — you&apos;ll only answer ~10 questions for
            what isn&apos;t.
          </p>
          <Button onClick={() => setShowFormModal(true)} size="lg">
            Begin reading →
          </Button>
        </GlassCard>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <CompassDial reading={reading} />
            </div>
            <ScoreHistory history={history} />
          </div>

          <InsightsThesis reading={reading} />
          <RecommendationsList reading={reading} />
          <DimensionBreakdown reading={reading} />

          <GlassCard className="p-4">
            <div className="text-xs text-text-3">
              Reading computed{' '}
              {new Date(reading.createdAt).toLocaleString()} · Data quality:{' '}
              {reading.dataQuality}/100 ·{' '}
              {reading.computedBy === 'auto' ? 'Auto-computed' : 'Manual'}
            </div>
          </GlassCard>
        </div>
      )}

      {showFormModal && (
        <CompassFormModal
          previousFormData={previousFormData}
          onSubmit={recompute}
          onClose={() => setShowFormModal(false)}
          computing={computing}
        />
      )}
    </div>
  );
}
