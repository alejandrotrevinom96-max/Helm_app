import { getDashboardData } from '@/lib/analytics/dashboard';
import { NextResponse } from 'next/server';

export async function GET() {
  const data = await getDashboardData();
  if ('error' in data) {
    return NextResponse.json({ error: data.error }, { status: data.status });
  }
  return NextResponse.json(data);
}
