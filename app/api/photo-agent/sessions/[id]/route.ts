// PR Sprint D-8 Phase 2 — single Photo Studio session endpoint.
//
// GET /api/photo-agent/sessions/[id]
//   Returns the persisted session. No external API call — Photo
//   Studio has no upstream chat agent to poll (unlike HeyGen V3).
//   The session is fully driven by POST below.
//
// POST /api/photo-agent/sessions/[id]
//   Body shapes:
//     { kind: 'message', text }
//       — free-text founder reply. Runs the intent classifier
//         and dispatches the appropriate state transition.
//     { kind: 'action', action: 'pick_type', assetType, uploadedAssetUrl? }
//       — explicit asset-type pick from the chip rail.
//     { kind: 'action', action: 'approve_visual' | 'regenerate_visual' }
//     { kind: 'action', action: 'set_platforms', platforms[] }
//     { kind: 'action', action: 'approve_platforms' }
//     { kind: 'action', action: 'regenerate_copy', platform, direction? }
//     { kind: 'action', action: 'approve_copies' }
//
//   CRITICAL: every state transition runs through canTransition().
//   Auto-render bugs (HeyGen-style) cannot happen here — the
//   backend refuses to advance past awaiting_* without an explicit
//   user-initiated action.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  photoAgentSessions,
  contentAssets,
  generatedPosts,
  projects,
  researchInsights,
  type PhotoAgentSessionRow,
} from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import * as Sentry from '@sentry/nextjs';
import type { BrandBible } from '@/lib/types/brand';
import {
  canTransition,
  type PhotoSessionState,
} from '@/lib/photo-agent/stateMachine';
import {
  classifyIntent,
  inferAssetTypeFromText,
} from '@/lib/photo-agent/intentClassifier';
import { refineConcept } from '@/lib/photo-agent/conceptBuilder';
import {
  generateCopies,
  regenerateOne,
  type PerPlatformCopy,
} from '@/lib/photo-agent/copyGenerator';
import {
  generateVisual,
  type VisualResult,
} from '@/lib/visuals/generate';

// PR Sprint D-finish — pain-point shape for the in-memory lookup
// below. Same shape as elsewhere; duplicated here so we don't
// drag the entire research types module into this route.
interface PainPointShape {
  id?: string;
  theme?: string;
  sampleQuote?: string;
}

// PR Sprint D-finish — wrap generateVisual with diagnostic env
// check + pain-point pass-through + Sentry-rich failure surfacing.
//
// Why this exists: the bare generateVisual() returns null on every
// kind of failure (env missing, fal.ai crash, IR pipeline reject,
// empty image URL) and the founder saw a generic "Visual generation
// failed" message that gave us nothing to debug. This wrapper:
//
//   1. Bails early with a precise message if FAL_API_KEY isn't
//      configured for the deployment.
//   2. Fetches the painPoint theme (if the session was seeded
//      from one) so the IR pipeline path can actually fire —
//      the IR gate requires painPoint, and without it we silently
//      fall back to the legacy builder which itself sometimes
//      returns null on thin concepts.
//   3. Wraps the call in try/catch + Sentry capture so we see WHY
//      it failed in Sentry instead of a black-box null.
//   4. Returns a discriminated union so callers can render the
//      specific reason in the chat thread.
async function tryGenerateVisual(args: {
  concept: string;
  brandBible: BrandBible | null;
  assetType: 'photo' | 'carousel' | 'upload' | null;
  painPointId: string | null;
  userId: string;
  rowId: string;
}): Promise<
  | { ok: true; visual: VisualResult }
  | { ok: false; error: string }
