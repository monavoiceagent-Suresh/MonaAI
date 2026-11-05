// M3 Super Admin operational visibility: live channel utilization, tenant-level allocations,
// outbound queue depth, and health counters for stale/stuck allocations — read straight from the
// engine's GET /capacity (app/monitoring.py). Nothing here is a second source of truth: the
// engine's Redis/PostgreSQL allocator stays the only place this state is tracked or written.
import { createServerFn } from "@tanstack/react-start";
import type { PrismaClient } from "@prisma/client";

import { requireSuperAdmin } from "@/lib/auth.server";
import { db } from "@/lib/db.server";
import {
  getEngineCapacity,
  VoiceEngineNotConfiguredError,
  VoiceEngineUnavailableError,
} from "@/lib/voice-engine/client";
import type { EngineCapacity, TenantCapacity } from "@/lib/voice-engine/types";

export type TenantCapacityView = TenantCapacity & { clientName: string | null };
export type CapacityView = Omit<EngineCapacity, "tenants"> & { tenants: TenantCapacityView[] };

export type CapacityResult = { ok: true; capacity: CapacityView } | { ok: false; reason: string };

export async function getCapacitySnapshotFor(database: PrismaClient): Promise<CapacityResult> {
  try {
    const capacity = await getEngineCapacity();
    // The engine knows tenants only as client_id (it has no name of its own — see app/tenants.py);
    // resolved here, the one place both sides of the boundary meet, rather than in the engine.
    const names = await database.client.findMany({
      where: { id: { in: capacity.tenants.map((t) => t.clientId) } },
      select: { id: true, name: true },
    });
    const nameById = new Map(names.map((c) => [c.id, c.name]));
    return {
      ok: true,
      capacity: {
        ...capacity,
        tenants: capacity.tenants.map((t) => ({
          ...t,
          clientName: nameById.get(t.clientId) ?? null,
        })),
      },
    };
  } catch (error) {
    const reason =
      error instanceof VoiceEngineNotConfiguredError
        ? "Voice engine is not configured yet."
        : error instanceof VoiceEngineUnavailableError
          ? error.message
          : "Unexpected error reaching the voice engine.";
    return { ok: false, reason };
  }
}

export const getCapacitySnapshot = createServerFn({ method: "GET" })
  .middleware([requireSuperAdmin])
  .handler(() => getCapacitySnapshotFor(db));
