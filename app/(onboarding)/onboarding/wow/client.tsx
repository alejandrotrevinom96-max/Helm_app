'use client';

// PR Sprint onboarding-wow — Cambio D.
//
// /onboarding/wow client. The "wow moment" of the new-project flow:
// the founder lands here after /onboarding/brand and we IMMEDIATELY
// auto-fire two backends in parallel:
//
//   1. POST /api/ai/generate-structured (wowMode=true) →
//      3 structured drafts on Instagram (carousel + photo + reel).
//      Returns draftIds[] when at least one Opus call succeeded.
//
//   2. POST /api/photo-agent/sessions (autoApproveForOnboarding=true) →
//      one rendered visual with the approval gate bypassed.
//      Returns the session row in 'awaiting_visual_feedback' on
//      success or 'visual_failed' on render failure.
//
// Both auto-fires use the BrandBible's valueProp + primaryPain
// (Cambio A) as the prompt anchors so the output feels brand-
// specific without the founder typing anything. The page polls
// nothing — both POSTs return INLINE with the final payload (the
// generate-structured route is synchronous; the photo-agent POST
// inline-fires fal.ai for the autoApprove path).
//
// State machine:
//   'pending'    → first render, useEffect about to fire
//   'generating' → both POSTs in flight, render loader
//   'ready'      → both succeeded, render drafts + visual + CTA
//   'partial'    → one succeeded, one failed (still useful — show
//                  what we got + a softer "open Library" CTA)
//   'failed'     → both failed → render fallback "go to Library"
//
// Sentry events (tags: area='onboarding' kind='wow-moment'):
//   - onboarding_wow_started — useEffect fires
//   - onboarding_wow_completed — state lands on 'ready' or 'partial'
//   - onboarding_wow_failed — state lands on 'failed'
// (The granular per-API events live in the backend routes.)

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as Sentry from '@sentry/nextjs';
import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';
import { StepIndicator } from '@/components/onboarding/step-indicator';
import { StructuredDraftCard } from '@/components/marketing/StructuredDraftCard';
import { ShipsWheelLoader } from '@/components/ui/loaders';

interface Props {
  projectId: string;
  projectName: string;
  valueProp: string;
  primaryPain: string;
}

interface DraftPayload {
  id: string;
  contentType: string;
  displayName: string;
  structuredContent: unknown;
  consistencyScore?: number | null;
  error?: string;
  errorHint?: string;
}

interface PhotoSessionPayload {
  id: string;
  state: string;
  visualUrl: string | null;
  visualWidth: number | null;
  visualHeight: number | null;
  errorMessage: string | null;
}

type WowState = 'pending' | 'generating' | 'ready' | 'partial' | 'failed';

// Instagram is the most universal first-platform choice for a brand-
// new founder. The three content types span the three "shapes" the
// founder might want to ship: long-form (carousel), single-image
// (photo), and short video (reel). The reel queues a HeyGen job in
// the background that the Library renders as "Video queued —
// coming soon" until HEYGEN_ENABLED flips on.
const WOW_PLATFORM = 'instagram';
const WOW_TYPES = ['carousel', 'photo', 'reel'];

