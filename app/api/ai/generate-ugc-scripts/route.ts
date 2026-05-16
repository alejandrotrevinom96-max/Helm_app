// PR Sprint 7.27 — Asset-based content flow: UGC script A/B picker.
//
// POST /api/ai/generate-ugc-scripts
//   Body: { projectId, prompt, assetType }  (assetType in 'ugc_video' | 'reel')
//
// Generates TWO 30-second talking-head script variants in parallel
// via Haiku, both passing through Helm's UGC prompt engineering
// (hook in first 3s, ONE insight, CTA close, 70-90 words). The
// variants differ in HOOK STYLE so the founder can pick a take
// before we burn a $0.10 HeyGen render on it:
//
//   Variant A — DIRECT: state the insight plainly up front, prove
//   it, ask for action. Best for analytical / B2B audiences.
//
//   Variant B — STORY: open with a question or 1-line scenario,
//   reveal the insight mid-script, close with reflection. Best
//   for creator / consumer audiences.
//
// Stateless: no DB writes. The chosen script flows into
// /api/ai/generate-asset via the new `baseContentOverride` body
// field, which bypasses the endpoint's own baseContent generator
// and uses the founder-picked script verbatim. That endpoint then
// runs the per-platform caption adaptations + queues HeyGen as
// before.
//
// Why a separate endpoint vs a phase param on generate-asset:
//   - Stateless: no project ownership check until the founder
//     commits. The actual asset creation has its own scoping.
//   - Fast cold path: skips schema imports we don't need here.
//   - Cleaner client state machine: the panel knows it's in the
//     "show A/B" phase based on the endpoint it just called.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import {
  anthropic,
  MODELS,
  cachedSystem,
  LANGUAGE_INSTRUCTION_AUDIENCE,
} from '@/lib/ai/claude';
import type { BrandBible } from '@/lib/types/brand';

// Two parallel Haiku calls, each ~3-5s. 30s ceiling gives plenty
// of headroom for a cache miss on the system prompt.
export const maxDuration = 30;

interface RequestBody {
  projectId?: string;
  prompt?: string;
  assetType?: string;
}

// Hook-style directives. Kept as terse 2-sentence rules so they
// don't dilute the shared UGC_RULES below. The model picks up on
// the LABEL ("DIRECT" / "STORY") and biases the opening line.
const VARIANT_DIRECTIVES: Record<'A' | 'B', string> = {
  A:
    'HOOK STYLE: DIRECT. Open by stating the insight plainly in the first line. ' +
    'Body proves the claim with one concrete example. Close with a clear single-step CTA.',
  B:
    'HOOK STYLE: STORY. Open with a question OR a one-sentence scenario the viewer ' +
    'recognizes. Reveal the insight at mid-script as the payoff. Close with a reflection or soft CTA.',
};

// Shared UGC prompt engineering. Same rule list used by the
// baseContent generator inside generate-asset for ugc_video/reel
// — keep them aligned so an A/B "pick" produces a script that
// generate-asset will accept as-is when handed back via
// baseContentOverride. Drift between the two would mean the
// founder's chosen script gets silently re-shaped at the next
// step.
const UGC_RULES = [
  'Write a 30-second talking-head SCRIPT the founder will read on camera.',
  'Hook in the first 3 seconds — a viewer who scrolls past line 1 is lost forever.',
  'Body delivers exactly ONE insight. No multi-point lists.',
  'End with a single-line CTA (max 12 words).',
  'Plain prose, no stage directions, no camera notes, no markdown, no quotes around the output.',
  'Total target: 70-90 words. Never exceed 110.',
];

