// Focused checks for the tenant backfill (see tenant-sync-backfill.ts and
// scripts/backfill-tenants-to-engine.ts): every existing Client must reach the engine, a
// partial failure must be retryable without duplicating work, and status must carry over.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db.server";
import { createTenant, deleteTenants, type Tenant } from "@/test/tenant-fixtures";
import { backfillTenantsToEngine } from "@/lib/tenant-sync-backfill";
import { syncTenantToEngine } from "@/lib/voice-engine/client";

vi.mock("@/lib/voice-engine/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/voice-engine/client")>(
    "@/lib/voice-engine/client",
  );
  return { ...actual, syncTenantToEngine: vi.fn() };
});

const tenants: Tenant[] = [];

afterAll(async () => {
  await deleteTenants(db, tenants);
});
beforeEach(() => {
  vi.mocked(syncTenantToEngine)
    .mockReset()
    .mockImplementation(async (body) => body);
});

async function newTenant() {
  const tenant = await createTenant(db);
  tenants.push(tenant);
  return tenant;
}

describe("backfillTenantsToEngine", () => {
  it("syncs every existing tenant, including one missing from the engine registry", async () => {
    const tenant = await newTenant();
    const result = await backfillTenantsToEngine(db);

    expect(result.failures).toEqual([]);
    expect(result.synced).toBe(result.total);
    const call = vi
      .mocked(syncTenantToEngine)
      .mock.calls.find(([body]) => body.id === tenant.clientId);
    expect(call?.[0]).toMatchObject({ id: tenant.clientId, status: "active" });
  });

  it("carries a suspended tenant's status, not just active ones", async () => {
    const tenant = await newTenant();
    await db.client.update({ where: { id: tenant.clientId }, data: { status: "suspended" } });

    await backfillTenantsToEngine(db);

    const call = vi
      .mocked(syncTenantToEngine)
      .mock.calls.find(([body]) => body.id === tenant.clientId);
    expect(call?.[0]).toMatchObject({ id: tenant.clientId, status: "suspended" });
  });

  it("reports a per-tenant failure instead of aborting the whole run", async () => {
    const failing = await newTenant();
    const healthy = await newTenant();
    vi.mocked(syncTenantToEngine).mockImplementation(async (body) => {
      if (body.id === failing.clientId) throw new Error("engine unreachable");
      return body;
    });

    const result = await backfillTenantsToEngine(db);

    expect(result.failures).toEqual([{ clientId: failing.clientId, error: "engine unreachable" }]);
    expect(
      vi.mocked(syncTenantToEngine).mock.calls.some(([body]) => body.id === healthy.clientId),
    ).toBe(true);
  });

  it("re-running after a failure only needs the failed tenant to succeed, and is harmless to repeat", async () => {
    const tenant = await newTenant();
    vi.mocked(syncTenantToEngine).mockImplementation(async (body) => {
      if (body.id === tenant.clientId) throw new Error("engine unreachable");
      return body;
    });
    const first = await backfillTenantsToEngine(db);
    expect(first.failures).toEqual([{ clientId: tenant.clientId, error: "engine unreachable" }]);

    vi.mocked(syncTenantToEngine).mockImplementation(async (body) => body);
    const second = await backfillTenantsToEngine(db);

    expect(second.failures).toEqual([]);
    const call = vi
      .mocked(syncTenantToEngine)
      .mock.calls.find(([body]) => body.id === tenant.clientId);
    expect(call?.[0]).toMatchObject({ id: tenant.clientId, status: "active" });
  });
});
