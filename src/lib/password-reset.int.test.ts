import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db.server";
import { hashPassword } from "@/lib/password";
import { hashToken } from "@/lib/sessions";
import { requestPasswordResetFor, resetPasswordFor } from "@/lib/password-reset.functions";

const userIds: string[] = [];

afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: userIds } } });
});

async function makeActivatedUser() {
  const email = `reset-user-${randomUUID().slice(0, 8)}@example.test`;
  const user = await db.user.create({
    data: { email, fullName: "Reset Tester", passwordHash: await hashPassword("old-password-123") },
    select: { id: true },
  });
  userIds.push(user.id);
  return { userId: user.id, email };
}

describe("requestPasswordResetFor", () => {
  it("issues a token for a known, activated account", async () => {
    const u = await makeActivatedUser();
    const result = await requestPasswordResetFor(db, u.email);
    expect(result).toEqual({ ok: true });
    const row = await db.passwordResetToken.findFirst({ where: { userId: u.userId } });
    expect(row).not.toBeNull();
    expect(row?.usedAt).toBeNull();
  });

  it("reports ok without creating a token for an unknown email (no enumeration)", async () => {
    const result = await requestPasswordResetFor(db, `nobody-${randomUUID()}@example.test`);
    expect(result).toEqual({ ok: true });
  });

  it("reports ok without creating a token for a not-yet-activated (invited) user", async () => {
    const email = `pending-${randomUUID().slice(0, 8)}@example.test`;
    const user = await db.user.create({
      data: { email, fullName: "Pending" },
      select: { id: true },
    });
    userIds.push(user.id);
    const result = await requestPasswordResetFor(db, email);
    expect(result).toEqual({ ok: true });
    const row = await db.passwordResetToken.findFirst({ where: { userId: user.id } });
    expect(row).toBeNull();
  });
});

describe("resetPasswordFor", () => {
  async function issueToken(userId: string) {
    const token = `reset-token-${randomUUID()}`;
    await db.passwordResetToken.create({
      data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60_000) },
    });
    return token;
  }

  it("sets the new password and revokes existing sessions", async () => {
    const u = await makeActivatedUser();
    await db.session.create({
      data: { userId: u.userId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
    });
    const token = await issueToken(u.userId);

    const result = await resetPasswordFor(db, { token, password: "a-new-strong-password" });
    expect(result).toEqual({ ok: true });
    expect(await db.session.count({ where: { userId: u.userId } })).toBe(0);
    const usedToken = await db.passwordResetToken.findFirst({ where: { userId: u.userId } });
    expect(usedToken?.usedAt).not.toBeNull();
  });

  it("rejects a password shorter than the minimum", async () => {
    const u = await makeActivatedUser();
    const token = await issueToken(u.userId);
    const result = await resetPasswordFor(db, { token, password: "short" });
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("at least") });
  });

  it("rejects an unknown token", async () => {
    const result = await resetPasswordFor(db, {
      token: "not-a-real-token",
      password: "a-new-strong-password",
    });
    expect(result).toEqual({
      ok: false,
      reason: expect.stringContaining("invalid or has expired"),
    });
  });

  it("rejects reuse of an already-used token", async () => {
    const u = await makeActivatedUser();
    const token = await issueToken(u.userId);
    const first = await resetPasswordFor(db, { token, password: "a-new-strong-password" });
    expect(first.ok).toBe(true);
    const second = await resetPasswordFor(db, { token, password: "yet-another-password" });
    expect(second).toEqual({
      ok: false,
      reason: expect.stringContaining("invalid or has expired"),
    });
  });

  it("rejects an expired token", async () => {
    const u = await makeActivatedUser();
    const token = `expired-reset-${randomUUID()}`;
    await db.passwordResetToken.create({
      data: {
        userId: u.userId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    const result = await resetPasswordFor(db, { token, password: "a-new-strong-password" });
    expect(result).toEqual({
      ok: false,
      reason: expect.stringContaining("invalid or has expired"),
    });
  });
});
