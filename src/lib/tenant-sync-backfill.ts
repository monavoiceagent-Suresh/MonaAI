// One-off (but safe to re-run) sync of every existing Client row to the engine's tenant
// registry (PUT /tenants — see app/tenants.py and docs/MULTI_TENANT_TELEPHONY_PLAN.md M1 step 5).
//
// createTenantFor/updateTenantFor/setTenantStatusFor (super-admin-tenants.functions.ts) only sync
// a tenant going forward, from the moment that code shipped. Any Client row that existed before
// then — or one created outside those flows (scripts/create-user.ts) — was never pushed to the
// engine, so app/tenants.py logs it as "not a tenant the engine has been told about" on every
// dispatch/admission check it's involved in. This closes that gap for existing tenants; the
// per-flow syncs above keep it closed for every tenant created afterwards.
//
// Idempotent: the engine upserts on client_id (app/tenants.py upsert_tenant does
// ON CONFLICT ... DO UPDATE), so re-running this after a partial failure is just re-running it —
// a tenant that already synced is synced again, harmlessly, and only the ones that failed need
// the retry to matter.
import type { PrismaClient } from "@prisma/client";
import { syncTenantToEngine } from "@/lib/voice-engine/client";

export interface TenantBackfillFailure {
  clientId: string;
  error: string;
}

export interface TenantBackfillResult {
  total: number;
  synced: number;
  failures: TenantBackfillFailure[];
}

export async function backfillTenantsToEngine(
  database: PrismaClient,
): Promise<TenantBackfillResult> {
  const clients = await database.client.findMany({
    select: { id: true, name: true, status: true },
  });

  const failures: TenantBackfillFailure[] = [];
  let synced = 0;
  for (const client of clients) {
    try {
      await syncTenantToEngine({
        id: client.id,
        name: client.name,
        status: client.status === "suspended" ? "suspended" : "active",
      });
      synced += 1;
    } catch (error) {
      failures.push({
        clientId: client.id,
        error: error instanceof Error ? error.message : "Could not reach the voice engine.",
      });
    }
  }
  return { total: clients.length, synced, failures };
}
