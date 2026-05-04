import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import {
  generateVisual,
  type AspectRatio,
} from '@/lib/visuals/generate';
import { uploadVisualFromUrl } from '@/lib/visuals/storage';
import { checkRateLimit } from '@/lib/rate-limit';
import type { BrandBible, ImageStyle } from '@/lib/types/brand';

// Vercel: image gen takes ~8s typically; 60s is enough headroom for slow
// fal.ai responses without paying for the full 300s Pro budget.
export const maxDuration = 60;

const VALID_PLATFORMS = new Set([
  'instagram',
  'facebook',
  'linkedin',
  'threads',
]);
const VALID_ASPECT: Set<AspectRatio> = new Set<AspectRatio>([
  'square',
  'portrait',
  'landscape',
]);

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Rate limit: 30 visuals per hour per user. At $0.05/image that caps
  // accidental generation runs at $1.50/hr — enough to catch loops without
  // blocking normal use.
  const limit = checkRateLimit(`visual:${user.id}`, 30, 60 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
        hint: `Try again in ${Math.ceil(limit.resetMs / 60000)} minutes.`,
        cost_protection: true,
      },
      { status: 429 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const { projectId, platform, postContent, style, aspectRatio } = body as {
    projectId?: string;
    platform?: string;
    postContent?: string;
    style?: ImageStyle;
    aspectRatio?: AspectRatio;
  };

  if (!projectId || !platform || !postContent) {
    return NextResponse.json(
      { error: 'projectId, platform, postContent required' },
      { status: 400 }
    );
  }
  if (!VALID_PLATFORMS.has(platform)) {
    return NextResponse.json({ error: 'Invalid platform' }, { status: 400 });
  }
  if (aspectRatio && !VALID_ASPECT.has(aspectRatio)) {
    return NextResponse.json(
      { error: 'Invalid aspectRatio' },
      { status: 400 }
    );
  }

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (!process.env.FAL_API_KEY) {
    return NextResponse.json(
      {
        error: 'Image generation not configured',
        hint: 'FAL_API_KEY env var is missing. Configure it in Vercel dashboard.',
      },
      { status: 503 }
    );
  }

  const result = await generateVisual({
    platform: platform as 'instagram' | 'facebook' | 'linkedin' | 'threads',
    postContent,
    brandBible: (project.brandContext as BrandBible | null) ?? null,
    style,
    aspectRatio,
  });

  if (!result) {
    return NextResponse.json(
      {
        error: 'Visual generation failed',
        hint: 'fal.ai returned no result. Check server logs.',
      },
      { status: 502 }
    );
  }

  // Re-host the image so it survives past fal.ai's CDN TTL. If the bucket
  // isn't configured yet, we fall back to fal's URL — at least the user
  // sees the image during this session.
  const tempPostId = `temp-${Date.now()}`;
  const uploaded = await uploadVisualFromUrl(result.url, user.id, tempPostId);

  return NextResponse.json({
    ok: true,
    visual: {
      url: uploaded?.publicUrl ?? result.url,
      prompt: result.prompt,
      width: result.width,
      height: result.height,
      cost: result.costEstimate,
      provider: result.provider,
      persisted: !!uploaded,
    },
  });
}
