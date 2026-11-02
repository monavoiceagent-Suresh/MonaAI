// Focused checks for Phase 2A tenant management: creation, the suspension access boundary
// (login block + currentWorkspaceClient block, which every tenant-scoped server function
// depends on), reactivation, and permanent deletion with its cross-tenant safety guard.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db.server";
import { hashPassword } from "@/lib/password";
import { isCallerWorkspaceSuspended, currentWorkspaceClient } from "@/lib/workspace.functions";
import {
  createTenantFor,
  deleteTenantPermanentlyFor,
  getTenantDetailFor,
  listTenantsFor,
  setTenantStatusFor,
  updateTenantFor,
} from "@/lib/super-admin-tenants.functions";

const SUPER_ADMIN_ID = randomUUID();
const clientIds: string[] = [];
const userIds: string[] = [];
const emails: string[] = [];

afterAll(async () => {
  await db.client.deleteMany({ where: { id: { in: clientIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.user.deleteMany({ where: { email: { in: emails } } });
});

async function makeTenant(status: "active" | "suspended" = "active") {
  const email = `tenant-admin-${randomUUID().slice(0, 8)}@example.test`;
  emails.push(email);
  const user = await db.user.create({
    data: {
      email,
      fullName: "Tenant Admin",
      passwordHash: await hashPassword("correct-horse-battery"),
    },
    select: { id: true },
  });
  const client = await db.client.create({
    data: {
      name: `Test tenant ${randomUUID().slice(0, 8)}`,
      status,
      members: { create: { userId: user.id, role: "owner" } },
    },
    select: { id: true },
  });
  clientIds.push(client.id);
  userIds.push(user.id);
  return { clientId: client.id, userId: user.id, email };
}

describe("createTenantFor", () => {
  it("creates the client, its owner membership and the admin user in one shot", async () => {
    const email = `new-tenant-admin-${randomUUID().slice(0, 8)}@example.test`;
    emails.push(email);
    const result = await createTenantFor(db, SUPER_ADMIN_ID, {
      businessName: "Acme Corp",
      adminFullName: "Jane Doe",
      adminEmail: email,
      adminPassword: "correct-horse-battery",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    clientIds.push(result.clientId);

    const client = await db.client.findUnique({
      where: { id: result.clientId },
      include: { members: { include: { user: true } } },
    });
    expect(client?.name).toBe("Acme Corp");
    expect(client?.status).toBe("active");
    expect(client?.members).toHaveLength(1);
    expect(client?.members[0]?.role).toBe("owner");
    expect(client?.members[0]?.user.email).toBe(email);
    expect(client?.members[0]?.user.fullName).toBe("Jane Doe");
    userIds.push(client!.members[0]!.user.id);
  });

  it("rejects a duplicate admin email instead of creating a second account", async () => {
    const tenant = await makeTenant();
    const result = await createTenantFor(db, SUPER_ADMIN_ID, {
      businessName: "Another Business",
      adminFullName: "Someone Else",
      adminEmail: tenant.email,
      adminPassword: "correct-horse-battery",
    });
    expect(result).toEqual({ ok: false, reason: "An account with that email already exists." });
  });
});

describe("listTenantsFor / getTenantDetailFor", () => {
  it("finds a tenant by its admin email", async () => {
    const tenant = await makeTenant();
    const result = await listTenantsFor(db, { status: "all", page: 1, search: tenant.email });
    expect(result.tenants.some((t) => t.id === tenant.clientId)).toBe(true);
  });

  it("filters by status", async () => {
    const suspended = await makeTenant("suspended");
    const result = await listTenantsFor(db, { status: "suspended", page: 1 });
    expect(result.tenants.some((t) => t.id === suspended.clientId)).toBe(true);
    expect(result.tenants.every((t) => t.status === "suspended")).toBe(true);
  });

  it("returns tenant admin details and zeroed counts for a fresh tenant", async () => {
    const tenant = await makeTenant();
    const detail = await getTenantDetailFor(db, tenant.clientId);
    expect(detail?.adminEmail).toBe(tenant.email);
    expect(detail?.agentCount).toBe(0);
    expect(detail?.campaignCount).toBe(0);
  });

  it("returns null for an unknown tenant", async () => {
    expect(await getTenantDetailFor(db, randomUUID())).toBeNull();
  });
});

describe("updateTenantFor", () => {
  it("renames the business", async () => {
    const tenant = await makeTenant();
    const result = await updateTenantFor(db, {
      clientId: tenant.clientId,
      businessName: "Renamed Co",
    });
    expect(result).toEqual({ ok: true });
    expect((await db.client.findUnique({ where: { id: tenant.clientId } }))?.name).toBe(
      "Renamed Co",
    );
  });

  it("fails clearly for an unknown tenant", async () => {
    const result = await updateTenantFor(db, { clientId: randomUUID(), businessName: "Ghost Co" });
    expect(result).toEqual({ ok: false, reason: "Tenant not found." });
  });
});

describe("suspension is the access boundary every tenant-scoped operation depends on", () => {
  it("blocks sign-in with a clear reason, without touching the password check", async () => {
    const tenant = await makeTenant("suspended");
    expect(await isCallerWorkspaceSuspended(db, tenant.userId)).toBe(true);
  });

  it("does not consider an active tenant suspended", async () => {
    const tenant = await makeTenant("active");
    expect(await isCallerWorkspaceSuspended(db, tenant.userId)).toBe(false);
  });

  it("makes currentWorkspaceClient resolve to null for a suspended tenant", async () => {
    const tenant = await makeTenant("suspended");
    expect(await currentWorkspaceClient(db, tenant.userId)).toBeNull();
  });

  it("setTenantStatusFor(suspended) flips status and revokes every member's sessions", async () => {
    const tenant = await makeTenant("active");
    await db.session.create({
      data: {
        userId: tenant.userId,
        tokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    expect(await db.session.count({ where: { userId: tenant.userId } })).toBe(1);

    const result = await setTenantStatusFor(db, SUPER_ADMIN_ID, {
      clientId: tenant.clientId,
      status: "suspended",
    });
    expect(result).toEqual({ ok: true, inboundFailures: [], campaignFailures: [] });
    expect((await db.client.findUnique({ where: { id: tenant.clientId } }))?.status).toBe(
      "suspended",
    );
    expect(await db.session.count({ where: { userId: tenant.userId } })).toBe(0);
    expect(await currentWorkspaceClient(db, tenant.userId)).toBeNull();
  });

  it("reactivating restores normal access", async () => {
    const tenant = await makeTenant("suspended");
    const result = await setTenantStatusFor(db, SUPER_ADMIN_ID, {
      clientId: tenant.clientId,
      status: "active",
    });
    expect(result).toEqual({ ok: true, inboundFailures: [], campaignFailures: [] });
    expect(await currentWorkspaceClient(db, tenant.userId)).not.toBeNull();
    expect(await isCallerWorkspaceSuspended(db, tenant.userId)).toBe(false);
  });

  it("is a no-op when already in the target state", async () => {
    const tenant = await makeTenant("active");
    const result = await setTenantStatusFor(db, SUPER_ADMIN_ID, {
      clientId: tenant.clientId,
      status: "active",
    });
    expect(result).toEqual({ ok: true, inboundFailures: [], campaignFailures: [] });
  });
});

describe("deleteTenantPermanentlyFor", () => {
  it("refuses without the exact current tenant name", async () => {
    const tenant = await makeTenant();
    const result = await deleteTenantPermanentlyFor(db, SUPER_ADMIN_ID, {
      clientId: tenant.clientId,
      confirmName: "wrong name",
    });
    expect(result).toEqual({
      ok: false,
      reason: "Type the tenant's exact name to confirm deletion.",
    });
    expect(await db.client.findUnique({ where: { id: tenant.clientId } })).not.toBeNull();
  });

  it("deletes the tenant and cascades its campaign and the now-orphaned admin user", async () => {
    const tenant = await makeTenant();
    const client = await db.client.findUnique({
      where: { id: tenant.clientId },
      select: { name: true },
    });
    await db.campaign.create({
      data: { clientId: tenant.clientId, name: "Doomed campaign" },
    });

    const result = await deleteTenantPermanentlyFor(db, SUPER_ADMIN_ID, {
      clientId: tenant.clientId,
      confirmName: client!.name,
    });
    expect(result).toEqual({ ok: true });
    expect(await db.client.findUnique({ where: { id: tenant.clientId } })).toBeNull();
    expect(await db.campaign.findFirst({ where: { clientId: tenant.clientId } })).toBeNull();
    // The admin had no other workspace, so deleting their only tenant removes their account too.
    expect(await db.user.findUnique({ where: { id: tenant.userId } })).toBeNull();
    userIds.splice(userIds.indexOf(tenant.userId), 1);
    clientIds.splice(clientIds.indexOf(tenant.clientId), 1);
  });

  it("never deletes an admin who still belongs to another tenant", async () => {
    const tenant = await makeTenant();
    const client = await db.client.findUnique({
      where: { id: tenant.clientId },
      select: { name: true },
    });
    // Give this same user a second, unrelated workspace.
    const otherClient = await db.client.create({
      data: {
        name: `Other workspace ${randomUUID().slice(0, 8)}`,
        members: { create: { userId: tenant.userId, role: "owner" } },
      },
      select: { id: true },
    });
    clientIds.push(otherClient.id);

    const result = await deleteTenantPermanentlyFor(db, SUPER_ADMIN_ID, {
      clientId: tenant.clientId,
      confirmName: client!.name,
    });
    expect(result).toEqual({ ok: true });
    expect(await db.client.findUnique({ where: { id: tenant.clientId } })).toBeNull();
    // The user survives because they are still a member of otherClient.
    expect(await db.user.findUnique({ where: { id: tenant.userId } })).not.toBeNull();
  });

  it("returns a clear error for an unknown tenant", async () => {
    const result = await deleteTenantPermanentlyFor(db, SUPER_ADMIN_ID, {
      clientId: randomUUID(),
      confirmName: "anything",
    });
    expect(result).toEqual({ ok: false, reason: "Tenant not found." });
  });
});
