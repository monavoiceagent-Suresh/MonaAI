// A short-lived mutex for an ops server route that must never process two requests
// concurrently (see prisma/schema.prisma's OpsLock model). Backed by Postgres — the app's
// only datastore that's safe across Prisma's connection pool — rather than introducing Redis
// into Mona just for this. The expiry is a crash fallback: a run that dies mid-batch
// self-heals once the lock's TTL passes, instead of jamming the route forever.
import type { PrismaClient } from "@prisma/client";

/**
 * Tries to take the named lock for `ttlMs`. Returns true if acquired (including reclaiming
 * one whose expiry has already passed), false if another holder's lock is still live.
 */
export async function acquireOpsLock(
  database: PrismaClient,
  key: string,
  ttlMs: number,
): Promise<boolean> {
  const rows = await database.$queryRaw<{ key: string }[]>`
    INSERT INTO ops_locks (key, acquired_at, expires_at)
    VALUES (${key}, now(), now() + (${ttlMs}::text || ' milliseconds')::interval)
    ON CONFLICT (key) DO UPDATE
      SET acquired_at = now(), expires_at = now() + (${ttlMs}::text || ' milliseconds')::interval
      WHERE ops_locks.expires_at < now()
    RETURNING key
  `;
  return rows.length > 0;
}

export async function releaseOpsLock(database: PrismaClient, key: string): Promise<void> {
  await database.opsLock.deleteMany({ where: { key } });
}
