// Focused checks for Phase 4 Steps 2B/2C: suspension must surface (not swallow) engine
// failures, retrying must be idempotent and touch only what failed, and an Active campaign's
// open engine job must be cancelled (stopping new dispatch) without being re-implemented —
// this reuses stopCampaignDispatch exactly as a tenant's own Pause button does.
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db.server";
import { createTenant, deleteTenants, type Tenant } from "@/test/tenant-fixtures";
import { setTenantStatusFor } from "@/lib/super-admin-tenants.functions";
import {
  cancelEngineJob,
  publishInboundRoute,
  syncTenantToEngine,
} from "@/lib/voice-engine/client";

vi.mock("@/lib/voice-engine/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/voice-engine/client")>(
    "@/lib/voice-engine/client",
  );
  return {
    ...actual,
    cancelEngineJob: vi.fn(),
    publishInboundRoute: vi.fn(),
    syncTenantToEngine: vi.fn(),
  };
});

const SUPER_ADMIN_ID = randomUUID();
const tenants: Tenant[] = [];

afterAll(async () => {
  await db.phoneNumber.deleteMany({ where: { clientId: { in: tenants.map((t) => t.clientId) } } });
  await deleteTenants(db, tenants);
});
beforeEach(() => {
  vi.mocked(syncTenantToEngine)
    .mockReset()
    .mockResolvedValue({ id: "test", name: "Test", status: "active" });
  vi.mocked(cancelEngineJob).mockReset();
  vi.mocked(publishInboundRoute).mockReset();
});

async function newTenant() {
  const tenant = await createTenant(db);
  tenants.push(tenant);
  return tenant;
}

function fakeSnapshot(clientId: string, phone: string, active: boolean) {
  return {
    phone,
    clientId,
    version: 1,
    active,
    persona: { key: "x", version: 1 },
  } as unknown as Prisma.InputJsonValue;
}

