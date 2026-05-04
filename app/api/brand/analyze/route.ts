import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projects, users } from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { anthropic } from '@/lib/ai/claude';
import { NextResponse } from 'next/server';

const SYSTEM_PROMPT = `You are a brand strategist. Given a URL/content or description, extract:
- voice: 1-line description of writing voice
- tone: 2-3 adjectives from this list: serious, playful, bold, calm, technical, casual, formal, witty, urgent, friendly
- audience: who this product is for (1 sentence)
- keyPhrases: 3-5 phrases the brand actually uses
- productFocus: what main thing they sell

Output ONLY valid JSON, no preamble. Format:
{"voice":"...","tone":["..."],"audience":"...","keyPhrases":["..."],"productFocus":"..."}`;

function stripHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 5000);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { projectId, url, manualDescription } = await request.json();

  if (!projectId) {
    return NextResponse.json({ error: 'projectId required' }, { status: 400 });
  }
  if (!url && !manualDescription) {
    return NextResponse.json(
      { error: 'Either url or manualDescription is required' },
      { status: 400 }
    );
  }

  // Anti-tampering: verify the project belongs to this user.
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let pageContent = '';
  if (url) {
    try {
      new URL(url);
    } catch {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Helm/1.0 (+https://helm2.vercel.app)' },
      });
      clearTimeout(timeout);
      const html = await res.text();
      pageContent = stripHtml(html);
      if (!pageContent) {
        return NextResponse.json(
          {
            error: 'Page returned no readable content',
            hint: 'The site may be JS-rendered. Use manual description instead.',
          },
          { status: 500 }
        );
      }
    } catch (e) {
      return NextResponse.json(
        {
          error: 'Could not fetch URL',
          detail: e instanceof Error ? e.message : String(e),
          hint: 'Use manual description instead.',
        },
        { status: 500 }
      );
    }
  }

  const inputText = url
    ? `URL: ${url}\n\nPage content:\n${pageContent}`
    : `Manual description:\n${manualDescription}`;

  let response;
  try {
    response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: inputText }],
    });
  } catch (e) {
    console.error('[BRAND ANALYZE] Anthropic call failed', e);
    return NextResponse.json(
      {
        error: 'AI call failed',
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 500 }
    );
  }

  const textBlock = response.content.find((b) => b.type === 'text');
  const text = textBlock?.type === 'text' ? textBlock.text : '{}';

  let parsed: {
    voice?: string;
    tone?: string[];
    audience?: string;
    keyPhrases?: string[];
    productFocus?: string;
  };
  try {
    // Sometimes the model wraps JSON in ```json ... ``` even with strict prompt.
    const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return NextResponse.json(
      {
        error: 'Could not parse brand analysis',
        raw: text,
      },
      { status: 500 }
    );
  }

  const brandContext = {
    ...parsed,
    extractedAt: new Date().toISOString(),
  };

  await db
    .update(projects)
    .set({
      brandUrl: url || null,
      brandContext,
    })
    .where(eq(projects.id, projectId));

  // Configuring brand context = wizard step 3 done. Bump past it (but never
  // demote if they're already at 99/completed).
  await db
    .update(users)
    .set({ onboardingStep: sql`GREATEST(${users.onboardingStep}, 4)` })
    .where(eq(users.id, user.id));

  return NextResponse.json({ brandContext });
}
