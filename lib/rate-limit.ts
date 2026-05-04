// Tiny in-memory token bucket. Defense-in-depth, not a real protection layer:
// the Map lives in the Node process and dies with it, and Vercel can route
// concurrent requests to different lambda instances. For production-grade
// limiting use Upstash or similar.
//
// Use case here: prevent a logged-in user from triggering Opus 50 times in
// a row by accident. Good enough for ~20 founders.
const recentCalls = new Map<string, number[]>();

export function checkRateLimit(
  key: string,
  maxCalls: number,
  windowMs: number
): { allowed: boolean; resetMs: number } {
  const now = Date.now();
  const calls = recentCalls.get(key) ?? [];
  const recentInWindow = calls.filter((t) => now - t < windowMs);

  if (recentInWindow.length >= maxCalls) {
    const oldest = recentInWindow[0];
    return { allowed: false, resetMs: windowMs - (now - oldest) };
  }

  recentInWindow.push(now);
  recentCalls.set(key, recentInWindow);
  return { allowed: true, resetMs: 0 };
}
