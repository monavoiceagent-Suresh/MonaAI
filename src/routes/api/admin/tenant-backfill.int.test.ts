// Focused checks for the production tenant-backfill route (see tenant-backfill.ts): it must
// reject an unauthenticated/misauthenticated caller, report per-tenant failures without
// blocking the rest of the page, be safe to retry (including a retry that finds nothing left
// to do), and refuse to run two batches at once.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db.server";
import { createTenant, deleteTenants, type Tenant } from "@/test/tenant-fixtures";
import { syncTenantToEngine } from "@/lib/voice-engine/client";
import { Route } from "./tenant-backfill";

vi.mock("@/lib/voice-engine/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/voice-engine/client")>(
    "@/lib/voice-engine/client",
  );
  return { ...actual, syncTenantToEngine: vi.fn() };
});

const TOKEN = "test-backfill-token";
const handler = Route.options.server!.handlers!.POST as (args: {
  request: Request;
}) => Promise<Response>;

function post(body?: unknown, authorization = `Bearer ${TOKEN}`) {
  return handler({
    request: new Request("http://localhost/api/admin/tenant-backfill", {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  });
}

const tenants: Tenant[] = [];
let previousToken: string | undefined;

beforeAll(() => {
  previousToken = process.env["TENANT_BACKFILL_TOKEN"];
  process.env["TENANT_BACKFILL_TOKEN"] = TOKEN;
});
afterAll(async () => {
  if (previousToken === undefined) delete process.env["TENANT_BACKFILL_TOKEN"];
  else process.env["TENANT_BACKFILL_TOKEN"] = previousToken;
  await deleteTenants(db, tenants);
  await db.opsLock.deleteMany({ where: { key: "tenant-backfill" } });
});
beforeEach(async () => {
  vi.mocked(syncTenantToEngine)
    .mockReset()
    .mockImplementation(async (body) => body);
  await db.opsLock.deleteMany({ where: { key: "tenant-backfill" } });
});
afterEach(async () => {
  await db.opsLock.deleteMany({ where: { key: "tenant-backfill" } });
});

async function newTenant() {
  const tenant = await createTenant(db);
  tenants.push(tenant);
  return tenant;
}

describe("authorization", () => {
  it("rejects a request with no Authorization header", async () => {
    const response = await post({}, "");
    expect(response.status).toBe(401);
    expect(syncTenantToEngine).not.toHaveBeenCalled();
  });

  it("rejects the wrong bearer token", async () => {
    const response = await post({}, "Bearer not-the-token");
    expect(response.status).toBe(401);
    expect(syncTenantToEngine).not.toHaveBeenCalled();
  });

  it("accepts the correct bearer token", async () => {
    const response = await post({ limit: 5 });
    expect(response.status).toBe(200);
  });
});

describe("partial failures", () => {
  it("reports a per-tenant failure without dropping the rest of the page", async () => {
    const failing = await newTenant();
    const healthy = await newTenant();
    vi.mocked(syncTenantToEngine).mockImplementation(async (body) => {
      if (body.id === failing.clientId) throw new Error("engine unreachable");
      return body;
    });

    const response = await post({ limit: 25 });
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.failures).toEqual(
      expect.arrayContaining([{ clientId: failing.clientId, error: "engine unreachable" }]),
    );
    expect(
      vi.mocked(syncTenantToEngine).mock.calls.some(([body]) => body.id === healthy.clientId),
    ).toBe(true);
  });
});

describe("retries", () => {
  it("retrying after a failure only needs the failed tenant to succeed", async () => {
    const tenant = await newTenant();
    vi.mocked(syncTenantToEngine).mockImplementation(async (body) => {
      if (body.id === tenant.clientId) throw new Error("engine unreachable");
      return body;
    });
    const first = await (await post({ limit: 25 })).json();
    expect(first.failures.some((f: { clientId: string }) => f.clientId === tenant.clientId)).toBe(
      true,
    );

    vi.mocked(syncTenantToEngine).mockImplementation(async (body) => body);
    const second = await (await post({ limit: 25 })).json();
    expect(second.failures).toEqual([]);
  });

  it("a retry that finds nothing left reports done with no failures", async () => {
    const response = await post({ cursor: "ffffffff-ffff-ffff-ffff-ffffffffffff", limit: 25 });
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result).toMatchObject({ synced: 0, failures: [], done: true });
    expect(result.nextCursor).toBeUndefined();
  });
});

describe("duplicate/concurrent execution", () => {
  it("refuses a second batch while one is already running", async () => {
    await newTenant();
    let release!: () => void;
    vi.mocked(syncTenantToEngine).mockImplementation(
      () => new Promise((resolve) => (release = () => resolve({} as never))),
    );

    const inFlight = post({ limit: 25 });
    // Wait for the first request to actually hold the lock before the second one tries.
    for (let i = 0; i < 100; i++) {
      if (await db.opsLock.findUnique({ where: { key: "tenant-backfill" } })) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    const second = await post({ limit: 25 });
    expect(second.status).toBe(409);

    // Unblock the one tenant the first request is already waiting on, and let every other
    // tenant in its page (there may be several, accumulated from earlier tests) resolve
    // immediately too, instead of each creating a fresh unresolved promise.
    vi.mocked(syncTenantToEngine).mockImplementation(async (body) => body);
    release();
    const first = await inFlight;
    expect(first.status).toBe(200);
  });

  it("allows a new batch once the previous one has finished", async () => {
    await newTenant();
    const firstResponse = await post({ limit: 25 });
    expect(firstResponse.status).toBe(200);

    const secondResponse = await post({ limit: 25 });
    expect(secondResponse.status).toBe(200);
  });
});
