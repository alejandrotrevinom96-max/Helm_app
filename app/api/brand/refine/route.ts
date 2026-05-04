import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { anthropic } from '@/lib/ai/claude';
import { NextResponse } from 'next/server';
import {
  computeCompletionScore,
  type BrandBible,
  type Confidence,
} from '@/lib/types/brand';

interface RefineQuestion {
  id: string;
  field: string;
  question: string;
  type: 'single_select' | 'multi_select' | 'text' | 'longtext' | 'slider';
  options?: Array<{ value: string; label: string; description?: string }>;
  helper?: string;
  min?: number;
  max?: number;
}

const ARCHETYPE_OPTIONS = [
  { value: 'hero', label: 'Hero', description: 'Courage, mastery, "we can do hard things" (Nike, Apple)' },
  { value: 'sage', label: 'Sage', description: 'Wisdom, truth, expertise (Google, NYT)' },
  { value: 'outlaw', label: 'Outlaw', description: 'Disruption, rebellion (Harley, Tesla)' },
  { value: 'creator', label: 'Creator', description: 'Vision, craft, expression (Adobe, Lego)' },
  { value: 'caregiver', label: 'Caregiver', description: 'Compassion, service (Volvo, UNICEF)' },
  { value: 'magician', label: 'Magician', description: 'Transformation, vision (Disney, Tesla)' },
  { value: 'ruler', label: 'Ruler', description: 'Authority, control (Mercedes, Microsoft)' },
  { value: 'jester', label: 'Jester', description: 'Joy, wit, lightness (M&Ms, Old Spice)' },
  { value: 'everyman', label: 'Everyman', description: 'Belonging, relatable (IKEA, Target)' },
  { value: 'lover', label: 'Lover', description: 'Passion, intimacy (Chanel, Häagen-Dazs)' },
  { value: 'innocent', label: 'Innocent', description: 'Optimism, simplicity (Coca-Cola, Dove)' },
  { value: 'explorer', label: 'Explorer', description: 'Freedom, discovery (REI, Jeep)' },
];

const PILLAR_OPTIONS = [
  { value: 'speed', label: 'Speed', description: 'Fast, ship-now energy' },
  { value: 'craft', label: 'Craft', description: 'Attention to detail, quality' },
  { value: 'honesty', label: 'Honesty', description: 'Transparent, no BS' },
  { value: 'independence', label: 'Independence', description: 'Self-reliant, indie' },
  { value: 'pragmatism', label: 'Pragmatism', description: 'Practical, no fluff' },
  { value: 'curiosity', label: 'Curiosity', description: 'Always learning' },
  { value: 'ambition', label: 'Ambition', description: 'Big goals, no apologies' },
  { value: 'simplicity', label: 'Simplicity', description: 'Less, but better' },
  { value: 'resilience', label: 'Resilience', description: 'Tough through hard stuff' },
  { value: 'community', label: 'Community', description: 'We over me' },
];