describe("in-flight campaign calls on suspension", () => {
  it("pauses an Active campaign with no open engine job, without touching the engine", async () => {
    const t = await newTenant();
    const campaign = await db.campaign.create({
      data: { clientId: t.clientId, name: "No job", status: "Active" },
    });

    const result = await setTenantStatusFor(db, SUPER_ADMIN_ID, {
      clientId: t.clientId,
      status: "suspended",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.campaignFailures).toEqual([]);
    expect(cancelEngineJob).not.toHaveBeenCalled();
    expect((await db.campaign.findUnique({ where: { id: campaign.id } }))?.status).toBe("Paused");
  });

  it("cancels the open engine job for an Active campaign, stopping new dispatch", async () => {
    const t = await newTenant();
    const campaign = await db.campaign.create({
      data: { clientId: t.clientId, name: "With job", status: "Active" },
    });
    await db.voiceEngineJob.create({
      data: {
        clientId: t.clientId,
        campaignId: campaign.id,
        status: "running",
        engineJobId: randomUUID(),
      },
    });
    vi.mocked(cancelEngineJob).mockResolvedValue({ status: "cancelled" });

    const result = await setTenantStatusFor(db, SUPER_ADMIN_ID, {
      clientId: t.clientId,
      status: "suspended",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.campaignFailures).toEqual([]);
    expect(cancelEngineJob).toHaveBeenCalledTimes(1);
    expect((await db.campaign.findUnique({ where: { id: campaign.id } }))?.status).toBe("Paused");
  });

  it("surfaces a campaign whose engine job could not be cancelled, and leaves it Active rather than falsely marking it Paused", async () => {
    const t = await newTenant();
    const campaign = await db.campaign.create({
      data: { clientId: t.clientId, name: "Unreachable", status: "Active" },
    });
    await db.voiceEngineJob.create({
      data: {
        clientId: t.clientId,
        campaignId: campaign.id,
        status: "running",
        engineJobId: randomUUID(),
      },
    });
    vi.mocked(cancelEngineJob).mockRejectedValue(new Error("engine down"));

    const result = await setTenantStatusFor(db, SUPER_ADMIN_ID, {
      clientId: t.clientId,
      status: "suspended",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.campaignFailures).toHaveLength(1);
    expect(result.campaignFailures[0]).toMatchObject({ campaignId: campaign.id });
    // The tenant is still suspended (login/dispatch blocking is unaffected by this one failure);
    // only the campaign's own status is left alone, since it was never actually stopped.
    expect((await db.client.findUnique({ where: { id: t.clientId } }))?.status).toBe("suspended");
    expect((await db.campaign.findUnique({ where: { id: campaign.id } }))?.status).toBe("Active");
  });

  it("never touches campaigns that are not Active", async () => {
    const t = await newTenant();
    await db.campaign.create({
      data: { clientId: t.clientId, name: "Already paused", status: "Paused" },
    });
    const result = await setTenantStatusFor(db, SUPER_ADMIN_ID, {
      clientId: t.clientId,
      status: "suspended",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.campaignFailures).toEqual([]);
    expect(cancelEngineJob).not.toHaveBeenCalled();
  });
});

describe("reliable inbound suspension", () => {
  async function liveNumber(clientId: string, active = true) {
    const number = await db.inboundNumber.create({
      data: {
        clientId,
        phone: `+9198765${Math.floor(Math.random() * 100000)}`,
        personaKey: "test-persona",
        active,
      },
    });
    await db.phoneNumber.create({
      data: { e164: number.phone, clientId, status: "ASSIGNED", capability: "VOICE_BOTH" },
    });
    await db.inboundPublication.create({
      data: {
        numberId: number.id,
        version: 1,
        status: "synced",
        syncedAt: new Date(),
        snapshot: fakeSnapshot(clientId, number.phone, active),
        personaVersion: 1,
      },
    });
    return number;
  }

  it("surfaces an inbound number that could not be taken offline, instead of reporting plain success", async () => {
    const t = await newTenant();
    const number = await liveNumber(t.clientId);
    vi.mocked(publishInboundRoute).mockRejectedValue(new Error("engine unreachable"));

    const result = await setTenantStatusFor(db, SUPER_ADMIN_ID, {
      clientId: t.clientId,
      status: "suspended",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.inboundFailures).toHaveLength(1);
    expect(result.inboundFailures[0]?.phone).toBe(number.phone);
    // Client.status still flips — tenant-side blocking (login, dispatch) does not depend on
    // the engine being reachable, only the inbound-route side effect does.
    expect((await db.client.findUnique({ where: { id: t.clientId } }))?.status).toBe("suspended");
  });

  it("retrying (calling it again with the same target) only re-attempts what failed", async () => {
    const t = await newTenant();
    const ok = await liveNumber(t.clientId);
    const failing = await liveNumber(t.clientId);

    vi.mocked(publishInboundRoute).mockImplementation(async (body) => {
      if (body.phone === failing.phone) throw new Error("still unreachable");
      return { kind: "applied" };
    });
    const first = await setTenantStatusFor(db, SUPER_ADMIN_ID, {
      clientId: t.clientId,
      status: "suspended",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.inboundFailures.map((f) => f.phone)).toEqual([failing.phone]);

    // Fix the engine, then retry with the SAME target status (not a toggle back to active).
    vi.mocked(publishInboundRoute).mockReset();
    vi.mocked(publishInboundRoute).mockResolvedValue({ kind: "applied" });
    const retry = await setTenantStatusFor(db, SUPER_ADMIN_ID, {
      clientId: t.clientId,
      status: "suspended",
    });
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.inboundFailures).toEqual([]);
    // Only the previously-failing number needed a publish on retry; the one that already
    // succeeded is skipped (its live snapshot already matches the target).
    expect(vi.mocked(publishInboundRoute)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(publishInboundRoute).mock.calls[0]?.[0]?.phone).toBe(failing.phone);
  });

  it("does not short-circuit reconciliation just because Client.status already matches the target", async () => {
    const t = await newTenant();
    await db.client.update({ where: { id: t.clientId }, data: { status: "suspended" } });
    const number = await liveNumber(t.clientId); // live snapshot says active:true, but tenant is suspended
    vi.mocked(publishInboundRoute).mockResolvedValue({ kind: "applied" });

    const result = await setTenantStatusFor(db, SUPER_ADMIN_ID, {
      clientId: t.clientId,
      status: "suspended",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Even though Client.status was already "suspended", the number's live snapshot was still
    // active, so reconciliation must still run and fix it rather than being skipped outright.
    expect(publishInboundRoute).toHaveBeenCalledTimes(1);
    expect(publishInboundRoute).toHaveBeenCalledWith(
      expect.objectContaining({ phone: number.phone, active: false }),
    );
  });
});
