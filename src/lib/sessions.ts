import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { burnPasswordCheck, isAcceptablePasswordInput, verifyPassword } from "./password";

export const SESSION_COOKIE = "mona_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_WINDOW = 10;

export const INVALID_CREDENTIALS = "That email or password doesn't match.";
export const TOO_MANY_ATTEMPTS = "Too many sign-in attempts. Wait 15 minutes and try again.";

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env["NODE_ENV"] === "production",
    path: "/",
    expires: expiresAt,
  };
}

export type SignInResult =
  { ok: true; user: SessionUser; token: string; expiresAt: Date } | { ok: false; error: string };

export async function signInWithPassword(
  database: PrismaClient,
  input: { email: string; password: string },
  now = new Date(),
): Promise<SignInResult> {
  const email = input.email.trim().toLowerCase();
  if (!email || !isAcceptablePasswordInput(input.password))
    return { ok: false, error: INVALID_CREDENTIALS };

  // Failures are counted per email address, so guessing one account is slowed down
  // no matter how many IPs are used. Unknown addresses are counted too, so a lockout
  // reveals nothing about which accounts exist.
  const recentFailures = await database.loginAttempt.count({
    where: {
      email,
      succeeded: false,
      createdAt: { gte: new Date(now.getTime() - LOCKOUT_WINDOW_MS) },
    },
  });
  if (recentFailures >= MAX_FAILURES_PER_WINDOW) return { ok: false, error: TOO_MANY_ATTEMPTS };

  const user = await database.user.findUnique({
    where: { email },
    select: { id: true, email: true, fullName: true, passwordHash: true },
  });
  let valid = false;
  if (user) {
    valid = await verifyPassword(input.password, user.passwordHash);
  } else {
    await burnPasswordCheck(input.password);
  }

  await database.loginAttempt.create({ data: { email, succeeded: valid } });
  if (!user || !valid) return { ok: false, error: INVALID_CREDENTIALS };

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await database.$transaction([
    database.session.deleteMany({ where: { userId: user.id, expiresAt: { lte: now } } }),
    database.session.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt } }),
  ]);
  return {
    ok: true,
    user: { id: user.id, email: user.email, fullName: user.fullName },
    token,
    expiresAt,
  };
}

/** Returns the signed-in user for a session token, or null if it is unknown or expired. */
export async function resolveSession(
  database: PrismaClient,
  token: string,
  now = new Date(),
): Promise<SessionUser | null> {
  const session = await database.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { expiresAt: true, user: { select: { id: true, email: true, fullName: true } } },
  });
  if (!session) return null;
  if (session.expiresAt <= now) {
    await database.session.deleteMany({ where: { tokenHash: hashToken(token) } });
    return null;
  }
  return session.user;
}

export async function revokeSession(database: PrismaClient, token: string): Promise<void> {
  await database.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

/** Platform-wide Super Admin flag (users.is_super_admin) — separate from any workspace's
 * client_members role. At most one user can have this set (see the migration's partial index). */
export async function isSuperAdminUser(database: PrismaClient, userId: string): Promise<boolean> {
  const account = await database.user.findUnique({
    where: { id: userId },
    select: { isSuperAdmin: true },
  });
  return account?.isSuperAdmin ?? false;
}

/**
 * Same password/lockout checks as signInWithPassword (no duplicated security logic), but only
 * keeps the session if the account is the Super Admin owner. A correct password for a regular
 * account is rejected with the same generic message as a wrong one, so this never reveals which
 * accounts exist or that they are "merely" not the Super Admin.
 */
export async function signInSuperAdminWithPassword(
  database: PrismaClient,
  input: { email: string; password: string },
  now = new Date(),
): Promise<SignInResult> {
  const result = await signInWithPassword(database, input, now);
  if (!result.ok) return result;
  if (!(await isSuperAdminUser(database, result.user.id))) {
    await revokeSession(database, result.token);
    return { ok: false, error: INVALID_CREDENTIALS };
  }
  return result;
}
