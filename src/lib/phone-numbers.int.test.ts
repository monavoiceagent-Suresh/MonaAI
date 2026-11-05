// M1 number inventory & tenant assignment lifecycle (docs/MULTI_TENANT_TELEPHONY_PLAN.md):
// Available -> Assigned -> Unassigned | Suspended -> Reactivated, each writing an audit event, plus
// the caller-ID resolution dispatchCampaign depends on.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db.server";
import { createTenant, deleteTenants, type Tenant } from "@/test/tenant-fixtures";
import {
  addPhoneNumberToInventoryFor,
  assignPhoneNumberToTenantFor,
  reactivatePhoneNumberFor,
  resolveAndValidateCallerId,
  setDefaultOutboundCallerIdFor,
  suspendPhoneNumberFor,
  unassignPhoneNumberFor,
} from "./phone-numbers.functions";
import {
  createCampaignFor,
  dispatchCampaign,
  type CreateCampaignInput,
} from "./campaigns.functions";
import { dispatchCampaignToEngine, revokeInboundRoute } from "@/lib/voice-engine/client";

vi.mock("@/lib/voice-engine/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/voice-engine/client")>(
    "@/lib/voice-engine/client",
  );
  return {
    ...actual,
    dispatchCampaignToEngine: vi.fn(),
    syncTenantToEngine: vi.fn(),
    revokeInboundRoute: vi.fn().mockResolvedValue({ ok: true }),
  };
});

const SUPER_ADMIN_ID = randomUUID();
const TEST_PREFIX = "+918010000";
const tenants: Tenant[] = [];
// PhoneNumber rows outlive their tenant (clientId is onDelete: SetNull, not Cascade — a number
// must survive its tenant being deleted, exactly as the account's real inventory would), so
// deleteTenants alone would leave this suite's numbers behind for the next run to collide with.
// Clean the known test prefix both before and after, rather than tracking individual ids.
async function deleteTestNumbers() {
  await db.phoneNumber.deleteMany({ where: { e164: { startsWith: TEST_PREFIX } } });
}
beforeAll(deleteTestNumbers);
afterAll(async () => {
  await deleteTenants(db, tenants);
  await deleteTestNumbers();
});
beforeEach(() => {
  vi.mocked(revokeInboundRoute).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(dispatchCampaignToEngine).mockReset();
  // A fresh id per call, like the real engine: two campaigns dispatched in the same test file must
  // not collide on VoiceEngineJob's unique engine_job_id, the way a single fixed value would.
  vi.mocked(dispatchCampaignToEngine).mockImplementation(async () => ({
    engineJobId: `engine-${randomUUID()}`,
    status: "accepted",
  }));
});

async function newTenant() {
  const tenant = await createTenant(db);
  tenants.push(tenant);
  return tenant;
}

async function newNumber(e164: string) {
  const result = await addPhoneNumberToInventoryFor(db, SUPER_ADMIN_ID, {
    e164,
    capability: "VOICE_BOTH",
  });
  if (!result.ok) throw new Error(result.reason);
  return result.id;
}

