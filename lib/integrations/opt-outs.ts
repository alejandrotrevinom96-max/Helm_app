// PR Sprint B-finish — per-user soft-disconnect helpers for
// deploy-wide integrations.
//
// "Soft disconnect" semantics: the integration's credentials are
// shared across the whole deployment (env vars), so we can't drop
// them on the founder's behalf. Instead we record that this
// specific user has chosen to NOT have Helm publish on their
// behalf to this provider. The publish dispatcher and the
// integration's status check both consult this before reporting
// "connected" / firing any API call.
//
// Currently the only deploy-wide provider is X (Twitter). New
// ones (e.g. a shared Anthropic-backed account for some platform)
// can use the same table without code changes.

import { db } from '@/lib/db';
import { userIntegrationOptOuts } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';

export type OptOutProvider = 'x';

/**
 * True if the user has soft-disconnected this provider. False
 * for any unknown user or row absence — fail-open since the
 * default state for every user is "connected to the deploy-wide
 * credentials".
 */
export async function isUserOptedOut(
  userId: string,
  provider: OptOutProvider,
): Promise<boolean> {
  try {
    const [row] = await db
      .select({ id: userIntegrationOptOuts.id })
      .from(userIntegrationOptOuts)
      .where(
        and(
          eq(userIntegrationOptOuts.userId, userId),
          eq(userIntegrationOptOuts.provider, provider),
        ),
      )
      .limit(1);
    return Boolean(row);
  } catch (err) {
    // Defensive: if the lookup fails (e.g. migration not applied
    // yet on a stale deploy), fall open — better to attempt a
    // publish than to silently drop it.
    console.warn(
      '[opt-outs] lookup failed (failing open):',
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

/**
 * Records the user's soft-disconnect. Idempotent via the
 * (user_id, provider) unique constraint — re-disconnecting a
 * provider that's already disconnected is a no-op.
 */
export async function setOptOut(
  userId: string,
  provider: OptOutProvider,
): Promise<void> {
  await db
    .insert(userIntegrationOptOuts)
    .values({ userId, provider })
    .onConflictDoNothing({
      target: [
        userIntegrationOptOuts.userId,
        userIntegrationOptOuts.provider,
      ],
    });
}

/**
 * Clears the user's soft-disconnect (reconnect flow). No-op when
 * no row exists.
 */
export async function clearOptOut(
  userId: string,
  provider: OptOutProvider,
): Promise<void> {
  await db
    .delete(userIntegrationOptOuts)
    .where(
      and(
        eq(userIntegrationOptOuts.userId, userId),
        eq(userIntegrationOptOuts.provider, provider),
      ),
    );
}
