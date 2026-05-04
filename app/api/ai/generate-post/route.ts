import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projects, generatedPosts } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { generatePost, type BrandContext } from '@/lib/ai/claude';
import { getTemplateById } from '@/lib/marketing/templates';
import { NextResponse } from 'next/server';

const VALID_PLATFORMS = ['instagram', 'facebook', 'linkedin', 'threads'] as const;
type Platform = (typeof VALID_PLATFORMS)[number];
const VALID_PLATFORM_SET = new Set(VALID_PLATFORMS);

function isPlatform(p: unknown): p is Platform {
  return typeof p === 'string' && VALID_PLATFORM_SET.has(p as Platform);
}

interface Generation {
  platform: Platform;
  content?: string;
  error?: string;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { projectId, platform, platforms, prompt, templateId } = body as {
    projectId?: string;
    platform?: unknown;
    platforms?: unknown;
    prompt?: string;
    templateId?: string;
  };

  // Accept either `platforms: Platform[]` (new) or `platform: Platform` (legacy
  // single-platform callers). Normalize to an array internally.
  const requested: unknown[] = Array.isArray(platforms)
    ? platforms
    : platform !== undefined
      ? [platform]
      : [];
  const validatedPlatforms = requested.filter(isPlatform);

  if (!projectId || !prompt || validatedPlatforms.length === 0) {
    return NextResponse.json(
      { error: 'projectId, prompt and at least one valid platform required' },
      { status: 400 }
    );
  }
  if (validatedPlatforms.length > 4) {
    return NextResponse.json({ error: 'Max 4 platforms' }, { status: 400 });
  }

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const template = getTemplateById(templateId);
  const brandContext = (project.brandContext as BrandContext | null) ?? null;

  // Generate one post per platform in parallel. Each settles independently
  // so a single platform failure doesn't poison the rest.
  const generations: Generation[] = await Promise.all(
    validatedPlatforms.map(async (p): Promise<Generation> => {
      try {
        const content = await generatePost({
          platform: p,
          prompt,
          context: {
            name: project.name,
            description: prompt,
            brandContext,
            templateHint: template?.systemHint ?? null,
          },
        });

        await db.insert(generatedPosts).values({
          projectId: project.id,
          platform: p,
          content,
          prompt,
        });

        return { platform: p, content };
      } catch (err) {
        console.error(`[GENERATE POST] failed for ${p}`, err);
        return {
          platform: p,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    })
  );

  // Backward-compat: old single-platform callers expected `{ content }`.
  // We keep that shape when there's exactly one generation and it succeeded.
  const single = generations.length === 1 ? generations[0] : null;
  const responseBody: {
    generations: Generation[];
    templateUsed: string | null;
    content?: string;
  } = {
    generations,
    templateUsed: template?.id ?? null,
  };
  if (single?.content) {
    responseBody.content = single.content;
  }

  return NextResponse.json(responseBody);
}
