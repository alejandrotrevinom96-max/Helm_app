import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import {
  generateCarousel,
  type CarouselSlide,
  type CarouselTemplate,
} from '@/lib/visuals/carousel';
import { anthropic } from '@/lib/ai/claude';
import { checkRateLimit } from '@/lib/rate-limit';
import type { BrandBible } from '@/lib/types/brand';

// Carousels = Chromium spawn + N pages + screenshots. ~30-60s realistic.
// Bumped past Vercel's default 10s; 120s gives headroom for cold starts.
export const maxDuration = 120;

const VALID_TEMPLATES: CarouselTemplate[] = [
  'milestone',
  'educational',
  'behind-scenes',
  'hot-take',
];

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Carousels are heavier than image gen (Chromium boot + N screenshots),
  // so the per-hour cap is tighter.
  const limit = checkRateLimit(`carousel:${user.id}`, 10, 60 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
        hint: `Try again in ${Math.ceil(limit.resetMs / 60000)} minutes.`,
      },
      { status: 429 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const { projectId, postContent, template = 'educational' } = body as {
    projectId?: string;
    postContent?: string;
    template?: CarouselTemplate;
  };

  if (!projectId || !postContent) {
    return NextResponse.json(
      { error: 'projectId and postContent required' },
      { status: 400 }
    );
  }
  if (!VALID_TEMPLATES.includes(template)) {
    return NextResponse.json({ error: 'Invalid template' }, { status: 400 });
  }

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Step 1: Haiku turns the long-form post into 5 structured slide objects.
  const slidePrompt = `Convert the following social post into a ${template} carousel of 5 slides.

POST CONTENT:
${postContent}

OUTPUT JSON only (no markdown, no preamble):
{
  "slides": [
    { "type": "hook", "title": "...", "body": "...", "highlight": "..." },
    { "type": "point", "title": "...", "body": "...", "highlight": "..." },
    { "type": "point", "title": "...", "body": "...", "highlight": "..." },
    { "type": "point", "title": "...", "body": "...", "highlight": "..." },
    { "type": "closing", "title": "...", "body": "...", "highlight": "..." }
  ]
}

RULES:
- Slide 1 (hook): Catch attention. Use big number or provocative statement.
- Slides 2-4 (points): Each makes ONE point. Title is short header. Body is 1-2 sentences.
- Slide 5 (closing): Call-to-action or memorable closer.
- Keep "body" text under 25 words per slide (mobile readability).
- "highlight" optional — include if there's a number/stat to emphasize.
- "title" optional but encouraged for points.`;

  let slidesData: { slides?: CarouselSlide[] };
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages: [{ role: 'user', content: slidePrompt }],
    });
    const textBlock = response.content.find((b) => b.type === 'text');
    let raw = textBlock?.type === 'text' ? textBlock.text.trim() : '';
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    slidesData = JSON.parse(raw) as { slides?: CarouselSlide[] };
  } catch (e) {
    return NextResponse.json(
      {
        error: 'Slide generation failed',
        reason: e instanceof Error ? e.message : String(e),
      },
      { status: 502 }
    );
  }

  if (!slidesData.slides || slidesData.slides.length === 0) {
    return NextResponse.json(
      { error: 'AI returned no slides' },
      { status: 502 }
    );
  }

  // Step 2: render each slide HTML→PNG via @sparticuz/chromium.
  const result = await generateCarousel({
    template,
    slides: slidesData.slides,
    brandBible: (project.brandContext as BrandBible | null) ?? null,
  });

  if (!result) {
    return NextResponse.json(
      {
        error: 'Carousel rendering failed',
        hint: 'Chromium may not be available on this runtime. Check server logs.',
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, carousel: result });
}
