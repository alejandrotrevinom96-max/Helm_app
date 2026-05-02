import { db } from '@/lib/db';
import { waitlistSignups } from '@/lib/db/schema';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const { pageId, email } = await request.json();
  if (!pageId || !email) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }
  try {
    await db.insert(waitlistSignups).values({ waitlistPageId: pageId, email });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