const LOW_CONFIDENCE: Confidence[] = ['low', 'inferred'];

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('projectId');
  if (!projectId) {
    return NextResponse.json({ error: 'projectId required' }, { status: 400 });
  }

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const bible = project.brandContext as BrandBible | null;
  if (!bible || !bible.meta) {
    return NextResponse.json(
      { error: 'No brand bible. Run discovery first.' },
      { status: 400 }
    );
  }

  const conf = bible.meta.confidence ?? {
    identity: 'inferred',
    archetype: 'inferred',
    pillars: 'inferred',
    voice: 'inferred',
    audience: 'inferred',
    messaging: 'inferred',
  };

  const questions: RefineQuestion[] = [];

  // Ask only what we couldn't pin down with high confidence — the indie
  // founder shouldn't repeat work the AI already did from their site.
  if (conf.archetype !== 'high') {
    questions.push({
      id: 'archetype-confirm',
      field: 'archetype.primary',
      question: bible.archetype?.primary
        ? `We sensed your brand archetype is ${bible.archetype.primary}. Does that feel right?`
        : 'What archetype best fits your brand?',
      type: 'single_select',
      helper:
        bible.archetype?.rationale ??
        'Brand archetypes describe the core personality of a brand.',
      options: ARCHETYPE_OPTIONS,
    });
  }

  if ((bible.pillars?.length ?? 0) < 3 || LOW_CONFIDENCE.includes(conf.pillars)) {
    questions.push({
      id: 'pillars-confirm',
      field: 'pillars',
      question:
        bible.pillars && bible.pillars.length > 0
          ? `We identified these pillars: ${bible.pillars.map((p) => p.name).join(', ')}. Add or replace any?`
          : 'What 3-5 attributes should your brand always evoke?',
      type: 'multi_select',
      helper:
        'Pillars are the values that show up in EVERY communication. Pick 3-5.',
      options: PILLAR_OPTIONS,
    });
  }

  if (
    !bible.audience?.primary?.description ||
    (bible.audience?.primary?.painPoints?.length ?? 0) < 2
  ) {
    questions.push({
      id: 'audience-pain',
      field: 'audience.primary.painPoints',
      question: 'What is the #1 pain your audience feels every day?',
      type: 'longtext',
      helper:
        'Be specific. "Tool fragmentation" is generic. "I have 12 dashboards open and I still can\'t tell which feature drove last week\'s signups" is specific.',
    });
  }

  if ((bible.vocabulary?.bannedTerms?.length ?? 0) === 0) {
    questions.push({
      id: 'vocabulary-banned',
      field: 'vocabulary.bannedTerms',
      question: 'What words or phrases should your brand NEVER use?',
      type: 'longtext',
      helper:
        'Examples: "leverage" (corporate jargon), "synergy" (consultancy speak), "game-changer" (overused). 3-5 examples.',
    });
  }

  if ((bible.nonNegotiables?.length ?? 0) < 3) {
    questions.push({
      id: 'non-negotiables',
      field: 'nonNegotiables',
      question: 'What does your brand NEVER do?',
      type: 'longtext',
      helper:
        'Examples: "Never compare to competitors by name", "Never use aspirational language we can\'t back up", "Never post without proof points".',
    });
  }

  if (!bible.audience?.antiPersona?.description) {
    questions.push({
      id: 'anti-persona',
      field: 'audience.antiPersona.description',
      question: 'Who is NOT your audience?',
      type: 'text',
      helper:
        'Defining who you DON\'T serve sharpens who you DO. Example: "Enterprise teams with 100+ employees and a brand committee" or "Hobbyists who don\'t intend to monetize".',
    });
  }

  return NextResponse.json({
    questions,
    bible: {
      archetype: bible.archetype?.primary ?? null,
      pillars: bible.pillars?.map((p) => p.name) ?? [],
      audienceDescription: bible.audience?.primary?.description ?? null,
      completionScore: bible.meta.completionScore ?? 0,
    },
  });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { projectId, answers } = body as {
    projectId?: string;
    answers?: Record<string, unknown>;
  };

  if (!projectId || !answers || typeof answers !== 'object') {
    return NextResponse.json(
      { error: 'projectId and answers required' },
      { status: 400 }
    );
  }

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const bible = project.brandContext as BrandBible | null;
  if (!bible) return NextResponse.json({ error: 'No bible' }, { status: 400 });

  // Use Opus to turn raw user answers into bible-shaped updates. Cheaper
  // than rebuilding the whole bible — we only synthesize the changed parts.
  const synthPrompt = `You are refining a brand bible based on user answers. Take their raw answers and produce structured updates that fit the existing bible schema.

Return STRICTLY valid JSON, no preamble or markdown fences. Output the keys you want to UPDATE (omit any that don't apply):
{
  "archetype": { "primary": "<archetype>", "rationale": "<2 sentences>" },
  "pillars": [{ "name": "<Title Case>", "description": "<one sentence>", "weight": 0-100 }],
  "audience.primary.painPoints": [{ "pain": "<specific>", "intensity": 1-5 }],
  "vocabulary.bannedTerms": [{ "term": "<word>", "reason": "<why>" }],
  "nonNegotiables": ["<rule>"],
  "audience.antiPersona": { "description": "<who>", "reasons": ["<why>"] }
}

USER ANSWERS:
${JSON.stringify(answers, null, 2)}

EXISTING BIBLE CONTEXT (for alignment, do not duplicate):
- Industry: ${bible.identity?.industry ?? 'unknown'}
- Voice scores: ${JSON.stringify(bible.voice ?? {})}
- Existing pillars: ${JSON.stringify(bible.pillars ?? [])}

Be specific and aligned with the existing brand voice.`;

  let response;
  try {
    response = await anthropic.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 4000,
      messages: [{ role: 'user', content: synthPrompt }],
    });
  } catch (e) {
    console.error('[BRAND REFINE] synthesis failed', e);
    return NextResponse.json(
      {
        error: 'Synthesis failed',
        reason: e instanceof Error ? e.message : String(e),
      },
      { status: 502 }
    );
  }

  const textBlock = response.content.find((b) => b.type === 'text');
  let raw = textBlock?.type === 'text' ? textBlock.text.trim() : '';
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  let updates: Record<string, unknown>;
  try {
    updates = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: 'Could not parse synthesis' },
      { status: 502 }
    );
  }

  // Apply each update only if Opus actually returned that key. Confidence
  // bumps to 'high' on user-confirmed sections — the user just told us.
  if (updates.archetype && typeof updates.archetype === 'object') {
    bible.archetype = {
      ...bible.archetype,
      ...(updates.archetype as Partial<BrandBible['archetype']>),
    };
    bible.meta.confidence.archetype = 'high';
  }
  if (Array.isArray(updates.pillars)) {
    bible.pillars = updates.pillars as BrandBible['pillars'];
    bible.meta.confidence.pillars = 'high';
  }
  if (Array.isArray(updates['audience.primary.painPoints'])) {
    bible.audience.primary.painPoints = updates[
      'audience.primary.painPoints'
    ] as BrandBible['audience']['primary']['painPoints'];
    bible.meta.confidence.audience = 'high';
  }
  if (Array.isArray(updates['vocabulary.bannedTerms'])) {
    bible.vocabulary.bannedTerms = updates[
      'vocabulary.bannedTerms'
    ] as BrandBible['vocabulary']['bannedTerms'];
  }
  if (Array.isArray(updates.nonNegotiables)) {
    bible.nonNegotiables = updates.nonNegotiables as string[];
  }
  if (
    updates['audience.antiPersona'] &&
    typeof updates['audience.antiPersona'] === 'object'
  ) {
    bible.audience.antiPersona = {
      ...bible.audience.antiPersona,
      ...(updates['audience.antiPersona'] as Partial<
        BrandBible['audience']['antiPersona']
      >),
    };
  }

  bible.meta.lastEditedAt = new Date().toISOString();
  bible.meta.completionScore = computeCompletionScore(bible);

  await db
    .update(projects)
    .set({ brandContext: bible })
    .where(eq(projects.id, projectId));

  return NextResponse.json({
    ok: true,
    bible,
    completionScore: bible.meta.completionScore,
  });
}
