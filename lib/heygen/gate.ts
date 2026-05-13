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

interface AvatarConfig {
  heygenAvatarType: string | null;
  heygenAvatarId: string | null;
  heygenPhotoUrl: string | null;
}

export function isHeygenEnvConfigured(): boolean {
  return (
    process.env.HEYGEN_ENABLED === 'true' &&
    Boolean(process.env.HEYGEN_API_KEY)
  );
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
