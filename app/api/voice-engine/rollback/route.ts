// PR Sprint 7.16 — Voice Engine: manual rollback endpoint.
//
// POST /api/voice-engine/rollback
// Body: {
//   projectId: string,
//   platform: Platform,
//   dimension: Dimension,
//   reason?: string
// }
//
// Removes the current learnedOverride for (platform, dimension)
// and emits an audit entry. Operator-only — gated behind the
// HELM_OPERATOR_KEY env var so a regular logged-in user can't
// nuke their own context without us seeing it. Actual operators
// pass the key via Authorization: Bearer <key>.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { rollbackOverride } from '@/lib/voice-engine/feedback-loop';
import {
  appendAuditEntryByProject,
  loadClientContext,
  saveClientContext,
} from '@/lib/voice-engine/loader';
import {
  DIMENSIONS,
  PLATFORMS,
  isDimension,
  isPlatform,
  type Dimension,
  type Platform,
} from '@/lib/voice-engine/types';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function checkOperatorAuth(request: Request): boolean {
  const expected = process.env.HELM_OPERATOR_KEY;
  if (!expected) return false; // No key set → reject by default.
  const header = request.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  return match[1] === expected;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Operator authorization — bearer token verification.
  if (!checkOperatorAuth(request)) {
    return NextResponse.json(
      {
        error:
          'Operator authorization required. Pass HELM_OPERATOR_KEY in Authorization: Bearer header.',
      },
      { status: 403 },
    );
  }

  let body: {
    projectId?: unknown;
    platform?: unknown;
    dimension?: unknown;
    reason?: unknown;
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
  if (!isPlatform(body.platform)) {
    return NextResponse.json(
      { error: `Invalid platform. Supported: ${PLATFORMS.join(', ')}` },
      { status: 400 },
    );
  }
  if (!isDimension(body.dimension)) {
    return NextResponse.json(
      {
        error: `Invalid dimension. Supported: ${DIMENSIONS.join(', ')}`,
      },
      { status: 400 },
    );
  }

  const projectId = body.projectId;
  const platform = body.platform as Platform;
  const dimension = body.dimension as Dimension;
  const reason =
    typeof body.reason === 'string' && body.reason.length > 0
      ? body.reason
      : null;

  const ctx = await loadClientContext({ userId: user.id, projectId });
  const { ctx: updatedCtx, auditEntry } = rollbackOverride({
    ctx,
    platform,
    dimension,
    operatorId: 'helm-operator',
    reason,
  });
  await saveClientContext({ userId: user.id, projectId, ctx: updatedCtx });
  await appendAuditEntryByProject({
    userId: user.id,
    projectId,
    entry: auditEntry,
  });

  return NextResponse.json({
    success: true,
    rolledBack: {
      platform,
      dimension,
      previousValue: auditEntry.previousValue,
    },
  });
}