function brandSummary(bb: BrandBible | null): string {
  if (!bb) {
    return '(no brand bible yet — write in a neutral, professional voice)';
  }
  const parts: string[] = [];
  if (bb.identity?.name) parts.push(`Brand: ${bb.identity.name}`);
  if (bb.identity?.industry) parts.push(`Industry: ${bb.identity.industry}`);
  if (bb.identity?.tagline) parts.push(`Tagline: ${bb.identity.tagline}`);
  if (bb.audience?.primary?.description) {
    parts.push(`Audience: ${bb.audience.primary.description}`);
  }
  if (Array.isArray(bb.pillars) && bb.pillars.length > 0) {
    const names = bb.pillars
      .map((p) => p?.name)
      .filter(Boolean)
      .join(', ');
    if (names) parts.push(`Pillars: ${names}`);
  }
  if (bb.voice) {
    const v = bb.voice;
    const traits: string[] = [];
    traits.push(v.formal >= 6 ? 'formal' : v.formal <= 4 ? 'casual' : 'neutral');
    traits.push(v.serious >= 6 ? 'serious' : v.serious <= 4 ? 'playful' : 'balanced');
    traits.push(v.bold >= 6 ? 'bold' : v.bold <= 4 ? 'reserved' : 'measured');
    traits.push(
      v.innovative >= 6
        ? 'innovative'
        : v.innovative <= 4
          ? 'traditional'
          : 'modern',
    );
    traits.push(
      v.approachable >= 6
        ? 'welcoming'
        : v.approachable <= 4
          ? 'exclusive'
          : 'professional',
    );
    parts.push(`Voice: ${traits.join(', ')}`);
  }
  return parts.length > 0
    ? parts.join('\n')
    : '(brand bible present but mostly empty — neutral professional voice)';
}

function textFromMessage(
  content: Array<{ type: string; text?: string }>,
): string {
  return content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text?: string }).text ?? '')
    .join('')
    .trim();
}

async function generateScript(args: {
  variant: 'A' | 'B';
  prompt: string;
  brand: string;
}): Promise<string> {
  const systemText = [
    'You write 30-second UGC scripts a founder will read on camera.',
    'Your output goes directly to a HeyGen avatar render — every word is spoken.',
    '',
    'BRAND CONTEXT (treat as authoritative):',
    args.brand,
    '',
    'RULES:',
    ...UGC_RULES.map((r) => `- ${r}`),
    '',
    VARIANT_DIRECTIVES[args.variant],
    '',
    LANGUAGE_INSTRUCTION_AUDIENCE,
  ].join('\n');

  const resp = await anthropic.messages.create({
    model: MODELS.HAIKU,
    max_tokens: 800,
    system: cachedSystem(systemText),
    messages: [
      {
        role: 'user',
        content: `Topic the founder wants this UGC video to address:\n\n${args.prompt}`,
      },
    ],
  });
  return textFromMessage(
    resp.content as Array<{ type: string; text?: string }>,
  );
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as RequestBody;
    const projectId = body.projectId;
    const prompt = (body.prompt ?? '').trim();
    const assetType = body.assetType;
    if (!projectId || !prompt || !assetType) {
      return NextResponse.json(
        { error: 'projectId, prompt, and assetType are required' },
        { status: 400 },
      );
    }
    if (assetType !== 'ugc_video' && assetType !== 'reel') {
      return NextResponse.json(
        {
          error:
            'A/B script flow is only for ugc_video and reel asset types',
        },
        { status: 400 },
      );
    }

    // Ownership check — we don't write anything but the brand
    // bible read still has to be scoped so a malicious caller
    // can't probe another founder's voice fingerprint.
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
      .limit(1);
    if (!project) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const brand = brandSummary(
      (project.brandContext as BrandBible | null) ?? null,
    );

    // Two variants in parallel. Anthropic's prompt cache means the
    // second call re-uses the cached system prefix → near-zero
    // marginal latency for the second variant.
    const settled = await Promise.allSettled([
      generateScript({ variant: 'A', prompt, brand }),
      generateScript({ variant: 'B', prompt, brand }),
    ]);

    const variants: Array<{ label: 'A' | 'B'; text: string }> = [];
    const errors: Array<{ label: 'A' | 'B'; error: string }> = [];
    settled.forEach((r, i) => {
      const label = (i === 0 ? 'A' : 'B') as 'A' | 'B';
      if (r.status === 'fulfilled' && r.value) {
        variants.push({ label, text: r.value });
      } else {
        errors.push({
          label,
          error:
            r.status === 'rejected'
              ? r.reason instanceof Error
                ? r.reason.message
                : String(r.reason)
              : 'Empty script returned',
        });
      }
    });

    if (variants.length === 0) {
      return NextResponse.json(
        {
          error: 'Both variants failed to generate',
          partialErrors: errors,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      variants,
      partialErrors: errors.length > 0 ? errors : undefined,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : 'Script generation failed',
      },
      { status: 500 },
    );
  }
}
