import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import crypto from 'crypto';

// We never return the actual secret value via GET — only whether one exists.
// The user gets to copy it exactly once at generation time.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [row] = await db
    .select({ url: users.webhookUrl, secret: users.webhookSecret })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  return NextResponse.json({
    url: row?.url ?? null,
    hasSecret: !!row?.secret,
  });
}

// PATCH accepts either { url: string|null } to set/clear the URL, or
// { regenerateSecret: true } to mint a new HMAC key. Returning the new
// secret happens ONLY in the regenerate response.
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { url, regenerateSecret } = body as {
    url?: unknown;
    regenerateSecret?: unknown;
  };

  const updates: { webhookUrl?: string | null; webhookSecret?: string } = {};

  if (url !== undefined) {
    if (url === null || url === '') {
      updates.webhookUrl = null;
    } else if (typeof url !== 'string') {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
    } else {
      try {
        const u = new URL(url);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') {
          return NextResponse.json(
            { error: 'URL must be http or https' },
            { status: 400 }
          );
        }
        // In production we strongly prefer HTTPS, but allow http://localhost
        // and http://127.0.0.1 so users can develop receivers locally.
        if (
          u.protocol === 'http:' &&
          u.hostname !== 'localhost' &&
          u.hostname !== '127.0.0.1'
        ) {
          return NextResponse.json(
            { error: 'HTTPS required (HTTP allowed only for localhost)' },
            { status: 400 }
          );
        }
        updates.webhookUrl = url;
      } catch {
        return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
      }
    }
  }

  let newSecret: string | undefined;
  if (regenerateSecret === true) {
    newSecret = crypto.randomBytes(32).toString('hex');
    updates.webhookSecret = newSecret;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
  }

  await db.update(users).set(updates).where(eq(users.id, user.id));

  if (newSecret) {
    return NextResponse.json({ ok: true, secret: newSecret });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await db
    .update(users)
    .set({ webhookUrl: null, webhookSecret: null })
    .where(eq(users.id, user.id));

  return NextResponse.json({ ok: true });
}
