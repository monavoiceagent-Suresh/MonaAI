import { createMiddleware } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";

import { db } from "@/lib/db.server";
import { isSuperAdminUser, resolveSession, SESSION_COOKIE } from "@/lib/sessions";

export class UnauthorizedError extends Error {}

/** Requires a valid session cookie. Context gets the caller's user id for tenant lookups. */
export const requireAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const token = getCookie(SESSION_COOKIE);
  const user = token ? await resolveSession(db, token) : null;
  if (!user) throw new UnauthorizedError("Sign in required.");
  return next({ context: { userId: user.id, email: user.email, fullName: user.fullName } });
});

/**
 * Requires a valid session AND the platform-wide Super Admin flag (users.is_super_admin).
 * This is separate from any workspace's client_members role: a tenant admin, however senior
 * within their own workspace, never passes this check. Every Super Admin server function must
 * use this middleware, not requireAuth, so a signed-in tenant user can never reach it.
 */
export const requireSuperAdmin = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const token = getCookie(SESSION_COOKIE);
  const user = token ? await resolveSession(db, token) : null;
  if (!user) throw new UnauthorizedError("Sign in required.");
  if (!(await isSuperAdminUser(db, user.id))) {
    throw new UnauthorizedError("Super Admin access required.");
  }
  return next({ context: { userId: user.id, email: user.email, fullName: user.fullName } });
});
