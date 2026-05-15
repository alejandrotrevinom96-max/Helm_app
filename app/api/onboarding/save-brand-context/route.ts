// PR #74 — Sprint 7.2B: save the wizard's brand-step answers into
// the canonical BrandBible shape on projects.brandContext.
//
// CRITICAL: the plan originally proposed overwriting brandContext
// with a flat `{niche, audience, tone}` object. That would brick
// every downstream consumer — generate-post, compass deep-dives,
// blind-spots, marketing/scheduled all read
// `brandContext.identity?.name`, `brandContext.audience?.primary
// ?.description`, `brandContext.pillars`, etc. Replacing those
// with a flat shape returns undefined everywhere.
//
// Instead, we BUILD A MINIMAL VALID BrandBible by slotting the
// founder's answers into the existing structure:
//   - niche  → identity.industry + identity.mission (short
//              description of what the brand does)
//   - audience → audience.primary.description
//   - tone   → vocabulary.brandPhrases[0] (free-form voice notes
//              live there until the brand-bible-modal upgrades
//              them into the strict 0-10 voice calibration sliders)
//
// If a BrandBible already exists on the project we MERGE — only
// filling fields that are empty. The founder's later edits in the
// brand-bible-modal always win.
//
// The verbatim wizard inputs also get persisted to
// onboarding_progress.brandAnswers so the original phrasing is
// recoverable even after a BrandBible regeneration.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  projects,
  onboardingProgress,
} from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import type { BrandBible } from '@/lib/types/brand';
import { EMPTY_VOICE } from '@/lib/types/brand';
// PR Sprint 7.22 Sprint B — Patch 2 product bridges. Fire-and-forget
// background trigger that generates auto-approved bridges via the
// Haiku intake when conditions are met (>=3 audience pain points,
// no bridges yet, product framing present). The helper does the
// gating internally so this call is always safe.
import { maybeGenerateBridges } from '@/lib/voice-engine/maybe-generate-bridges';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function trimOrNull(v: unknown, max = 2000): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

// Build a minimal-but-valid BrandBible from the wizard answers.
// Every required field gets a sensible default — completionScore
// will be low (~25-35) which the brand-bible-modal uses to nudge
// the founder to refine via Auto-generate.
function seedBibleFromAnswers(
  projectName: string,
  oneLiner: string | null,
  niche: string | null,
  audience: string | null,
  tone: string | null,
): BrandBible {
  const now = new Date().toISOString();
  return {
    identity: {
      name: projectName,
      tagline: oneLiner,
      mission: niche, // "what the brand does" maps to mission
      vision: null,
      foundedYear: null,
      industry: niche, // also serves as industry hint for Compass
    },
    archetype: {
      primary: null,
      secondary: null,
      rationale: null,
    },
    pillars: [],
    voice: EMPTY_VOICE,
    vocabulary: {
      preferredTerms: [],
      bannedTerms: [],
      // tone is a free-form sentence; we stash it as a brand-phrase
      // so generators can cite it verbatim. The brand-bible-modal's
      // refine step can later move it into the 0-10 voice sliders.
      brandPhrases: tone ? [tone] : [],
      emojiPolicy: 'tasteful',
      hashtagPolicy: 'minimal',
    },
    nonNegotiables: [],
    audience: {
      primary: {
        description: audience ?? '',
        demographics: null,
        psychographics: null,
        painPoints: [],
        jobsToBeDone: [],
        toolsTried: [],
        wateringHoles: [],
      },
      antiPersona: {
        description: null,
        reasons: [],
      },
    },
    messaging: {
      primaryTagline: oneLiner,
      taglineVariants: [],
      valueProps: [],
      objections: [],
      antiPositioning: [],
    },
    visual: {
      colors: {
        primary: null,
        secondary: null,
        accent: null,
        neutral: null,
      },
      typography: { headingStyle: null, bodyStyle: null },
      imageStyle: null,
      photographyMood: null,
    },
    culturalMoments: [],
    meta: {
      autoDiscoveredAt: null,
      lastEditedAt: now,
      completionScore: 25, // low — nudges the refine flow
      sourceUrls: [],
      confidence: {
        identity: 'medium',
        archetype: 'low',
        pillars: 'low',
        audience: 'medium',
        voice: 'low',
        messaging: 'low',
      },
    },
  };
}

