import { NextResponse } from 'next/server';

// Lightweight status endpoint so the Settings page can show whether image
// generation is wired up without exposing the actual API key. We don't
// auth-gate it because it returns no user-specific data; just env presence.
export async function GET() {
  return NextResponse.json({
    falConfigured: !!process.env.FAL_API_KEY,
  });
}