describe("phone number lifecycle", () => {
  it("Available -> Assigned -> Unassigned, each writing an audit event", async () => {
    const tenant = await newTenant();
    const numberId = await newNumber("+918010000001");

    const assigned = await assignPhoneNumberToTenantFor(db, SUPER_ADMIN_ID, {
      phoneNumberId: numberId,
      clientId: tenant.clientId,
      idempotencyKey: randomUUID(),
    });
    expect(assigned.ok).toBe(true);
    let row = await db.phoneNumber.findUniqueOrThrow({ where: { id: numberId } });
    expect(row.status).toBe("ASSIGNED");
    expect(row.clientId).toBe(tenant.clientId);

    const unassigned = await unassignPhoneNumberFor(db, SUPER_ADMIN_ID, {
      phoneNumberId: numberId,
      reason: "test cleanup",
      idempotencyKey: randomUUID(),
      force: false,
    });
    expect(unassigned.ok).toBe(true);
    row = await db.phoneNumber.findUniqueOrThrow({ where: { id: numberId } });
    expect(row.status).toBe("UNASSIGNED");
    expect(row.clientId).toBeNull();

    const events = await db.phoneNumberAssignmentEvent.findMany({
      where: { phoneNumberId: numberId },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((e) => e.action)).toEqual(["ASSIGNED", "UNASSIGNED"]);
  });

  it("replaying the same idempotencyKey does not create a second assignment event", async () => {
    const tenant = await newTenant();
    const numberId = await newNumber("+918010000002");
    const idempotencyKey = randomUUID();

    const first = await assignPhoneNumberToTenantFor(db, SUPER_ADMIN_ID, {
      phoneNumberId: numberId,
      clientId: tenant.clientId,
      idempotencyKey,
    });
    const replay = await assignPhoneNumberToTenantFor(db, SUPER_ADMIN_ID, {
      phoneNumberId: numberId,
      clientId: tenant.clientId,
      idempotencyKey,
    });
    expect(first.ok).toBe(true);
    expect(replay.ok).toBe(true);
    const events = await db.phoneNumberAssignmentEvent.findMany({
      where: { phoneNumberId: numberId },
    });
    expect(events).toHaveLength(1);
  });

  it("refuses to assign a number that is already assigned elsewhere, requiring unassign first", async () => {
    const tenantA = await newTenant();
    const tenantB = await newTenant();
    const numberId = await newNumber("+918010000003");
    await assignPhoneNumberToTenantFor(db, SUPER_ADMIN_ID, {
      phoneNumberId: numberId,
      clientId: tenantA.clientId,
      idempotencyKey: randomUUID(),
    });

    const result = await assignPhoneNumberToTenantFor(db, SUPER_ADMIN_ID, {
      phoneNumberId: numberId,
      clientId: tenantB.clientId,
      idempotencyKey: randomUUID(),
    });
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("Unassign it first") });
  });

  it("Assigned -> Suspended -> Reactivated, keeping the default caller ID flag so resolution rejects it explicitly", async () => {
    const tenant = await newTenant();
    const numberId = await newNumber("+918010000004");
    await assignPhoneNumberToTenantFor(db, SUPER_ADMIN_ID, {
      phoneNumberId: numberId,
      clientId: tenant.clientId,
      idempotencyKey: randomUUID(),
    });
    await setDefaultOutboundCallerIdFor(db, SUPER_ADMIN_ID, {
      phoneNumberId: numberId,
      idempotencyKey: randomUUID(),
    });

    const suspended = await suspendPhoneNumberFor(db, SUPER_ADMIN_ID, {
      phoneNumberId: numberId,
      reason: "porting out",
      idempotencyKey: randomUUID(),
    });
    expect(suspended.ok).toBe(true);
    let row = await db.phoneNumber.findUniqueOrThrow({ where: { id: numberId } });
    expect(row.status).toBe("SUSPENDED");
    expect(row.isDefaultOutboundCallerId).toBe(true); // kept, not cleared (see function comment)

    const reactivated = await reactivatePhoneNumberFor(db, SUPER_ADMIN_ID, {
      phoneNumberId: numberId,
      idempotencyKey: randomUUID(),
    });
    expect(reactivated.ok).toBe(true);
    row = await db.phoneNumber.findUniqueOrThrow({ where: { id: numberId } });
    expect(row.status).toBe("ASSIGNED");
    expect(row.isDefaultOutboundCallerId).toBe(true);
  });

  it("setting a new default unsets the tenant's previous one", async () => {
    const tenant = await newTenant();
    const first = await newNumber("+918010000005");
    const second = await newNumber("+918010000006");
    for (const id of [first, second]) {
      await assignPhoneNumberToTenantFor(db, SUPER_ADMIN_ID, {
        phoneNumberId: id,
        clientId: tenant.clientId,
        idempotencyKey: randomUUID(),
      });
    }
    await setDefaultOutboundCallerIdFor(db, SUPER_ADMIN_ID, {
      phoneNumberId: first,
      idempotencyKey: randomUUID(),
    });
    await setDefaultOutboundCallerIdFor(db, SUPER_ADMIN_ID, {
      phoneNumberId: second,
      idempotencyKey: randomUUID(),
    });

    const rows = await db.phoneNumber.findMany({ where: { clientId: tenant.clientId } });
    expect(rows.filter((r) => r.isDefaultOutboundCallerId).map((r) => r.id)).toEqual([second]);
  });
});

