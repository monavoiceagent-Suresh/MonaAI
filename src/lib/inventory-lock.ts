import type { PrismaClient } from "@prisma/client";

export class InventoryBusyError extends Error {}

/** All inventory transitions and route publishes share this lock, including validation.
 * The transaction adapter keeps existing batched writes inside the already-open transaction.
 */
export async function inventoryTransaction<T>(
  database: PrismaClient,
  work: (tx: PrismaClient) => Promise<T>,
  tryOnly = false,
): Promise<T> {
  return database.$transaction(
    async (tx) => {
      if (tryOnly) {
        const rows = await tx.$queryRaw<
          { locked: boolean }[]
        >`SELECT pg_try_advisory_xact_lock(71632492) AS locked`;
        if (!rows[0]?.locked) throw new InventoryBusyError("Inventory change already in progress");
      } else {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(71632492)`;
      }
      const scoped = new Proxy(tx, {
        get(target, key) {
          if (key === "$transaction")
            return (operations: Promise<unknown>[]) => Promise.all(operations);
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      return work(scoped as unknown as PrismaClient);
    },
    { timeout: 30000 },
  );
}
