// PR Sprint 7.16 — Voice Engine: record-edit endpoint.
//
// POST /api/voice-engine/record-edit
// Body: {
//   projectId: string,
//   platform: Platform,
//   contentType: ContentType,
//   postId: string,
//   original: string,
//   edited: string,
//   feedbackTier?: FeedbackTier   // optional; weights the signals
// }
//
// Pipeline (matches the Python integration flow exactly):
//   1. Load ClientContext for (user, project).
//   2. Apply tiered-feedback weight (if provided) to every
//      signal derived from this post's diff.
//   3. Classify the diff into signals.
//   4. Run processSignals against the context. New / updated
//      overrides land on slots.learnedOverrides; audit entries
//      come back in the result.
//   5. Persist the updated context + each audit entry.
//   6. Return the diff summary + the override changes for the
//      caller to surface (or ignore — the brief says feedback
//      is invisible to the founder).
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { classifyDiff } from '@/lib/voice-engine/diff-classifier';
import {
  processSignals,
  recordTieredFeedback,
} from '@/lib/voice-engine/feedback-loop';
import {
  appendAuditEntryByProject,
  loadClientContext,
  saveClientContext,
  logAudit,
} from '@/lib/voice-engine/loader';
import {
  isFeedbackTier,
  PLATFORMS,
  CONTENT_TYPES,
  type ContentType,
  type Platform,
  type Signal,
} from '@/lib/voice-engine/types';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: {
    projectId?: unknown;
    platform?: unknown;
    contentType?: unknown;
    postId?: unknown;
    original?: unknown;
    edited?: unknown;
    feedbackTier?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (typeof body.projectId !== 'string' || !UUID_RE.test(body.projectId)) {
    return NextResponse.json(
      { error: 'Invalid projectId' },
      { status: 400 },
    );
  }
  if (
    typeof body.platform !== 'string' ||
    !(PLATFORMS as readonly string[]).includes(body.platform)
  ) {
    return NextResponse.json({ error: 'Invalid platform' }, { status: 400 });
  }
  if (
    typeof body.contentType !== 'string' ||
    !(CONTENT_TYPES as readonly string[]).includes(body.contentType)
  ) {
    return NextResponse.json(
      { error: 'Invalid contentType' },
      { status: 400 },
    );
  }
  if (typeof body.postId !== 'string' || !UUID_RE.test(body.postId)) {
    return NextResponse.json({ error: 'Invalid postId' }, { status: 400 });
  }
  if (typeof body.original !== 'string' || typeof body.edited !== 'string') {
    return NextResponse.json(
      { error: 'original + edited required (strings)' },
      { status: 400 },
    );
  }
  if (
    body.feedbackTier !== undefined &&
    !isFeedbackTier(body.feedbackTier)
  ) {
    return NextResponse.json(
      { error: 'Invalid feedbackTier' },
      { status: 400 },
    );
  }

  const projectId = body.projectId;
  const platform = body.platform as Platform;
  const contentType = body.contentType as ContentType;
  const postId = body.postId;
  const original = body.original;
  const edited = body.edited;
  const tier = body.feedbackTier;

  // Classify the diff.
  let signals: Signal[] = classifyDiff({
    original,
    edited,
    platform,
    contentType,
    postId,
  });

  // Apply tiered-feedback weight when present. The Python
  // contract: caller calls record_tiered_feedback FIRST, gets a
  // multiplier, then applies it. We collapse that into one
  // call here so the API surface is simpler.
  let appliedTierWeight: number | null = null;
  if (tier) {
    const tierResult = recordTieredFeedback({
      platform,
      postId,
      tier,
    });
    appliedTierWeight = tierResult.weight;
    signals = signals.map((s) => ({
      ...s,
      weight: s.weight * tierResult.weight,
    }));
    // Persist the tier-recorded audit entry.
    await appendAuditEntryByProject({
      userId: user.id,
      projectId,
      entry: tierResult.auditEntry,
    });
  }

  // Load context, process, persist.
  const ctx = await loadClientContext({ userId: user.id, projectId });
  const { ctx: updatedCtx, auditEntries } = processSignals(ctx, signals);
  await saveClientContext({ userId: user.id, projectId, ctx: updatedCtx });

  // Persist audit entries one-by-one. Each represents a state
  // change worth grepping for in operator queries.
  for (const entry of auditEntries) {
    await appendAuditEntryByProject({
      userId: user.id,
      projectId,
      entry,
    });
  }

  return NextResponse.json({
    success: true,
    signalsDetected: signals.length,
    overridesUpdated: auditEntries.filter(
      (e) => e.action === 'override_updated',
    ).length,
    appliedTierWeight,
    auditEntries: auditEntries.map((e) => ({
      action: e.action,
      platform: e.platform,
      dimension: e.dimension,
      notes: e.notes,
    })),
  });
}
