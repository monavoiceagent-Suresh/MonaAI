// Focused access-boundary checks for the Super Admin foundation: a tenant admin must never
// authenticate as Super Admin, and the Super Admin flag must behave as a strict allow-list.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db.server";
import { hashPassword } from "@/lib/password";
import {
  INVALID_CREDENTIALS,
  isSuperAdminUser,
  resolveSession,
  signInSuperAdminWithPassword,
} from "@/lib/sessions";

const PASSWORD = "correct-horse-battery";
const emails: string[] = [];

// The database allows at most one isSuperAdmin:true row (partial unique index), so every test
// that needs "the" Super Admin shares this single fixture instead of minting a new one each time.
let owner: { id: string; email: string };

beforeAll(async () => {
  owner = await newUser(true);
});

afterAll(async () => {
  await db.user.deleteMany({ where: { email: { in: emails } } });
  await db.loginAttempt.deleteMany({ where: { email: { in: emails } } });
});

async function newUser(isSuperAdmin: boolean) {
  const email = `super-admin-access-${randomUUID().slice(0, 8)}@example.test`;
  emails.push(email);
  return db.user.create({
    data: {
      email,
      fullName: "Access Tester",
      passwordHash: await hashPassword(PASSWORD),
      isSuperAdmin,
    },
    select: { id: true, email: true },
  });
}

describe("isSuperAdminUser", () => {
  it("is false for a regular tenant account", async () => {
    const user = await newUser(false);
    expect(await isSuperAdminUser(db, user.id)).toBe(false);
  });

  it("is true for the Super Admin owner", async () => {
    expect(await isSuperAdminUser(db, owner.id)).toBe(true);
  });

  it("is false for an unknown user id", async () => {
    expect(await isSuperAdminUser(db, randomUUID())).toBe(false);
  });
});

describe("signInSuperAdminWithPassword", () => {
  it("signs in the Super Admin owner with the correct password", async () => {
    const result = await signInSuperAdminWithPassword(db, {
      email: owner.email,
      password: PASSWORD,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user.id).toBe(owner.id);
    expect(await resolveSession(db, result.token)).not.toBeNull();
  });

  it("rejects a tenant admin's correct password with the generic invalid-credentials error", async () => {
    const user = await newUser(false);
    const result = await signInSuperAdminWithPassword(db, {
      email: user.email,
      password: PASSWORD,
    });
    expect(result).toEqual({ ok: false, error: INVALID_CREDENTIALS });
  });

  it("never leaves a usable session for a tenant admin who tries this entry point", async () => {
    const user = await newUser(false);
    await signInSuperAdminWithPassword(db, { email: user.email, password: PASSWORD });
    // Even though signInWithPassword underneath briefly creates a session row, this entry point
    // must revoke it before returning — a tenant admin must come away with no working cookie.
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it("gives the same generic error for a wrong password as for a non-Super-Admin account", async () => {
    const wrongPassword = await signInSuperAdminWithPassword(db, {
      email: owner.email,
      password: "wrong-password-value",
    });
    expect(wrongPassword).toEqual({ ok: false, error: INVALID_CREDENTIALS });
  });
});