> {
  if (!process.env.FAL_API_KEY) {
    Sentry.captureMessage('photo_agent_fal_key_missing', {
      level: 'error',
      tags: { area: 'photo-agent', kind: 'env-misconfigured' },
      extra: { rowId: args.rowId },
    });
    return {
      ok: false,
      error:
        'Visual generation is not configured (FAL_API_KEY missing in deployment). Tell your admin to add it in Vercel project env.',
    };
  }
  if (args.concept.trim().length < 12) {
    return {
      ok: false,
      error:
        'Concept is too thin to render (under 12 chars). Reply with a more specific description first.',
    };
  }

  // Fetch the pain point theme if the session was seeded from
  // one. Required for the IR pipeline path. Best-effort — if the
  // lookup fails we just fall through to the legacy builder.
  let painPointTheme: string | null = null;
  if (args.painPointId) {
    try {
      const rows = await db
        .select({ painPoints: researchInsights.painPoints })
        .from(researchInsights)
        .innerJoin(projects, eq(projects.id, researchInsights.projectId))
        .where(eq(projects.userId, args.userId))
        .limit(200);
      for (const row of rows) {
        const arr = Array.isArray(row.painPoints)
          ? (row.painPoints as PainPointShape[])
          : [];
        const hit = arr.find((p) => p?.id === args.painPointId);
        if (hit?.theme) {
          painPointTheme = hit.theme;
          break;
        }
      }
    } catch {
      /* non-fatal */
    }
  }

  // PR Sprint D-bugs — single-shot retry with 2s backoff.
  // Most fal.ai null returns we see are transient (Flux server
  // hiccups, rate-limit blips). A second try almost always
  // succeeds; the cost of one extra attempt is ~$0.05.
  //
  // Each attempt's failure mode + duration is captured to
  // Sentry so we can tell flaky fal.ai from a systemic concept
  // problem when triaging.
  const callOnce = async (
    attemptIdx: number,
  ): Promise<
    | { ok: true; visual: VisualResult }
    | { ok: false; error: string; threw: boolean }
  > => {
    const t0 = Date.now();
    try {
      const visual = await generateVisual({
        platform: 'instagram',
        postContent: args.concept,
        brandBible: args.brandBible,
        contentType: args.assetType === 'carousel' ? 'carousel' : 'photo',
        aspectRatio: args.assetType === 'carousel' ? 'square' : 'portrait',
        // PR Sprint D-finish — pass painPoint so the IR pipeline
        // gate fires (it requires painPoint to use the modern
        // brand-aware builder). When null, generateVisual falls
        // back to the legacy builder; either path is acceptable
        // but IR produces visibly better Flux output.
        painPoint: painPointTheme ?? undefined,
      });
      if (!visual) {
        Sentry.captureMessage('photo_agent_visual_null', {
          level: 'error',
          tags: {
            area: 'photo-agent',
            kind: 'visual-null',
            attempt: String(attemptIdx),
          },
          extra: {
            rowId: args.rowId,
            assetType: args.assetType,
            conceptLen: args.concept.length,
            concept: args.concept.slice(0, 1000),
            hadPainPoint: Boolean(painPointTheme),
            painPointTheme: painPointTheme?.slice(0, 200) ?? null,
            elapsedMs: Date.now() - t0,
          },
        });
        return {
          ok: false,
          // PR Sprint UGC+Photo final — anti-naming. Founder
          // sees the `error` string verbatim in the chat thread,
          // so it must not mention the upstream provider. The
          // full provider-specific detail is in Sentry (tag
          // area=photo-agent kind=visual-null) where on-call
          // looks anyway.
          error:
            "The image generator returned no result. Try again, or refine the concept with more specifics.",
          threw: false,
        };
      }
      return { ok: true, visual };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Sentry.captureException(e, {
        tags: {
          area: 'photo-agent',
          kind: 'visual-threw',
          attempt: String(attemptIdx),
        },
        extra: {
          rowId: args.rowId,
          assetType: args.assetType,
          conceptLen: args.concept.length,
          concept: args.concept.slice(0, 1000),
          hadPainPoint: Boolean(painPointTheme),
          elapsedMs: Date.now() - t0,
        },
      });
      return {
        ok: false,
        // PR Sprint UGC+Photo final — anti-naming. Don't echo
        // the raw upstream exception (which often quotes
        // provider library names like "fal" or "FluxClient");
        // surface a generic message. The full exception is in
        // Sentry already (captureException above).
        error: 'Image generation hit an unexpected error. Try again — refresh the concept if it keeps failing.',
        threw: true,
      };
    }
  };

  const first = await callOnce(1);
  if (first.ok) return first;
  // Don't retry on env / config errors — the second call would
  // fail the same way. Only retry on null returns / network
  // throws; those are typically transient.
  await new Promise((r) => setTimeout(r, 2000));
  const second = await callOnce(2);
  if (second.ok) return second;
  // Surface a slightly different message after two failures so
  // the founder knows we already tried twice. Anti-naming: the
  // upstream provider stays out of the founder's view; Sentry
  // tags capture which provider hiccuped.
  return {
    ok: false,
    error:
      'Image generation is having a moment after two tries. Refine the concept with more specifics, or try again in a minute.',
  };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const maxDuration = 60;

interface ChatMessage {
  role: 'user' | 'agent';
  content: string;
  kind: 'text' | 'system' | 'visual' | 'platforms' | 'copies';
  createdAt: number;
}

function serialize(row: PhotoAgentSessionRow) {
  // PR Sprint UGC+Photo paridad — expose approval-gate state to
  // the client. The state machine already pins `state` at
  // 'reviewing_concept' when the gate is active, but we surface
  // approvalGateActive + approvalGateAt explicitly so the
  // client can render gate-aware UI (badges, telemetry chips)
  // without re-deriving from state alone.
  return {
    id: row.id,
    projectId: row.projectId,
    prompt: row.prompt,
    painPointId: row.painPointId,
    state: row.state,
    approvalGateActive: row.approvalGateActive === true,
    approvalGateAt: row.approvalGateAt?.toISOString() ?? null,
    assetType: row.assetType,
    uploadedAssetUrl: row.uploadedAssetUrl,
    concept: row.concept,
    visualUrl: row.visualUrl,
    visualWidth: row.visualWidth,
    visualHeight: row.visualHeight,
    platforms: row.platforms ?? [],
    copies: row.copies ?? [],
    messages: row.messages ?? [],
    contentAssetId: row.contentAssetId,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

async function loadOwned(
  userId: string,
  rowId: string,
): Promise<PhotoAgentSessionRow | null> {
  const [row] = await db
    .select()
    .from(photoAgentSessions)
    .where(
      and(
        eq(photoAgentSessions.id, rowId),
        eq(photoAgentSessions.userId, userId),
      ),
    )
    .limit(1);
  return row ?? null;
}

// Helper — apply a transition + persist. Throws if the transition
// is invalid (callers should validate first; this is the safety
// net).
async function transition(
  row: PhotoAgentSessionRow,
  to: PhotoSessionState,
  updates: Partial<PhotoAgentSessionRow>,
): Promise<PhotoAgentSessionRow> {
  const from = row.state as PhotoSessionState;
  if (!canTransition(from, to)) {
    Sentry.captureMessage('photo_agent_invalid_transition', {
      level: 'error',
      tags: { area: 'photo-agent', kind: 'invalid_transition' },
      extra: { rowId: row.id, from, to },
    });
    throw new Error(`Invalid transition: ${from} → ${to}`);
  }
  const next = {
    ...updates,
    state: to,
    updatedAt: new Date(),
    completedAt:
      to === 'finalized' || to === 'failed' ? new Date() : updates.completedAt,
  };
  await db
    .update(photoAgentSessions)
    .set(next)
    .where(eq(photoAgentSessions.id, row.id));
  return { ...row, ...next } as PhotoAgentSessionRow;
}

// Default platform recommendation. The agent suggests a starter
// set based on visual aspect + asset type; the founder confirms
// or adjusts. Conservative for now — three modern visual networks.
function defaultPlatforms(assetType: string | null): string[] {
  if (assetType === 'carousel') {
    return ['instagram', 'linkedin', 'facebook'];
  }
  return ['instagram', 'tiktok', 'facebook'];
}

// ─── GET ────────────────────────────────────────────────────────

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }
  const row = await loadOwned(user.id, id);
  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ session: serialize(row) });
}

