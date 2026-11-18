// Focused checks for invitation-based activation: issuing (with Resend unconfigured, as in
// this test environment), the activation lifecycle, expiry/tamper rejection, and resend/revoke.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db.server";
import { hashToken } from "@/lib/sessions";
import {
  activateAccountFor,
  getInvitationPreviewFor,
  getInvitationStatusFor,
  issueInvitation,
  resendInvitationFor,
  revokeInvitationFor,
} from "@/lib/invitations.functions";

const SUPER_ADMIN_ID = randomUUID();
const clientIds: string[] = [];
const userIds: string[] = [];

afterAll(async () => {
  await db.client.deleteMany({ where: { id: { in: clientIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
});

async function makeInvitedTenant() {
  const email = `invitee-${randomUUID().slice(0, 8)}@example.test`;
  const user = await db.user.create({
    data: { email, fullName: "Invited Owner" },
    select: { id: true },
  });
  const client = await db.client.create({
    data: {
      name: `Invite Test ${randomUUID().slice(0, 8)}`,
      members: { create: { userId: user.id, role: "owner" } },
    },
    select: { id: true, name: true },
  });
  clientIds.push(client.id);
  userIds.push(user.id);
  return { clientId: client.id, clientName: client.name, userId: user.id, email };
}

describe("issueInvitation", () => {
  it("creates a pending invitation and reports delivery status without throwing", async () => {
    const t = await makeInvitedTenant();
    const result = await issueInvitation(db, {
      clientId: t.clientId,
      userId: t.userId,
      email: t.email,
      fullName: "Invited Owner",
      businessName: t.clientName,
      invitedBy: SUPER_ADMIN_ID,
    });
    // RESEND_API_KEY/EMAIL_FROM are not both set for this test run, so delivery falls back
    // to a manually-shareable link rather than the call failing outright.
    expect(result.emailSent).toBe(false);
    if (result.emailSent) return;
    expect(result.activationUrl).toContain("/activate?token=");
    expect(result.reason.length).toBeGreaterThan(0);

    const row = await db.invitation.findFirst({ where: { clientId: t.clientId } });
    expect(row?.email).toBe(t.email);
    // Only the hash is ever stored — never the raw token.
    expect(row?.tokenHash).not.toContain(result.activationUrl);
  });
});

describe("getInvitationStatusFor", () => {
  it("reports pending for a fresh invitation", async () => {
    const t = await makeInvitedTenant();
    await issueInvitation(db, {
      clientId: t.clientId,
      userId: t.userId,
      email: t.email,
      fullName: "Invited Owner",
      businessName: t.clientName,
      invitedBy: SUPER_ADMIN_ID,
    });
    const status = await getInvitationStatusFor(db, t.clientId);
    expect(status).toEqual({ email: t.email, status: "pending", expiresAt: expect.any(String) });
  });

  it("returns null when no invitation was ever issued", async () => {
    const t = await makeInvitedTenant();
    expect(await getInvitationStatusFor(db, t.clientId)).toBeNull();
  });
});

describe("activateAccountFor", () => {
  async function invite() {
    const t = await makeInvitedTenant();
    const token = `test-token-${randomUUID()}`;
    const expiresAt = new Date(Date.now() + 60_000);
    await db.invitation.create({
      data: {
        clientId: t.clientId,
        userId: t.userId,
        email: t.email,
        tokenHash: hashToken(token),
        expiresAt,
      },
    });
    return { ...t, token };
  }

  it("sets the password, marks the invitation accepted, and logs the user in", async () => {
    const t = await invite();
    const result = await activateAccountFor(db, {
      token: t.token,
      password: "a-strong-password-1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user.email).toBe(t.email);
    expect(result.token).toBeTruthy();

    const user = await db.user.findUnique({ where: { id: t.userId } });
    expect(user?.passwordHash).not.toBeNull();
    const invitation = await db.invitation.findFirst({ where: { userId: t.userId } });
    expect(invitation?.acceptedAt).not.toBeNull();
  });

  it("rejects a password shorter than the minimum", async () => {
    const t = await invite();
    const result = await activateAccountFor(db, { token: t.token, password: "short" });
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("at least") });
  });

  it("rejects an unknown token", async () => {
    const result = await activateAccountFor(db, {
      token: "not-a-real-token",
      password: "a-strong-password-1",
    });
    expect(result).toEqual({
      ok: false,
      reason: expect.stringContaining("invalid or has expired"),
    });
  });

  it("rejects an expired invitation", async () => {
    const t = await makeInvitedTenant();
    const token = `expired-token-${randomUUID()}`;
    await db.invitation.create({
      data: {
        clientId: t.clientId,
        userId: t.userId,
        email: t.email,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    const result = await activateAccountFor(db, { token, password: "a-strong-password-1" });
    expect(result).toEqual({
      ok: false,
      reason: expect.stringContaining("invalid or has expired"),
    });
  });

  it("rejects reuse of an already-accepted token", async () => {
    const t = await invite();
    const first = await activateAccountFor(db, { token: t.token, password: "a-strong-password-1" });
    expect(first.ok).toBe(true);
    const second = await activateAccountFor(db, {
      token: t.token,
      password: "a-different-password-2",
    });
    expect(second).toEqual({
      ok: false,
      reason: expect.stringContaining("invalid or has expired"),
    });
  });

  it("rejects a revoked invitation", async () => {
    const t = await invite();
    await db.invitation.updateMany({
      where: { userId: t.userId },
      data: { revokedAt: new Date() },
    });
    const result = await activateAccountFor(db, {
      token: t.token,
      password: "a-strong-password-1",
    });
    expect(result).toEqual({
      ok: false,
      reason: expect.stringContaining("invalid or has expired"),
    });
  });
});

describe("getInvitationPreviewFor", () => {
  it("returns the invitee's email and business name for a valid token", async () => {
    const t = await makeInvitedTenant();
    const token = `preview-token-${randomUUID()}`;
    await db.invitation.create({
      data: {
        clientId: t.clientId,
        userId: t.userId,
        email: t.email,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const result = await getInvitationPreviewFor(db, token);
    expect(result).toEqual({ ok: true, preview: { email: t.email, businessName: t.clientName } });
  });

  it("rejects an unknown token without revealing anything", async () => {
    const result = await getInvitationPreviewFor(db, "unknown-token");
    expect(result.ok).toBe(false);
  });
});

describe("resendInvitationFor / revokeInvitationFor", () => {
  it("revokes the old token and issues a new pending invitation", async () => {
    const t = await makeInvitedTenant();
    await issueInvitation(db, {
      clientId: t.clientId,
      userId: t.userId,
      email: t.email,
      fullName: "Invited Owner",
      businessName: t.clientName,
      invitedBy: SUPER_ADMIN_ID,
    });
    const before = await db.invitation.findFirst({ where: { clientId: t.clientId } });

    const result = await resendInvitationFor(db, SUPER_ADMIN_ID, { clientId: t.clientId });
    expect(result.ok).toBe(true);

    const oldRow = await db.invitation.findUnique({ where: { id: before!.id } });
    expect(oldRow?.revokedAt).not.toBeNull();
    const status = await getInvitationStatusFor(db, t.clientId);
    expect(status?.status).toBe("pending");
  });

  it("fails clearly when there is nothing to resend", async () => {
    const t = await makeInvitedTenant();
    const result = await resendInvitationFor(db, SUPER_ADMIN_ID, { clientId: t.clientId });
    expect(result).toEqual({ ok: false, reason: "This tenant has no invitation to resend." });
  });

  it("refuses to resend once the account is already activated", async () => {
    const t = await makeInvitedTenant();
    const token = `activated-token-${randomUUID()}`;
    await db.invitation.create({
      data: {
        clientId: t.clientId,
        userId: t.userId,
        email: t.email,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const activated = await activateAccountFor(db, { token, password: "a-strong-password-1" });
    expect(activated.ok).toBe(true);

    const result = await resendInvitationFor(db, SUPER_ADMIN_ID, { clientId: t.clientId });
    expect(result).toEqual({ ok: false, reason: "This account has already been activated." });
  });

  it("revokes a pending invitation", async () => {
    const t = await makeInvitedTenant();
    await issueInvitation(db, {
      clientId: t.clientId,
      userId: t.userId,
      email: t.email,
      fullName: "Invited Owner",
      businessName: t.clientName,
      invitedBy: SUPER_ADMIN_ID,
    });
    const result = await revokeInvitationFor(db, SUPER_ADMIN_ID, { clientId: t.clientId });
    expect(result).toEqual({ ok: true });
    const status = await getInvitationStatusFor(db, t.clientId);
    expect(status?.status).toBe("revoked");
  });

  it("fails clearly when there is no pending invitation to revoke", async () => {
    const t = await makeInvitedTenant();
    const result = await revokeInvitationFor(db, SUPER_ADMIN_ID, { clientId: t.clientId });
    expect(result).toEqual({ ok: false, reason: "There is no pending invitation to revoke." });
  });
});