// Merge wizard answers into an existing BrandBible: only fill
// empties, never overwrite. The brand-bible-modal is the
// authoritative editor for the bible — wizard inputs are seed
// data, not source of truth.
function mergeIntoExistingBible(
  existing: BrandBible,
  projectName: string,
  oneLiner: string | null,
  niche: string | null,
  audience: string | null,
  tone: string | null,
): BrandBible {
  const merged: BrandBible = { ...existing };
  merged.identity = {
    ...existing.identity,
    name: existing.identity?.name ?? projectName,
    tagline: existing.identity?.tagline ?? oneLiner,
    mission: existing.identity?.mission ?? niche,
    industry: existing.identity?.industry ?? niche,
  };
  if (
    !existing.audience?.primary?.description ||
    existing.audience.primary.description.trim().length === 0
  ) {
    merged.audience = {
      ...existing.audience,
      primary: {
        ...existing.audience.primary,
        description: audience ?? existing.audience.primary.description ?? '',
      },
    };
  }
  if (tone) {
    const phrases = existing.vocabulary?.brandPhrases ?? [];
    if (!phrases.includes(tone)) {
      merged.vocabulary = {
        ...existing.vocabulary,
        brandPhrases: [...phrases, tone],
      };
    }
  }
  merged.meta = {
    ...existing.meta,
    lastEditedAt: new Date().toISOString(),
  };
  return merged;
}

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
    niche?: unknown;
    audience?: unknown;
    tone?: unknown;
    oneLiner?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const niche = trimOrNull(body.niche, 500);
  const audience = trimOrNull(body.audience, 500);
  const tone = trimOrNull(body.tone, 1000);
  const oneLiner = trimOrNull(body.oneLiner, 300);

  if (!niche && !audience) {
    return NextResponse.json(
      { error: 'niche or audience required' },
      { status: 400 },
    );
  }

  // Resolve the project: explicit projectId wins, otherwise
  // onboarding_progress.primaryProjectId, otherwise the most-recent
  // project owned by the user. This three-tier fallback handles
  // every wizard entry-point cleanly.
  let projectId: string | null = null;
  if (typeof body.projectId === 'string' && UUID_RE.test(body.projectId)) {
    projectId = body.projectId;
  }

  if (!projectId) {
    const [prog] = await db
      .select({ primaryProjectId: onboardingProgress.primaryProjectId })
      .from(onboardingProgress)
      .where(eq(onboardingProgress.userId, user.id))
      .limit(1);
    if (prog?.primaryProjectId) projectId = prog.primaryProjectId;
  }

  if (!projectId) {
    const [latest] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.userId, user.id))
      .orderBy(desc(projects.createdAt))
      .limit(1);
    if (latest) projectId = latest.id;
  }

  if (!projectId) {
    return NextResponse.json(
      { error: 'No project found for user — create one in step 2 first.' },
      { status: 400 },
    );
  }

  // Load the project + ownership-check + decide merge-vs-seed.
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const existing = project.brandContext as BrandBible | null;
  const nextBible = existing
    ? mergeIntoExistingBible(
        existing,
        project.name,
        oneLiner,
        niche,
        audience,
        tone,
      )
    : seedBibleFromAnswers(
        project.name,
        oneLiner,
        niche,
        audience,
        tone,
      );

  // projects table has no updatedAt column — the meta.lastEditedAt
  // inside brandContext is the source of truth for "when did this
  // bible change". The seed/merge helpers above already set it.
  await db
    .update(projects)
    .set({ brandContext: nextBible })
    .where(eq(projects.id, projectId));

  // PR Sprint 7.22 Sprint B — Patch 2 product bridges auto-trigger.
  // Fire-and-forget: the helper checks gating conditions internally
  // (audience.primary.painPoints >= 3, no bridges already, product
  // framing present) and either generates a fresh set via the Haiku
  // intake + auto-approves them, or no-ops silently. We deliberately
  // do NOT await — the founder gets the save response immediately
  // and bridges land in the background within ~5s.
  //
  // Triggering here means: every time the wizard saves the brand
  // step, we re-check whether bridges should be generated. The
  // helper is idempotent (won't run again once 3+ approved bridges
  // exist), so re-saves are cheap.
  void maybeGenerateBridges(projectId, user.id);

  return NextResponse.json({
    success: true,
    projectId,
    completionScore: nextBible.meta.completionScore,
  });
}