// ─── POST ───────────────────────────────────────────────────────

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }
  const row = await loadOwned(user.id, id);
  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (row.state === 'finalized' || row.state === 'failed') {
    return NextResponse.json(
      { error: 'Session is terminal; start a new one to iterate.' },
      { status: 409 },
    );
  }

  let body: {
    kind?: 'message' | 'action';
    text?: string;
    action?: string;
    assetType?: 'photo' | 'carousel' | 'upload';
    uploadedAssetUrl?: string;
    platforms?: string[];
    platform?: string;
    direction?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const messages = (row.messages ?? []) as ChatMessage[];
  const bibleSnapshot = (row.brandSnapshot as BrandBible | null) ?? null;
  const currentState = row.state as PhotoSessionState;

  // Telemetry helper for unexpected backend behavior. The state
  // machine should make most of these impossible, but the catches
  // help surface UI-side bugs faster.
  const breadcrumb = (msg: string) => {
    Sentry.addBreadcrumb({
      category: 'photo-agent',
      level: 'info',
      message: msg,
      data: { rowId: row.id, state: currentState },
    });
  };

  try {
    // ─── ACTION dispatch ────────────────────────────────────────
    if (body.kind === 'action') {
      const action = body.action ?? '';

      // 1. pick_type → land in awaiting_type_choice with assetType
      //    captured, then immediately ask the agent to refine the
      //    concept based on the existing prompt + chat thread.
      if (action === 'pick_type') {
        const assetType = body.assetType;
        if (assetType !== 'photo' && assetType !== 'carousel' && assetType !== 'upload') {
          return NextResponse.json(
            { error: 'assetType must be photo | carousel | upload' },
            { status: 400 },
          );
        }
        breadcrumb(`pick_type=${assetType}`);
        // Persist the asset type + add a user message so the chat
        // thread reflects the choice.
        const userMsg: ChatMessage = {
          role: 'user',
          content:
            assetType === 'photo'
              ? '📸 Let\'s do a single photo.'
              : assetType === 'carousel'
                ? '📑 Let\'s do a carousel.'
                : '📤 I\'ll upload my own asset.',
          kind: 'system',
          createdAt: Date.now(),
        };
        // Try to refine the concept now. If we don't have enough
        // info yet, the refiner asks one clarifying question and
        // we stay in awaiting_type_choice.
        const refined = await refineConcept({
          brandBible: bibleSnapshot,
          messages: [...messages, userMsg],
          currentConcept: row.concept ?? null,
          assetType,
        });
        const agentMsg: ChatMessage = {
          role: 'agent',
          content: refined.chatReply,
          kind: 'text',
          createdAt: Date.now() + 1,
        };
        const nextMessages = [...messages, userMsg, agentMsg];

        if (refined.ready && refined.concept) {
          // PR Sprint UGC+Photo paridad — concept-review gate.
          //
          // Pre-fix the agent went straight from "I have a
          // concept" to firing fal.ai. Now we land at
          // reviewing_concept first, engage the approval gate,
          // and wait for the founder to explicitly approve or
          // send feedback. Mirror of the UGC Studio flow.
          //
          // Sentry telemetry for the gate engagement is paritary
          // to heygen_agent_gate_engaged so dashboards can grep
          // both kinds with kind=approval-gate.
          Sentry.captureMessage('photo_agent_gate_engaged', {
            level: 'info',
            tags: { area: 'photo-studio', kind: 'approval-gate' },
            extra: {
              sessionId: row.id,
              assetType,
              conceptSnippet: refined.concept.slice(0, 200),
              msgCreatedAtMs: Date.now(),
            },
          });
          const reviewing = await transition(row, 'reviewing_concept', {
            assetType,
            uploadedAssetUrl: body.uploadedAssetUrl ?? null,
            concept: refined.concept,
            messages: nextMessages,
            approvalGateActive: true,
            approvalGateAt: new Date(),
          });
          return NextResponse.json({ session: serialize(reviewing) });
        }

        // Not ready yet — persist the chat exchange + asset type
        // and stay in awaiting_type_choice. Self-transition is
        // valid in the state machine.
        const next = await transition(row, 'awaiting_type_choice', {
          assetType,
          uploadedAssetUrl: body.uploadedAssetUrl ?? null,
          messages: nextMessages,
        });
        return NextResponse.json({ session: serialize(next) });
      }

      // PR Sprint UGC+Photo paridad — 1.5. approve_concept:
      // founder explicitly approves the proposed concept. Clear
      // the gate + fire fal.ai. Mirror of the UGC approve action
      // (which calls /v3/.../approve upstream). Here the
      // "approval" is local — we just stop showing the gate UI
      // and run the Flux pipeline.
      if (action === 'approve_concept') {
        if (currentState !== 'reviewing_concept') {
          return NextResponse.json(
            { error: `Cannot approve concept from state ${currentState}` },
            { status: 409 },
          );
        }
        breadcrumb('approve_concept');
        const userMsg: ChatMessage = {
          role: 'user',
          content: '✓ Approve & generate.',
          kind: 'system',
          createdAt: Date.now(),
        };
        const generating = await transition(row, 'generating_visual', {
          messages: [...messages, userMsg],
          approvalGateActive: false,
          approvalGateAt: new Date(),
        });
        const visualResult = await tryGenerateVisual({
          concept: row.concept ?? '',
          brandBible: bibleSnapshot,
          assetType: row.assetType as
            | 'photo'
            | 'carousel'
            | 'upload'
            | null,
          painPointId: row.painPointId,
          userId: user.id,
          rowId: row.id,
        });
        if (!visualResult.ok) {
          const failMsg: ChatMessage = {
            role: 'agent',
            content: `⚠️ ${visualResult.error}`,
            kind: 'system',
            createdAt: Date.now() + 1,
          };
          const isEnvIssue = visualResult.error.includes('FAL_API_KEY');
          const back = await transition(
            generating,
            isEnvIssue ? 'failed' : 'visual_failed',
            {
              messages: [...messages, userMsg, failMsg],
              errorMessage: isEnvIssue ? visualResult.error : null,
            },
          );
          return NextResponse.json({ session: serialize(back) });
        }
        const visualMsg: ChatMessage = {
          role: 'agent',
          content:
            "Here's the first take. Tap a chip to iterate, type freely, or approve to move on to platforms.",
          kind: 'visual',
          createdAt: Date.now() + 1,
        };
        const fresh = await transition(generating, 'awaiting_visual_feedback', {
          visualUrl: visualResult.visual.url,
          visualWidth: visualResult.visual.width,
          visualHeight: visualResult.visual.height,
          messages: [...messages, userMsg, visualMsg],
        });
        return NextResponse.json({ session: serialize(fresh) });
      }

      // 2. approve_visual → move to platform-choice with a
      //    suggestion the founder can adjust.
      if (action === 'approve_visual') {
        if (currentState !== 'awaiting_visual_feedback') {
          return NextResponse.json(
            { error: `Cannot approve visual from state ${currentState}` },
            { status: 409 },
          );
        }
        breadcrumb('approve_visual');
        const suggested = defaultPlatforms(row.assetType);
        const userMsg: ChatMessage = {
          role: 'user',
          content: '✓ Approve visual.',
          kind: 'system',
          createdAt: Date.now(),
        };
        const agentMsg: ChatMessage = {
          role: 'agent',
          content: `Great visual! Suggested distribution: ${suggested.join(', ')}. Each one will get a caption adapted for the network. Use these or adjust.`,
          kind: 'platforms',
          createdAt: Date.now() + 1,
        };
        const next = await transition(row, 'awaiting_platform_choice', {
          platforms: suggested,
          messages: [...messages, userMsg, agentMsg],
        });
        return NextResponse.json({ session: serialize(next) });
      }

      // 3. regenerate_visual → loop back through fal.ai with the
      //    current concept (the chat history already steered it).
      if (action === 'regenerate_visual') {
        if (currentState !== 'awaiting_visual_feedback') {
          return NextResponse.json(
            { error: `Cannot regenerate visual from state ${currentState}` },
            { status: 409 },
          );
        }
        breadcrumb('regenerate_visual');
        const generating = await transition(row, 'generating_visual', {});
        const visualResult = await tryGenerateVisual({
          concept: row.concept ?? '',
          brandBible: bibleSnapshot,
          assetType: row.assetType as 'photo' | 'carousel' | 'upload' | null,
          painPointId: row.painPointId,
          userId: user.id,
          rowId: row.id,
        });
        if (!visualResult.ok) {
          const failMsg: ChatMessage = {
            role: 'agent',
            content: `⚠️ ${visualResult.error}`,
            kind: 'system',
            createdAt: Date.now(),
          };
          // Always come back to visual_feedback after a regen
          // attempt — the founder can iterate via chat or try
          // again. Even when fal.ai threw, the previous visual
          // URL is preserved on the row.
          const back = await transition(generating, 'awaiting_visual_feedback', {
            messages: [...messages, failMsg],
          });
          return NextResponse.json({ session: serialize(back) });
        }
        const visualMsg: ChatMessage = {
          role: 'agent',
          content: 'New take ready — same concept, different render.',
          kind: 'visual',
          createdAt: Date.now(),
        };
        const fresh = await transition(generating, 'awaiting_visual_feedback', {
          visualUrl: visualResult.visual.url,
          visualWidth: visualResult.visual.width,
          visualHeight: visualResult.visual.height,
          messages: [...messages, visualMsg],
        });
        return NextResponse.json({ session: serialize(fresh) });
      }

      // PR Sprint D-bugs — 3.5. retry_visual + refine_concept:
      // recovery actions out of the visual_failed state. retry
      // re-fires generateVisual with the same concept; refine
      // sends the session back to awaiting_type_choice so the
      // founder can adjust the concept via chat before re-trying.
      if (action === 'retry_visual') {
        if (currentState !== 'visual_failed') {
          return NextResponse.json(
            { error: `Cannot retry from state ${currentState}` },
            { status: 409 },
          );
        }
        breadcrumb('retry_visual');
        const generating = await transition(row, 'generating_visual', {});
        const visualResult = await tryGenerateVisual({
          concept: row.concept ?? '',
          brandBible: bibleSnapshot,
          assetType: row.assetType as 'photo' | 'carousel' | 'upload' | null,
          painPointId: row.painPointId,
          userId: user.id,
          rowId: row.id,
        });
        if (!visualResult.ok) {
          const failMsg: ChatMessage = {
            role: 'agent',
            content: `⚠️ ${visualResult.error}`,
            kind: 'system',
            createdAt: Date.now(),
          };
          const isEnvIssue = visualResult.error.includes('FAL_API_KEY');
          const back = await transition(
            generating,
            isEnvIssue ? 'failed' : 'visual_failed',
            {
              messages: [...messages, failMsg],
              errorMessage: isEnvIssue ? visualResult.error : null,
            },
          );
          return NextResponse.json({ session: serialize(back) });
        }
        const visualMsg: ChatMessage = {
          role: 'agent',
          content: 'Retry worked — here\'s the new visual.',
          kind: 'visual',
          createdAt: Date.now(),
        };
        const fresh = await transition(generating, 'awaiting_visual_feedback', {
          visualUrl: visualResult.visual.url,
          visualWidth: visualResult.visual.width,
          visualHeight: visualResult.visual.height,
          messages: [...messages, visualMsg],
        });
        return NextResponse.json({ session: serialize(fresh) });
      }

      if (action === 'refine_concept') {
        if (currentState !== 'visual_failed') {
          return NextResponse.json(
            { error: `Cannot refine from state ${currentState}` },
            { status: 409 },
          );
        }
        breadcrumb('refine_concept');
        const agentMsg: ChatMessage = {
          role: 'agent',
          content:
            'OK — tell me what to change about the concept and I\'ll try again.',
          kind: 'text',
          createdAt: Date.now(),
        };
        const back = await transition(row, 'awaiting_type_choice', {
          messages: [...messages, agentMsg],
        });
        return NextResponse.json({ session: serialize(back) });
      }

      // 4. set_platforms → update the platforms array without
      //    advancing state (founder is still adjusting).
      if (action === 'set_platforms') {
        if (currentState !== 'awaiting_platform_choice') {
          return NextResponse.json(
            { error: `Cannot set platforms from state ${currentState}` },
            { status: 409 },
          );
        }
        const platforms = Array.isArray(body.platforms)
          ? body.platforms.filter(
              (p): p is string => typeof p === 'string' && p.trim().length > 0,
            )
          : [];
        if (platforms.length === 0 || platforms.length > 8) {
          return NextResponse.json(
            { error: 'platforms must be 1-8 entries' },
            { status: 400 },
          );
        }
        breadcrumb(`set_platforms=${platforms.length}`);
        const next = await transition(row, 'awaiting_platform_choice', {
          platforms,
        });
        return NextResponse.json({ session: serialize(next) });
      }

      // 5. approve_platforms → fire the copy generation step.
      if (action === 'approve_platforms') {
        if (currentState !== 'awaiting_platform_choice') {
          return NextResponse.json(
            { error: `Cannot approve platforms from state ${currentState}` },
            { status: 409 },
          );
        }
        const platforms = (row.platforms ?? []) as string[];
        if (platforms.length === 0) {
          return NextResponse.json(
            { error: 'No platforms selected' },
            { status: 400 },
          );
        }
        breadcrumb(`approve_platforms count=${platforms.length}`);
        const userMsg: ChatMessage = {
          role: 'user',
          content: `✓ Use ${platforms.join(', ')}.`,
          kind: 'system',
          createdAt: Date.now(),
        };
        const generatingMsg: ChatMessage = {
          role: 'agent',
          content: `Writing captions adapted for each network — usually 5-10 seconds.`,
          kind: 'system',
          createdAt: Date.now() + 1,
        };
        const generating = await transition(row, 'generating_copies', {
          messages: [...messages, userMsg, generatingMsg],
        });
        const copies = await generateCopies({
          brandBible: bibleSnapshot,
          concept: row.concept ?? '',
          visualDescription: row.concept ?? '',
          platforms,
          styleNote: null,
        });
        if (copies.length === 0) {
          const failMsg: ChatMessage = {
            role: 'agent',
            content:
              '⚠️ Copy generation failed. The model returned no usable JSON.',
            kind: 'system',
            createdAt: Date.now() + 2,
          };
          const failed = await transition(generating, 'failed', {
            messages: [...messages, userMsg, generatingMsg, failMsg],
            // PR Sprint UGC+Photo final — anti-naming. The
            // errorMessage column is surfaced verbatim to the
            // client (post-detail / serializer); keep it
            // provider-agnostic. Sentry captures the model
            // name internally.
            errorMessage: 'Copy generation returned no usable result.',
          });
          return NextResponse.json({ session: serialize(failed) });
        }
        const doneMsg: ChatMessage = {
          role: 'agent',
          content: `Done — ${copies.length} captions ready. Review, regenerate any single one, or approve all to save.`,
          kind: 'copies',
          createdAt: Date.now() + 2,
        };
        const fresh = await transition(generating, 'awaiting_copy_feedback', {
          copies,
          messages: [...messages, userMsg, generatingMsg, doneMsg],
        });
        return NextResponse.json({ session: serialize(fresh) });
      }

      // 6. regenerate_copy → ONE platform at a time, preserving
      //    the others. Stays in awaiting_copy_feedback.
      if (action === 'regenerate_copy') {
        if (currentState !== 'awaiting_copy_feedback') {
          return NextResponse.json(
            { error: `Cannot regenerate copy from state ${currentState}` },
            { status: 409 },
          );
        }
        const platform = body.platform;
        if (!platform) {
          return NextResponse.json(
            { error: 'platform required' },
            { status: 400 },
          );
        }
        const existing = (row.copies ?? []) as PerPlatformCopy[];
        const target = existing.find((c) => c.platform === platform);
        if (!target) {
          return NextResponse.json(
            { error: `No existing copy for ${platform}` },
            { status: 400 },
          );
        }
        breadcrumb(`regenerate_copy platform=${platform}`);
        const fresh = await regenerateOne({
          brandBible: bibleSnapshot,
          concept: row.concept ?? '',
          visualDescription: row.concept ?? '',
          platform,
          previousText: target.text,
          founderDirection: body.direction ?? null,
        });
        if (!fresh) {
          return NextResponse.json(
            { error: 'Regeneration returned no copy' },
            { status: 502 },
          );
        }
        const nextCopies = existing.map((c) =>
          c.platform === platform ? fresh : c,
        );
        const next = await transition(row, 'awaiting_copy_feedback', {
          copies: nextCopies,
        });
        return NextResponse.json({ session: serialize(next) });
      }

      // 7. approve_copies → save into Library (content_assets +
      //    generated_posts) and mark the session finalized.
      if (action === 'approve_copies') {
        if (currentState !== 'awaiting_copy_feedback') {
          return NextResponse.json(
            { error: `Cannot finalize from state ${currentState}` },
            { status: 409 },
          );
        }
        const copies = (row.copies ?? []) as PerPlatformCopy[];
        if (copies.length === 0) {
          return NextResponse.json(
            { error: 'No copies to save' },
            { status: 400 },
          );
        }
        breadcrumb(`approve_copies count=${copies.length}`);

        // Insert the asset + per-platform posts in one go. We
        // pick assetType based on what the founder chose:
        //   'carousel' → asset_type='carousel'
        //   'upload' or 'photo' → asset_type='photo'
        // The library uses asset_type to drive its grouping UI.
        const assetType = row.assetType === 'carousel' ? 'carousel' : 'photo';
        const [asset] = await db
          .insert(contentAssets)
          .values({
            userId: user.id,
            projectId: row.projectId,
            assetType,
            videoUrl: null,
            imageUrls: row.visualUrl ? [row.visualUrl] : [],
            baseContent: row.concept ?? row.prompt,
            brandAnalysisSnapshot: bibleSnapshot,
            promptUsed: row.prompt,
          })
          .returning();

        if (asset) {
          await db.insert(generatedPosts).values(
            copies.map((c) => ({
              projectId: row.projectId,
              assetId: asset.id,
              platform: c.platform,
              content: c.text,
              caption: c.text,
              hashtags: c.hashtags,
              ctaText: c.ctaText,
              prompt: row.prompt,
              status: 'draft' as const,
            })),
          );
        }

        const userMsg: ChatMessage = {
          role: 'user',
          content: '✓ Approve all and save to Library.',
          kind: 'system',
          createdAt: Date.now(),
        };
        const doneMsg: ChatMessage = {
          role: 'agent',
          content: `Saved to your Library. Open the Library tab to schedule or publish.`,
          kind: 'system',
          createdAt: Date.now() + 1,
        };
        const finalized = await transition(row, 'finalized', {
          contentAssetId: asset?.id ?? null,
          messages: [...messages, userMsg, doneMsg],
        });
        return NextResponse.json({ session: serialize(finalized) });
      }

      return NextResponse.json(
        { error: `Unknown action: ${action}` },
        { status: 400 },
      );
    }

    // ─── MESSAGE dispatch ───────────────────────────────────────
    if (body.kind === 'message') {
      const text = (body.text ?? '').trim();
      if (text.length < 1 || text.length > 10_000) {
        return NextResponse.json(
          { error: 'text must be 1-10000 chars' },
          { status: 400 },
        );
      }
      const lastAgent = [...messages]
        .reverse()
        .find((m) => m.role === 'agent');
      const intent = await classifyIntent({
        message: text,
        state: currentState,
        lastAgentMessage: lastAgent?.content ?? null,
      });
      breadcrumb(`message intent=${intent.intent}`);
      const userMsg: ChatMessage = {
        role: 'user',
        content: text,
        kind: 'text',
        createdAt: Date.now(),
      };

      // Approve intent in an awaiting_* state is the same as the
      // corresponding action — route through identical paths so the
      // contract stays single-source-of-truth.
      if (intent.intent === 'approve') {
        if (currentState === 'awaiting_visual_feedback') {
          const suggested = defaultPlatforms(row.assetType);
          const agentMsg: ChatMessage = {
            role: 'agent',
            content: `Great visual! Suggested distribution: ${suggested.join(', ')}. Use these or adjust.`,
            kind: 'platforms',
            createdAt: Date.now() + 1,
          };
          const next = await transition(row, 'awaiting_platform_choice', {
            platforms: suggested,
            messages: [...messages, userMsg, agentMsg],
          });
          return NextResponse.json({ session: serialize(next) });
        }
        if (currentState === 'awaiting_platform_choice') {
          // Fall through to approve_platforms behavior — but we
          // need to inline it here because action dispatch already
          // exited. Easiest: do the work directly.
          const platforms = (row.platforms ?? []) as string[];
          if (platforms.length === 0) {
            return NextResponse.json(
              { error: 'No platforms selected' },
              { status: 400 },
            );
          }
          const generatingMsg: ChatMessage = {
            role: 'agent',
            content: `Writing captions adapted for ${platforms.join(', ')}…`,
            kind: 'system',
            createdAt: Date.now() + 1,
          };
          const generating = await transition(row, 'generating_copies', {
            messages: [...messages, userMsg, generatingMsg],
          });
          const copies = await generateCopies({
            brandBible: bibleSnapshot,
            concept: row.concept ?? '',
            visualDescription: row.concept ?? '',
            platforms,
            styleNote: null,
          });
          if (copies.length === 0) {
            const failed = await transition(generating, 'failed', {
              messages: [
                ...messages,
                userMsg,
                generatingMsg,
                {
                  role: 'agent' as const,
                  content: '⚠️ Copy generation failed.',
                  kind: 'system' as const,
                  createdAt: Date.now() + 2,
                },
              ],
              // PR Sprint UGC+Photo final — anti-naming. The
            // errorMessage column is surfaced verbatim to the
            // client (post-detail / serializer); keep it
            // provider-agnostic. Sentry captures the model
            // name internally.
            errorMessage: 'Copy generation returned no usable result.',
            });
            return NextResponse.json({ session: serialize(failed) });
          }
          const doneMsg: ChatMessage = {
            role: 'agent',
            content: `${copies.length} captions ready — review, regenerate, or approve all.`,
            kind: 'copies',
            createdAt: Date.now() + 2,
          };
          const fresh = await transition(generating, 'awaiting_copy_feedback', {
            copies,
            messages: [...messages, userMsg, generatingMsg, doneMsg],
          });
          return NextResponse.json({ session: serialize(fresh) });
        }
        // approve in awaiting_copy_feedback → tell the UI to call
        // the explicit approve_copies action (safer than auto-
        // firing the Library save from a free-text approval).
        const agentMsg: ChatMessage = {
          role: 'agent',
          content:
            'Got it — hit the **✓ Approve all and save** button to save these to your Library.',
          kind: 'system',
          createdAt: Date.now() + 1,
        };
        const next = await transition(row, currentState, {
          messages: [...messages, userMsg, agentMsg],
        });
        return NextResponse.json({ session: serialize(next) });
      }

      // Modify / free_chat in awaiting_visual_feedback → loop
      // through refineConcept and regenerate.
      if (
        (intent.intent === 'modify' || intent.intent === 'free_chat') &&
        currentState === 'awaiting_visual_feedback'
      ) {
        const refined = await refineConcept({
          brandBible: bibleSnapshot,
          messages: [...messages, userMsg],
          currentConcept: row.concept ?? null,
          assetType: (row.assetType as 'photo' | 'carousel' | 'upload') ?? 'photo',
        });
        const agentMsg: ChatMessage = {
          role: 'agent',
          content: refined.chatReply,
          kind: 'text',
          createdAt: Date.now() + 1,
        };
        const nextMessages = [...messages, userMsg, agentMsg];
        if (refined.ready && refined.concept) {
          const generating = await transition(row, 'generating_visual', {
            concept: refined.concept,
            messages: nextMessages,
          });
          const visualResult = await tryGenerateVisual({
            concept: refined.concept,
            brandBible: bibleSnapshot,
            assetType: row.assetType as 'photo' | 'carousel' | 'upload' | null,
            painPointId: row.painPointId,
            userId: user.id,
            rowId: row.id,
          });
          if (!visualResult.ok) {
            const back = await transition(generating, 'awaiting_visual_feedback', {
              messages: [
                ...nextMessages,
                {
                  role: 'agent' as const,
                  content: `⚠️ ${visualResult.error}`,
                  kind: 'system' as const,
                  createdAt: Date.now() + 2,
                },
              ],
            });
            return NextResponse.json({ session: serialize(back) });
          }
          const fresh = await transition(generating, 'awaiting_visual_feedback', {
            visualUrl: visualResult.visual.url,
            visualWidth: visualResult.visual.width,
            visualHeight: visualResult.visual.height,
            messages: [
              ...nextMessages,
              {
                role: 'agent' as const,
                content: 'Updated take ready — review again.',
                kind: 'visual' as const,
                createdAt: Date.now() + 2,
              },
            ],
          });
          return NextResponse.json({ session: serialize(fresh) });
        }
        // Refiner asked for clarification — stay in
        // awaiting_visual_feedback.
        const next = await transition(row, 'awaiting_visual_feedback', {
          messages: nextMessages,
        });
        return NextResponse.json({ session: serialize(next) });
      }

      // Modify in awaiting_copy_feedback → free-text steering on
      // the next regenerate. Persist the message + nudge the
      // founder to use the per-card regenerate button.
      if (
        (intent.intent === 'modify' || intent.intent === 'free_chat') &&
        currentState === 'awaiting_copy_feedback'
      ) {
        const agentMsg: ChatMessage = {
          role: 'agent',
          content:
            'Use the **🔄 Regenerate this one** button on a specific copy card and I\'ll apply your direction. Or **✓ Approve all** when they\'re good.',
          kind: 'system',
          createdAt: Date.now() + 1,
        };
        const next = await transition(row, currentState, {
          messages: [...messages, userMsg, agentMsg],
        });
        return NextResponse.json({ session: serialize(next) });
      }

      // PR Sprint UGC+Photo paridad — feedback while reviewing
      // a concept. Clear the gate, transition back to
      // awaiting_type_choice + run refineConcept. The refiner
      // produces an updated concept (or asks a clarifying
      // question); if ready=true we re-engage the gate at
      // reviewing_concept with the new concept. Net result is an
      // iteration loop with the founder always in control.
      if (currentState === 'reviewing_concept') {
        breadcrumb(`feedback_during_review`);
        const assetType =
          (row.assetType as 'photo' | 'carousel' | 'upload' | null) ??
          inferAssetTypeFromText(text) ??
          'photo';
        const refined = await refineConcept({
          brandBible: bibleSnapshot,
          messages: [...messages, userMsg],
          currentConcept: row.concept ?? null,
          assetType,
        });
        const agentMsg: ChatMessage = {
          role: 'agent',
          content: refined.chatReply,
          kind: 'text',
          createdAt: Date.now() + 1,
        };
        const nextMessages = [...messages, userMsg, agentMsg];

        if (refined.ready && refined.concept) {
          // Re-engaged. New concept proposed — gate snaps back on.
          Sentry.captureMessage('photo_agent_gate_engaged', {
            level: 'info',
            tags: { area: 'photo-studio', kind: 'approval-gate' },
            extra: {
              sessionId: row.id,
              assetType,
              conceptSnippet: refined.concept.slice(0, 200),
              msgCreatedAtMs: Date.now(),
              reEngagement: true,
            },
          });
          const reviewing = await transition(row, 'reviewing_concept', {
            concept: refined.concept,
            messages: nextMessages,
            approvalGateActive: true,
            approvalGateAt: new Date(),
          });
          return NextResponse.json({ session: serialize(reviewing) });
        }
        // Need more info — gate clears, back to chat.
        const back = await transition(row, 'awaiting_type_choice', {
          messages: nextMessages,
          approvalGateActive: false,
          approvalGateAt: new Date(),
        });
        return NextResponse.json({ session: serialize(back) });
      }

      // Default for any other intent in any other state — just
      // refine and re-prompt. Specifically covers:
      //   - awaiting_type_choice + free text → refineConcept may
      //     produce ready=true and fire the visual
      //   - awaiting_platform_choice + free text → ask the founder
      //     to use the chip rail to confirm
      if (currentState === 'awaiting_type_choice') {
        // PR Sprint D-bugs — full message handler now mirrors the
        // pick_type ACTION dispatch. Three things changed:
        //   1. inferAssetTypeFromText() pulls the type ("carousel"
        //      etc) out of free text so the founder doesn't HAVE
        //      to click a chip.
        //   2. refineConcept's stricter "ack the founder" + force-
        //      ship-after-2-turns means ready=true fires reliably
        //      on real input.
        //   3. When ready=true, fire generateVisual + transition
        //      to awaiting_visual_feedback (or visual_failed on
        //      Flux failure) — same paths the action handler uses.
        const inferredType = inferAssetTypeFromText(text);
        const assetType =
          (row.assetType as 'photo' | 'carousel' | 'upload' | null) ??
          inferredType ??
          'photo';
        const refined = await refineConcept({
          brandBible: bibleSnapshot,
          messages: [...messages, userMsg],
          currentConcept: row.concept ?? null,
          assetType,
        });
        const agentMsg: ChatMessage = {
          role: 'agent',
          content: refined.chatReply,
          kind: 'text',
          createdAt: Date.now() + 1,
        };
        const nextMessages = [...messages, userMsg, agentMsg];

        if (refined.ready && refined.concept) {
          // PR Sprint UGC+Photo paridad — same concept-review
          // gate as the pick_type action handler above. Free-
          // text path also lands at reviewing_concept instead
          // of firing fal.ai immediately.
          breadcrumb(`message_concept_ready assetType=${assetType}`);
          Sentry.captureMessage('photo_agent_gate_engaged', {
            level: 'info',
            tags: { area: 'photo-studio', kind: 'approval-gate' },
            extra: {
              sessionId: row.id,
              assetType,
              conceptSnippet: refined.concept.slice(0, 200),
              msgCreatedAtMs: Date.now(),
            },
          });
          const reviewing = await transition(row, 'reviewing_concept', {
            assetType,
            concept: refined.concept,
            messages: nextMessages,
            approvalGateActive: true,
            approvalGateAt: new Date(),
          });
          return NextResponse.json({ session: serialize(reviewing) });
        }

        // Not enough info yet — stay in awaiting_type_choice but
        // PERSIST the inferred assetType so the chat doesn't lose
        // it on the next turn.
        const next = await transition(row, 'awaiting_type_choice', {
          assetType,
          messages: nextMessages,
        });
        return NextResponse.json({ session: serialize(next) });
      }

      if (currentState === 'awaiting_platform_choice') {
        const agentMsg: ChatMessage = {
          role: 'agent',
          content:
            'Tap **✓ Use these** to confirm the suggested platforms, or use **⚙️ Adjust** to pick a different set.',
          kind: 'system',
          createdAt: Date.now() + 1,
        };
        const next = await transition(row, currentState, {
          messages: [...messages, userMsg, agentMsg],
        });
        return NextResponse.json({ session: serialize(next) });
      }

      // Fall-through (shouldn't normally hit).
      const agentMsg: ChatMessage = {
        role: 'agent',
        content: 'Got it.',
        kind: 'text',
        createdAt: Date.now() + 1,
      };
      const next = await transition(row, currentState, {
        messages: [...messages, userMsg, agentMsg],
      });
      return NextResponse.json({ session: serialize(next) });
    }

    return NextResponse.json(
      { error: 'kind must be "message" or "action"' },
      { status: 400 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    Sentry.captureException(e, {
      tags: { area: 'photo-agent', kind: 'request-failed' },
      extra: { rowId: row.id, state: currentState },
    });
    return NextResponse.json(
      { error: msg.slice(0, 500) },
      { status: 500 },
    );
  }
}