describe("resolveAndValidateCallerId", () => {
  it("resolves to null (not a failure) when the tenant has made no selection yet", async () => {
    const tenant = await newTenant();
    const result = await resolveAndValidateCallerId(db, tenant.clientId, null);
    expect(result).toEqual({ ok: true, e164: null });
  });

  it("resolves the tenant's assigned default when no campaign override is set", async () => {
    const tenant = await newTenant();
    const numberId = await newNumber("+918010000007");
    await assignPhoneNumberToTenantFor(db, SUPER_ADMIN_ID, {
      phoneNumberId: numberId,
      clientId: tenant.clientId,
      idempotencyKey: randomUUID(),
    });
    await setDefaultOutboundCallerIdFor(db, SUPER_ADMIN_ID, {
      phoneNumberId: numberId,
      idempotencyKey: randomUUID(),
    });

    const result = await resolveAndValidateCallerId(db, tenant.clientId, null);
    expect(result).toEqual({ ok: true, e164: "+918010000007" });
  });

  it("rejects a default that has since been suspended, rather than falling back silently", async () => {
    const tenant = await newTenant();
    const numberId = await newNumber("+918010000008");
    await assignPhoneNumberToTenantFor(db, SUPER_ADMIN_ID, {
      phoneNumberId: numberId,
      clientId: tenant.clientId,
      idempotencyKey: randomUUID(),
    });
    await setDefaultOutboundCallerIdFor(db, SUPER_ADMIN_ID, {
      phoneNumberId: numberId,
      idempotencyKey: randomUUID(),
    });
    // Simulate "reassigned since configured" by unassigning and reassigning to a different
    // tenant, then resolving via an explicit campaign override pointed at that same number id.
    const otherTenant = await newTenant();
    await unassignPhoneNumberFor(db, SUPER_ADMIN_ID, {
      phoneNumberId: numberId,
      reason: "test",
      idempotencyKey: randomUUID(),
      force: false,
    });
    await assignPhoneNumberToTenantFor(db, SUPER_ADMIN_ID, {
      phoneNumberId: numberId,
      clientId: otherTenant.clientId,
      idempotencyKey: randomUUID(),
    });

    const result = await resolveAndValidateCallerId(db, tenant.clientId, numberId);
    expect(result).toEqual({
      ok: false,
      reason: "The selected caller ID number is no longer assigned to this workspace.",
    });
  });

  it("rejects a suspended number explicitly selected by a campaign", async () => {
    const tenant = await newTenant();
    const numberId = await newNumber("+918010000009");
    await assignPhoneNumberToTenantFor(db, SUPER_ADMIN_ID, {
      phoneNumberId: numberId,
      clientId: tenant.clientId,
      idempotencyKey: randomUUID(),
    });
    await suspendPhoneNumberFor(db, SUPER_ADMIN_ID, {
      phoneNumberId: numberId,
      reason: "test",
      idempotencyKey: randomUUID(),
    });

    const result = await resolveAndValidateCallerId(db, tenant.clientId, numberId);
    expect(result).toEqual({
      ok: false,
      reason: "The selected caller ID number is suspended, not assigned. Choose or assign another.",
    });
  });
});

describe("dispatchCampaign includes the resolved caller ID", () => {
  const WEBHOOK_URL = "https://app.test/api/webhooks/voice-engine";
  const input: CreateCampaignInput = {
    name: "October follow-ups",
    purpose: "Lead qualification",
    callingStart: "09:00",
    callingEnd: "18:00",
    maxTries: 3,
    retryGapMinutes: 30,
    callbackWindowDays: 3,
    personaKey: "october-14",
    voice: "Voice 8",
    ambience: false,
    creditCap: null,
  };

  async function ensurePersona(clientId: string) {
    return db.prompt.upsert({
      where: { clientId_personaKey: { clientId, personaKey: input.personaKey } },
      update: {},
      create: {
        clientId,
        personaKey: input.personaKey,
        name: "October follow-ups",
        language: "English",
        instructions: "You are a helpful assistant. [[KNOWLEDGE]]",
        knowledge: "Open nine to six.",
        greeting: "Hello, is this a good time?",
      },
    });
  }

  async function dispatchedCampaign(clientId: string, userId: string) {
    const campaign = await createCampaignFor(db, userId, input);
    await ensurePersona(clientId);
    await db.lead.create({
      data: { clientId, campaignId: campaign.id, phone: "+919876543210", name: "Lead" },
    });
    return dispatchCampaign(db, { campaignId: campaign.id, clientId, webhookUrl: WEBHOOK_URL });
  }

  it("omits callerId when the tenant has no default assigned (unchanged legacy behaviour)", async () => {
    const tenant = await newTenant();

    const result = await dispatchedCampaign(tenant.clientId, tenant.userId);

    expect(result.ok).toBe(true);
    const sent = vi.mocked(dispatchCampaignToEngine).mock.calls[0]?.[0];
    expect(sent?.callerId).toBeUndefined();
  });

  it("includes callerId once the tenant has an assigned default", async () => {
    const tenant = await newTenant();
    const numberId = await newNumber("+918010000010");
    await assignPhoneNumberToTenantFor(db, SUPER_ADMIN_ID, {
      phoneNumberId: numberId,
      clientId: tenant.clientId,
      idempotencyKey: randomUUID(),
    });
    await setDefaultOutboundCallerIdFor(db, SUPER_ADMIN_ID, {
      phoneNumberId: numberId,
      idempotencyKey: randomUUID(),
    });

    const result = await dispatchedCampaign(tenant.clientId, tenant.userId);

    expect(result.ok).toBe(true);
    const sent = vi.mocked(dispatchCampaignToEngine).mock.calls[0]?.[0];
    expect(sent?.callerId).toBe("+918010000010");
  });

  it("refuses to dispatch when the assigned default has since been suspended", async () => {
    const tenant = await newTenant();
    const numberId = await newNumber("+918010000011");
    await assignPhoneNumberToTenantFor(db, SUPER_ADMIN_ID, {
      phoneNumberId: numberId,
      clientId: tenant.clientId,
      idempotencyKey: randomUUID(),
    });
    await setDefaultOutboundCallerIdFor(db, SUPER_ADMIN_ID, {
      phoneNumberId: numberId,
      idempotencyKey: randomUUID(),
    });
    await suspendPhoneNumberFor(db, SUPER_ADMIN_ID, {
      phoneNumberId: numberId,
      reason: "test",
      idempotencyKey: randomUUID(),
    });

    const result = await dispatchedCampaign(tenant.clientId, tenant.userId);

    expect(result).toEqual({
      ok: false,
      reason: expect.stringContaining("not assigned"),
    });
    expect(dispatchCampaignToEngine).not.toHaveBeenCalled();
  });
});

