// PR Sprint 7.16 — Adaptive Voice Engine persistence layer.
//
// Translates between the in-memory ClientContext (plain JSON) and
// the client_contexts row in Postgres. The Python source uses
// pydantic's .model_dump_json() / .model_validate_json() — the
// equivalent here is JSON.stringify / JSON.parse of the same
// shape, with the heavy state living in JSONB columns.
//
// loadClientContext is the canonical read path for every endpoint
// that needs the context. It creates an empty row on miss so
// callers can treat the context as always-present (matches the
// Python factory's get-or-create behavior).

import { db } from '@/lib/db';
import {
  clientContexts,
  voiceEngineAuditLog,
  projects,
} from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import type { BrandBible as ProjectBrandBible } from '@/lib/types/brand';
import {
  emptyClientContext,
  emptyBrandBible,
  newAuditEntry,
  type BrandBibleVoiceEngine,
  type ClientContext,
  type AuditEntry,
} from './types';

// ============================================================
// Brand-bible adapter
//
// The Voice Engine's BrandBible is a SUBSET of the project's
// existing BrandBible (lib/types/brand.ts). We map down to the 8
// fields the engine actually uses; everything else stays in the
// project record. Round-trip-safe: this never overwrites the
// project bible — only the engine's local copy mutates as
// learning proceeds.
// ============================================================

export function projectBibleToEngineBible(
  bible: ProjectBrandBible | null,
): BrandBibleVoiceEngine {
  if (!bible) return emptyBrandBible();
  return {
    voice: bible.archetype?.primary ?? '',
    audience: bible.audience?.primary?.description ?? '',
    positioning: bible.identity?.tagline ?? '',
    pillars: (bible.pillars ?? []).map((p) => p.name ?? '').filter(Boolean),
    bannedPhrases: (bible.vocabulary?.bannedTerms ?? [])
      .map((t) => t.term ?? '')
      .filter(Boolean),
    mandatorySignals: bible.nonNegotiables ?? [],
    examplesLoved: [],
    examplesHated: [],
  };
}

// ============================================================
// Load / create
// ============================================================

