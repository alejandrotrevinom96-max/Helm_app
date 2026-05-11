// PR #59 — Sprint 7.0.3: public read of the Reddit RSS health
// counter. No auth requirement — the value is non-sensitive and the
// UI surfaces it as a status badge.
import { getRedditHealth } from '@/lib/research/reddit-rss';
import { NextResponse } from 'next/server';

export async function GET() {
  const status = await getRedditHealth();
  return NextResponse.json(status);
}
