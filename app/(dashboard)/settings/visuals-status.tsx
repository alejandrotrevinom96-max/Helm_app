'use client';

// PR Sprint 7.25 Phase 2 — repainted on top of the platform redesign
// (purple-glow card, "Active" / "Not configured" status pill next
// to the h2). API hookup (/api/settings/visuals-status) is unchanged.
import { useEffect, useState } from 'react';

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
    <section className="platform-card platform-card-glow-purple platform-reveal-4">
      <div className="platform-lbl">Visual generation</div>
      <h2 className="platform-h2">
        Image generation
        <span
          className={
            enabled
              ? 'platform-status'
              : 'platform-status platform-status-off'
          }
        >
          {enabled ? 'Active' : 'Not configured'}
        </span>
      </h2>

      {enabled ? (
        <p className="platform-desc">
          Helm generates AI visuals automatically for each post — using your
          brand bible&apos;s palette, archetype and reference photos.
        </p>
      ) : (
        <>
          <p className="platform-desc">
            Visual generation is not currently configured. Posts will be
            generated without images.
          </p>
          <p className="platform-field-help" style={{ marginTop: '10px' }}>
            Visual generation requires an image-provider API key in the
            deployment environment. Contact the workspace owner if you need
            this enabled.
          </p>
        </>
      )}
    </section>
  );
}
