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
        <p className="text-sm text-text-2 mb-2">
          Helm generates AI visuals automatically for each post.
        </p>
      ) : (
        <>
          <p className="text-sm text-text-2 mb-3">
            Visual generation is not currently configured. Posts will be
            generated without images.
          </p>
          <p className="text-xs text-text-3">
            Visual generation requires an image-provider API key in the
            deployment environment. Contact the workspace owner if you
            need this enabled.
          </p>
        </>
      )}
    </GlassCard>
  );
}
