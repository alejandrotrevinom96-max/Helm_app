// Sprint 7.13 hotfix — HeyGen runtime diagnostic.
//
// GET /api/heygen/diag → returns the runtime state of the env
// vars the gate keys off, plus the canonical Vercel deployment
// metadata (VERCEL_ENV) so the founder can spot the common
// "set the var only for Production but I'm on Preview" scoping
// mistake at a glance.
//
// CRITICAL: this endpoint NEVER returns the API key itself —
// only presence + length. The webhook secret is treated the
// same way. We also gate read access behind a logged-in user
// so a scraper can't trivially fingerprint our envs.
//
// Why we ship this even after the hotfix lands:
// Vercel env-var changes apply on the NEXT deploy, not
// retroactively. A founder who fixes HEYGEN_ENABLED in the
// dashboard but doesn't trigger a redeploy will keep seeing
// the old value. This endpoint shows them exactly what the
// runtime sees — no guessing.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getHeygenEnvDiagnostic } from '@/lib/heygen/gate';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const diag = getHeygenEnvDiagnostic();

  // Log to Vercel function logs too so the founder can grep
  // logs even when they don't have a session handy.
  console.log('[heygen/diag]', JSON.stringify(diag));

  return NextResponse.json({
    diag,
    hint: !diag.finalResult
      ? diag.apiKeyPresent
        ? `HEYGEN_ENABLED parsed to ${diag.enabledParsed} (raw: ${JSON.stringify(diag.enabledRaw)}). Expected "true" / "1" / "yes" / "on" / "enabled" after trim+lowercase.`
        : 'HEYGEN_API_KEY is missing or empty. Set it in Vercel dashboard → Project Settings → Environment Variables, scoped to Production (and Preview if you want PR previews to work too).'
      : 'HeyGen env is configured correctly.',
  });
}