export async function loadClientContext(opts: {
  userId: string;
  projectId: string;
}): Promise<ClientContext> {
  const [row] = await db
    .select()
    .from(clientContexts)
    .where(
      and(
        eq(clientContexts.projectId, opts.projectId),
        eq(clientContexts.userId, opts.userId),
      ),
    )
    .limit(1);

  if (row) {
    // Re-hydrate from JSONB. Each column was stored via
    // saveClientContext below, so the shapes match exactly.
    return {
      clientId: opts.projectId,
      brandBible: row.brandBible as BrandBibleVoiceEngine,
      platforms: (row.platforms ?? {}) as ClientContext['platforms'],
      crossPlatformVoice:
        (row.crossPlatformVoice ?? []) as ClientContext['crossPlatformVoice'],
      antiSamples: (row.antiSamples ?? {}) as ClientContext['antiSamples'],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  // Cold start: seed from the project's existing BrandBible.
  // First-touch initialization is invisible to the founder — the
  // empty context is functionally equivalent to "no learning
  // yet, fall back to defaults" which is what the prompt builder
  // produces anyway.
  const [project] = await db
    .select({
      brandContext: projects.brandContext,
    })
    .from(projects)
    .where(
      and(
        eq(projects.id, opts.projectId),
        eq(projects.userId, opts.userId),
      ),
    )
    .limit(1);

  const ctx = emptyClientContext(opts.projectId);
  ctx.brandBible = projectBibleToEngineBible(
    (project?.brandContext as ProjectBrandBible | null) ?? null,
  );

  await db.insert(clientContexts).values({
    userId: opts.userId,
    projectId: opts.projectId,
    brandBible: ctx.brandBible,
    platforms: ctx.platforms,
    crossPlatformVoice: ctx.crossPlatformVoice,
    antiSamples: ctx.antiSamples,
  });

  // Audit the initialization for operator-visible traceability.
  await db.insert(voiceEngineAuditLog).values({
    // We need the row id. Re-fetch to get it; cheap because the
    // row was just inserted and is in cache.
    clientContextId: await fetchContextId(opts.projectId, opts.userId),
    userId: opts.userId,
    action: 'context_initialized',
    notes: 'Seeded from project brand_context',
  });

  return ctx;
}

async function fetchContextId(
  projectId: string,
  userId: string,
): Promise<string> {
  const [row] = await db
    .select({ id: clientContexts.id })
    .from(clientContexts)
    .where(
      and(
        eq(clientContexts.projectId, projectId),
        eq(clientContexts.userId, userId),
      ),
    )
    .limit(1);
  if (!row) {
    throw new Error('Client context row missing after insert');
  }
  return row.id;
}

// ============================================================
// Save (full overwrite of JSONB columns)
//
// We don't try to diff-patch JSONB. The whole document is
// rewritten on every save because:
//   1. Postgres JSONB doesn't have efficient deep-merge anyway.
//   2. The context is bounded (~ low KB to maybe 100 KB at
//      mature stage with full sample sets); rewriting it is
//      cheap compared to the Anthropic call that produced the
//      mutation.
//   3. Simpler code = fewer edge cases.
// ============================================================

export async function saveClientContext(opts: {
  userId: string;
  projectId: string;
  ctx: ClientContext;
}): Promise<void> {
  await db
    .update(clientContexts)
    .set({
      brandBible: opts.ctx.brandBible,
      platforms: opts.ctx.platforms,
      crossPlatformVoice: opts.ctx.crossPlatformVoice,
      antiSamples: opts.ctx.antiSamples,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(clientContexts.projectId, opts.projectId),
        eq(clientContexts.userId, opts.userId),
      ),
    );
}

// ============================================================
// Audit log writer.
//
// AuditEntry in the Python source lived inside ClientContext as
// an embedded list. Here we write each entry as its own row in
// voice_engine_audit_log so operators can grep by (action,
// dimension, time range) without parsing JSONB.
// ============================================================

export async function appendAuditEntry(opts: {
  contextRowId: string;
  userId: string;
  entry: AuditEntry;
}): Promise<void> {
  await db.insert(voiceEngineAuditLog).values({
    clientContextId: opts.contextRowId,
    userId: opts.userId,
    action: opts.entry.action,
    platform: opts.entry.platform,
    dimension: opts.entry.dimension,
    previousValue: opts.entry.previousValue ?? null,
    newValue: opts.entry.newValue ?? null,
    triggeringSignals: opts.entry.triggeringSignals,
    operatorId: opts.entry.operatorId,
    notes: opts.entry.notes,
  });
}

export async function appendAuditEntryByProject(opts: {
  userId: string;
  projectId: string;
  entry: AuditEntry;
}): Promise<void> {
  const contextRowId = await fetchContextId(opts.projectId, opts.userId);
  await appendAuditEntry({
    contextRowId,
    userId: opts.userId,
    entry: opts.entry,
  });
}

// Convenience: build + persist in one call.
export async function logAudit(opts: {
  userId: string;
  projectId: string;
  action: string;
  platform?: Parameters<typeof newAuditEntry>[0]['platform'];
  dimension?: Parameters<typeof newAuditEntry>[0]['dimension'];
  previousValue?: unknown;
  newValue?: unknown;
  triggeringSignals?: string[];
  operatorId?: string | null;
  notes?: string | null;
}): Promise<void> {
  const entry = newAuditEntry({
    action: opts.action,
    platform: opts.platform,
    dimension: opts.dimension,
    previousValue: opts.previousValue,
    newValue: opts.newValue,
    triggeringSignals: opts.triggeringSignals,
    operatorId: opts.operatorId,
    notes: opts.notes,
  });
  await appendAuditEntryByProject({
    userId: opts.userId,
    projectId: opts.projectId,
    entry,
  });
}
