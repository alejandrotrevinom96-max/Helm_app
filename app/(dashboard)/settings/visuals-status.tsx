'use client';

import { useEffect, useState } from 'react';
import { GlassCard } from '@/components/ui/glass-card';

export function VisualsStatus() {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/settings/visuals-status')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setEnabled(!!d.falConfigured);
      })
      .catch(() => {
        if (cancelled) return;
        setEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (enabled === null) return null;

  return (
    <GlassCard className="p-6">
      <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
        Visual generation
      </div>
      <h3 className="font-display text-xl font-light mb-3">
        Image generation · {enabled ? 'Active' : 'Not configured'}
      </h3>

      {enabled ? (
        <>
          <p className="text-sm text-text-2 mb-2">
            Helm uses fal.ai Flux Pro to generate visuals automatically for
            each post.
          </p>
          <div className="grid grid-cols-2 gap-4 text-xs mt-4 pt-4 border-t border-border">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3 mb-1">
                Cost per image
              </div>
              <div className="text-text-1">$0.05 USD</div>
            </div>
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3 mb-1">
                Provider
              </div>
              <div className="text-text-1">fal.ai · Flux Pro v1.1</div>
            </div>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-text-2 mb-3">
            Visual generation is not currently configured. Posts will be
            generated without images.
          </p>
          <p className="text-xs text-text-3">
            To enable: add{' '}
            <code className="bg-bg-elev px-1 py-0.5 rounded">FAL_API_KEY</code>{' '}
            to your Vercel environment variables. Get a key at{' '}
            <a
              href="https://fal.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              fal.ai
            </a>
            .
          </p>
        </>
      )}
    </GlassCard>
  );
}
