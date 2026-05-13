// PR #86 — Sprint 7.10: HeyGen enablement gates.
//
// Split into a separate module because Next.js 15 route files
// refuse to export anything besides HTTP method handlers (and a
// short whitelist of config exports like `dynamic` /
// `revalidate`). Pre-split these two helpers lived next to POST
// in route.ts and broke the type-check at build time.
//
// Two gates, deliberately separate:
//   1. Deployment-level — env vars set.
//   2. Project-level — the project has a usable avatar config.
//
// PR Sprint 7.13 hotfix — tolerant truthy parsing.
//
// Pre-hotfix the gate did `process.env.HEYGEN_ENABLED === 'true'`,
// strict equality. Vercel's dashboard allows trailing whitespace
// on env var values + accepts any capitalization, and the founder
// reported the gate failing despite HEYGEN_ENABLED=true being set
// (likely value was 'true ' with a trailing space, or 'TRUE').
// We now accept the canonical truthy tokens after a trim +
// lowercase. See /api/heygen/diag for a per-deploy diagnostic.

interface AvatarConfig {
  heygenAvatarType: string | null;
  heygenAvatarId: string | null;
  heygenPhotoUrl: string | null;
}

const TRUTHY = new Set(['true', '1', 'yes', 'on', 'enabled']);

function parseBoolish(raw: string | undefined): boolean {
  if (!raw) return false;
  return TRUTHY.has(raw.trim().toLowerCase());
}

export function isHeygenEnvConfigured(): boolean {
  const raw = process.env.HEYGEN_ENABLED;
  const enabled = parseBoolish(raw);
  const hasKey = Boolean(process.env.HEYGEN_API_KEY?.trim());
  const result = enabled && hasKey;
  // PR Sprint 7.13 hotfix — temporary runtime log to confirm why
  // the gate is firing false. Logs only at the first call per
  // cold start in practice (Next.js function instances reuse the
  // process) so it's a low-volume signal. Remove this log once
  // production has been verified green.
  if (!result) {
    console.log(
      '[heygen/gate] gate=false',
      JSON.stringify({
        HEYGEN_ENABLED_raw: raw ?? null,
        HEYGEN_ENABLED_parsed: enabled,
        HEYGEN_API_KEY_present: hasKey,
        vercelEnv: process.env.VERCEL_ENV ?? null,
      }),
    );
  }
  return result;
}

/**
 * Diagnostic snapshot of what the gate sees at runtime. Never
 * returns the API key itself — only presence + length so the UI
 * can render "key looks set (32 chars)" without leaking the
 * secret. The /api/heygen/diag endpoint surfaces this for
 * troubleshooting env-var scoping (Production vs Preview vs
 * Development) on Vercel.
 */
export function getHeygenEnvDiagnostic() {
  const raw = process.env.HEYGEN_ENABLED;
  const apiKey = process.env.HEYGEN_API_KEY;
  return {
    enabledRaw: raw ?? null,
    enabledLength: raw?.length ?? 0,
    enabledTrimmedLower: raw?.trim().toLowerCase() ?? null,
    enabledParsed: parseBoolish(raw),
    apiKeyPresent: Boolean(apiKey?.trim()),
    apiKeyLength: apiKey?.trim().length ?? 0,
    webhookSecretPresent: Boolean(
      process.env.HEYGEN_WEBHOOK_SECRET?.trim(),
    ),
    nodeEnv: process.env.NODE_ENV ?? null,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    finalResult: isHeygenEnvConfigured(),
  };
}

/**
 * Project-aware enablement. Returns true only when both:
 *   - The deployment env vars are set (isHeygenEnvConfigured), AND
 *   - The project has a valid avatar configuration.
 *
 * 'twin' is treated as not-yet-configured because the enrollment
 * flow isn't shipped — selecting twin in Settings keeps the
 * project in an un-generatable state by design.
 */
export function isHeygenReadyForProject(project: AvatarConfig): boolean {
  if (!isHeygenEnvConfigured()) return false;
  const t = project.heygenAvatarType ?? 'stock';
  if (t === 'stock') return Boolean(project.heygenAvatarId);
  if (t === 'photo') return Boolean(project.heygenPhotoUrl);
  return false; // 'twin' or unknown → not ready
}
