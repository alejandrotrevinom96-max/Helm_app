import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { sendWebhook } from '@/lib/webhooks/send';

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [row] = await db
    .select({ url: users.webhookUrl, secret: users.webhookSecret })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  if (!row?.url) {
    return NextResponse.json(
      { error: 'No webhook URL configured' },
      { status: 400 }
    );
  }

  const result = await sendWebhook(row.url, row.secret, {
    event: 'webhook.test',
    timestamp: new Date().toISOString(),
    data: {
      message:
        'This is a test webhook from Helm. If you see this, the integration works!',
    },
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        error: 'Webhook delivery failed',
        reason: result.error ?? `HTTP ${result.status} ${result.statusText ?? ''}`,
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    status: result.status,
    statusText: result.statusText,
  });
}