export function WowClient({
  projectId,
  projectName,
  valueProp,
  primaryPain,
}: Props) {
  const router = useRouter();
  const [wow, setWow] = useState<WowState>('pending');
  const [drafts, setDrafts] = useState<DraftPayload[]>([]);
  const [photo, setPhoto] = useState<PhotoSessionPayload | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  // React 18 strict-mode double-mount + nav-driven re-mount dedupe.
  // Without this we'd fire the (expensive) generate pair twice on
  // the first paint.
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;

    const t0 = Date.now();
    Sentry.captureMessage('onboarding_wow_started', {
      level: 'info',
      tags: { area: 'onboarding', kind: 'wow-moment' },
      extra: { projectId, valuePropLen: valueProp.length, primaryPainLen: primaryPain.length },
    });

    // Compose prompts. Both APIs see the same valueProp + primaryPain
    // pair — the generate-structured prompt is brand-context-shaped
    // (drives Opus content), the photo-agent prompt has explicit
    // "photo" hinting so inferAssetTypeFromText returns 'photo' and
    // the fast-path concept refiner kicks in.
    const draftPrompt =
      `Audience pain: ${primaryPain}. Value the brand delivers: ${valueProp}.\n\n` +
      `Generate content that names the pain in the audience's own words and ` +
      `lands the value cleanly. No generic intro fluff — be specific to this brand.`;
    const photoPrompt =
      `A single Instagram photo for this brand. ` +
      `Audience pain: ${primaryPain}. Brand value: ${valueProp}. ` +
      `Visual style: clean, modern, brand-aligned. Single subject, strong composition.`;

    let generateOk = false;
    let photoOk = false;

    // PR Sprint onboarding-wow polish — Cambio E. Defensive JSON
    // parse for both auto-fired endpoints. Pre-fix the founder
    // saw "Unexpected end of JSON input" pop into the error
    // surface whenever either backend returned an empty body or
    // an HTML error page (Vercel cold-start timeouts, gateway
    // 5xx, etc.). Now: read text first, try JSON.parse, capture
    // the raw body to Sentry on failure so on-call has the actual
    // payload to debug, and surface a clean error to the founder.
    const safeParseJson = async <T,>(
      res: Response,
      area: 'generate-structured' | 'photo-agent',
    ): Promise<{ ok: true; data: T } | { ok: false; error: string }> => {
      let raw = '';
      try {
        raw = await res.text();
      } catch (readErr) {
        Sentry.captureException(readErr, {
          tags: { area: 'onboarding', kind: 'wow-moment-body-read' },
          extra: { upstream: area, status: res.status },
        });
        return {
          ok: false,
          error: `${area === 'generate-structured' ? 'Drafts' : 'Photo'} response could not be read.`,
        };
      }
      if (!raw.trim()) {
        Sentry.captureMessage('onboarding_wow_empty_body', {
          level: 'warning',
          tags: { area: 'onboarding', kind: 'wow-moment-empty-body' },
          extra: { upstream: area, status: res.status },
        });
        return {
          ok: false,
          error: `${area === 'generate-structured' ? 'Drafts' : 'Photo'} server returned an empty response. Try again.`,
        };
      }
      try {
        return { ok: true, data: JSON.parse(raw) as T };
      } catch (parseErr) {
        Sentry.captureException(parseErr, {
          tags: { area: 'onboarding', kind: 'wow-moment-json-parse' },
          extra: {
            upstream: area,
            status: res.status,
            // Cap to keep Sentry payload small; the prefix is
            // usually enough to tell HTML-error-page from
            // truncated-JSON from non-JSON-string.
            rawBodySnippet: raw.slice(0, 800),
            rawBodyLen: raw.length,
          },
        });
        return {
          ok: false,
          error:
            "We received an unexpected response from the server. Try refreshing — your brand bible is already saved.",
        };
      }
    };

    const fireGenerate = async (): Promise<void> => {
      setWow('generating');
      try {
        const res = await fetch('/api/ai/generate-structured', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId,
            platform: WOW_PLATFORM,
            types: WOW_TYPES,
            prompt: draftPrompt,
            wowMode: true,
          }),
        });
        const parsed = await safeParseJson<{
          success?: boolean;
          drafts?: DraftPayload[];
          draftIds?: string[];
          error?: string;
          hint?: string;
        }>(res, 'generate-structured');
        if (!parsed.ok) {
          setGenError(parsed.error);
          return;
        }
        const data = parsed.data;
        if (!res.ok || data.success === false) {
          setGenError(
            data.hint ?? data.error ?? 'Draft generation failed.',
          );
          // Even on top-level failure, the backend returns the
          // per-type drafts (some may have succeeded). Surface
          // whichever ones did.
          if (Array.isArray(data.drafts)) {
            setDrafts(data.drafts);
            generateOk = data.drafts.some((d) => d.structuredContent != null);
          }
          return;
        }
        if (Array.isArray(data.drafts)) {
          setDrafts(data.drafts);
          generateOk = data.drafts.some((d) => d.structuredContent != null);
        }
      } catch (err) {
        Sentry.captureException(err, {
          tags: { area: 'onboarding', kind: 'wow-moment-fetch-threw' },
          extra: { upstream: 'generate-structured' },
        });
        setGenError(
          err instanceof Error ? err.message : 'Network error generating drafts.',
        );
      }
    };

    const firePhoto = async (): Promise<void> => {
      try {
        const res = await fetch('/api/photo-agent/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId,
            prompt: photoPrompt,
            autoApproveForOnboarding: true,
          }),
        });
        const parsed = await safeParseJson<{
          session?: PhotoSessionPayload;
          error?: string;
        }>(res, 'photo-agent');
        if (!parsed.ok) {
          setPhotoError(parsed.error);
          return;
        }
        const data = parsed.data;
        if (!res.ok || !data.session) {
          setPhotoError(data.error ?? 'Photo generation failed.');
          return;
        }
        setPhoto(data.session);
        photoOk =
          data.session.state === 'awaiting_visual_feedback' &&
          !!data.session.visualUrl;
        if (!photoOk) {
          setPhotoError(
            data.session.errorMessage ??
              'Photo rendered with no usable image. You can retry from your Library.',
          );
        }
      } catch (err) {
        Sentry.captureException(err, {
          tags: { area: 'onboarding', kind: 'wow-moment-fetch-threw' },
          extra: { upstream: 'photo-agent' },
        });
        setPhotoError(
          err instanceof Error ? err.message : 'Network error generating photo.',
        );
      }
    };

    // Fire in parallel. Both routes have ~60s maxDuration; the
    // longer path is photo-agent (Opus refine + fal.ai render
    // ~30-40s). The page renders a single loader until both
    // settle so the founder doesn't see one card pop in and then
    // another 20s later.
    Promise.all([fireGenerate(), firePhoto()]).then(() => {
      const elapsedMs = Date.now() - t0;
      if (generateOk && photoOk) {
        setWow('ready');
        Sentry.captureMessage('onboarding_wow_completed', {
          level: 'info',
          tags: { area: 'onboarding', kind: 'wow-moment' },
          extra: { projectId, elapsedMs, photoOk: true },
        });
      } else if (generateOk || photoOk) {
        setWow('partial');
        Sentry.captureMessage('onboarding_wow_completed', {
          level: 'info',
          tags: { area: 'onboarding', kind: 'wow-moment' },
          extra: {
            projectId,
            elapsedMs,
            partial: true,
            generateOk,
            photoOk,
          },
        });
      } else {
        setWow('failed');
        Sentry.captureMessage('onboarding_wow_failed', {
          level: 'warning',
          tags: { area: 'onboarding', kind: 'wow-moment' },
          extra: {
            projectId,
            elapsedMs,
          },
        });
      }
    });
    // The firedRef guard makes this effect single-shot; safe to
    // include only the static inputs from the server shell.
  }, [projectId, valueProp, primaryPain]);

  const goLibrary = () => {
    router.push(`/marketing/library?projectId=${encodeURIComponent(projectId)}`);
  };

  return (
    <div
      style={{
        maxWidth: '1100px',
        margin: '0 auto',
        padding: '32px 24px 96px',
      }}
    >
      <StepIndicator current={3} total={3} />

      <h1
        style={{
          fontSize: '28px',
          fontWeight: 600,
          marginBottom: '8px',
          color: 'var(--text-1)',
        }}
      >
        {/* PR Sprint onboarding-wow polish — Cambio F. Both the
            'ready' and 'partial' states surface the same
            celebratory headline ("Your first assets are ready.")
            so a single failed sub-call doesn't feel like a
            consolation prize. The per-item error chip below
            still tells the founder which one to retry. */}
        {wow === 'ready' || wow === 'partial'
          ? 'Your first assets are ready.'
          : wow === 'failed'
            ? `${projectName} setup hit a snag.`
            : `We're warming up ${projectName}…`}
      </h1>
      <p
        style={{
          fontSize: '15px',
          color: 'var(--text-2)',
          marginBottom: '32px',
          maxWidth: '720px',
        }}
      >
        {wow === 'ready' || wow === 'partial'
          ? "Three drafts and your first visual — generated from your brand bible. Open the Library to iterate, schedule, or publish."
          : wow === 'failed'
            ? "We couldn't auto-generate this round. Head to your Library to compose manually — your brand bible is already saved."
            : "We're using your brand bible to generate three first drafts plus a rendered visual. Usually takes 30-45 seconds."}
      </p>

      {(wow === 'pending' || wow === 'generating') && (
        <GlassCard
          style={{
            padding: '48px 32px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '20px',
          }}
        >
          <ShipsWheelLoader />
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                fontSize: '14px',
                color: 'var(--text-1)',
                fontWeight: 500,
                marginBottom: '4px',
              }}
            >
              Generating drafts + visual…
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-3)' }}>
              Carousel · Photo · Reel · Rendered image
            </div>
          </div>
        </GlassCard>
      )}

      {(wow === 'ready' || wow === 'partial') && (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
              gap: '20px',
              marginBottom: '32px',
            }}
          >
            {drafts.map((d) => (
              <StructuredDraftCard
                key={d.id || d.contentType}
                platform={WOW_PLATFORM}
                contentType={d.contentType}
                displayName={d.displayName}
                structuredContent={d.structuredContent}
                error={d.error}
                draftId={d.id}
                consistencyScore={d.consistencyScore ?? null}
                projectId={projectId}
              />
            ))}
            {photo?.visualUrl && (
              <GlassCard
                style={{
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                <div
                  style={{
                    fontSize: '11px',
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: 'var(--text-3)',
                    fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                  }}
                >
                  Rendered visual
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.visualUrl}
                  alt="Generated visual"
                  style={{
                    width: '100%',
                    aspectRatio:
                      photo.visualWidth && photo.visualHeight
                        ? `${photo.visualWidth}/${photo.visualHeight}`
                        : '4/5',
                    objectFit: 'cover',
                    borderRadius: '8px',
                  }}
                />
                <div style={{ fontSize: '12px', color: 'var(--text-3)' }}>
                  Open your Library to add a caption + schedule.
                </div>
              </GlassCard>
            )}
          </div>

          {(genError || photoError) && (
            <GlassCard
              style={{
                padding: '16px',
                marginBottom: '24px',
                borderColor: 'rgba(249,115,22,0.4)',
              }}
            >
              <div
                style={{
                  fontSize: '12px',
                  color: 'var(--text-2)',
                  marginBottom: '6px',
                  fontWeight: 500,
                }}
              >
                A couple of items didn't land — you can retry from the Library:
              </div>
              {genError && (
                <div style={{ fontSize: '12px', color: 'var(--text-3)' }}>
                  • Drafts: {genError}
                </div>
              )}
              {photoError && (
                <div style={{ fontSize: '12px', color: 'var(--text-3)' }}>
                  • Visual: {photoError}
                </div>
              )}
            </GlassCard>
          )}
        </>
      )}

      {wow === 'failed' && (
        <GlassCard
          style={{
            padding: '24px',
            marginBottom: '24px',
            borderColor: 'rgba(249,115,22,0.4)',
          }}
        >
          <div
            style={{
              fontSize: '14px',
              color: 'var(--text-1)',
              marginBottom: '8px',
              fontWeight: 500,
            }}
          >
            We couldn't generate any first content this round.
          </div>
          <div style={{ fontSize: '13px', color: 'var(--text-2)' }}>
            Your brand bible is saved — open the Library to compose manually,
            or refresh this page to retry. (Daily auto-generate cap: 3.)
          </div>
          {(genError || photoError) && (
            <div
              style={{
                fontSize: '12px',
                color: 'var(--text-3)',
                marginTop: '12px',
              }}
            >
              {genError && <div>Drafts: {genError}</div>}
              {photoError && <div>Visual: {photoError}</div>}
            </div>
          )}
        </GlassCard>
      )}

      {(wow === 'ready' || wow === 'partial' || wow === 'failed') && (
        <div
          style={{
            display: 'flex',
            gap: '12px',
            justifyContent: 'flex-end',
          }}
        >
          <Button onClick={goLibrary}>
            Take me to my Library →
          </Button>
        </div>
      )}
    </div>
  );
}