describe("inventory concurrency", () => {
  it("allows only one competing tenant to acquire a number", async () => {
    const a = await newTenant(),
      b = await newTenant();
    const id = await newNumber("+918010000090");
    const results = await Promise.all(
      [a, b].map((t) =>
        assignPhoneNumberToTenantFor(db, SUPER_ADMIN_ID, {
          phoneNumberId: id,
          clientId: t.clientId,
          idempotencyKey: randomUUID(),
        }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(
      await db.phoneNumberAssignmentEvent.count({
        where: { phoneNumberId: id, action: "ASSIGNED" },
      }),
    ).toBe(1);
  });

  it("serializes competing defaults and the database rejects bypassing the invariant", async () => {
    const t = await newTenant();
    const ids = await Promise.all(["+918010000091", "+918010000092"].map(newNumber));
    for (const id of ids)
      await assignPhoneNumberToTenantFor(db, SUPER_ADMIN_ID, {
        phoneNumberId: id,
        clientId: t.clientId,
        idempotencyKey: randomUUID(),
      });
    await Promise.all(
      ids.map((id) =>
        setDefaultOutboundCallerIdFor(db, SUPER_ADMIN_ID, {
          phoneNumberId: id,
          idempotencyKey: randomUUID(),
        }),
      ),
    );
    expect(
      await db.phoneNumber.count({
        where: { clientId: t.clientId, isDefaultOutboundCallerId: true },
      }),
    ).toBe(1);
    await expect(
      db.phoneNumber.updateMany({
        where: { id: { in: ids } },
        data: { isDefaultOutboundCallerId: true },
      }),
    ).rejects.toThrow();
  });
});

it("does not commit number suspension if route revocation is uncertain", async () => {
  const t = await newTenant();
  const id = await newNumber("+918010000093");
  await assignPhoneNumberToTenantFor(db, SUPER_ADMIN_ID, {
    phoneNumberId: id,
    clientId: t.clientId,
    idempotencyKey: randomUUID(),
  });
  const input = { phoneNumberId: id, reason: "Safety regression", idempotencyKey: randomUUID() };
  vi.mocked(revokeInboundRoute).mockRejectedValueOnce(new Error("timeout"));
  await expect(suspendPhoneNumberFor(db, SUPER_ADMIN_ID, input)).rejects.toThrow("timeout");
  expect((await db.phoneNumber.findUniqueOrThrow({ where: { id } })).status).toBe("ASSIGNED");
  await suspendPhoneNumberFor(db, SUPER_ADMIN_ID, input);
  expect(revokeInboundRoute).toHaveBeenLastCalledWith(
    "+918010000093",
    t.clientId,
    expect.any(Number),
  );
  expect((await db.phoneNumber.findUniqueOrThrow({ where: { id } })).status).toBe("SUSPENDED");
});
