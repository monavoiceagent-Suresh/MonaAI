// Platform-level Super Admin: authentication and the Overview dashboard's stats. Shares the
// same users/sessions tables and cookie as the tenant dashboard (src/lib/sessions.ts) — there is
// no second auth provider — but every handler here additionally requires users.is_super_admin,
// so a signed-in tenant admin can authenticate fine and still never reach any of this.
import { createServerFn } from "@tanstack/react-start";
import { getCookie, setCookie } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSuperAdmin } from "@/lib/auth.server";
import { db } from "@/lib/db.server";
import {
  isSuperAdminUser,
  resolveSession,
  sessionCookieOptions,
  signInSuperAdminWithPassword,
  SESSION_COOKIE,
  type SessionUser,
} from "@/lib/sessions";
import { getCreditOverviewFor } from "@/lib/super-admin-credits.functions";

const signInSchema = z.object({
  email: z.string().trim().max(255),
  password: z.string().max(200),
});

/** Null unless the current session belongs to the Super Admin owner. Used by the shell/login
 * page to decide whether to render or redirect, without ever revealing *why* to the client. */
export const getSuperAdminSession = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ user: SessionUser | null }> => {
    const token = getCookie(SESSION_COOKIE);
    const user = token ? await resolveSession(db, token) : null;
    if (!user) return { user: null };
    return { user: (await isSuperAdminUser(db, user.id)) ? user : null };
  },
);

/**
 * Verifies credentials via the same password/lockout logic as the tenant login (no duplicated
 * security code), then only keeps the session if the account is the Super Admin owner. A valid
 * tenant admin password is rejected here with the same generic message as a wrong password, so
 * this endpoint never confirms or denies which accounts exist.
 */
export const superAdminSignIn = createServerFn({ method: "POST" })
  .validator(signInSchema)
  .handler(async ({ data }) => {
    const result = await signInSuperAdminWithPassword(db, data);
    if (!result.ok) return { ok: false as const, error: result.error };
    setCookie(SESSION_COOKIE, result.token, sessionCookieOptions(result.expiresAt));
    return { ok: true as const, user: result.user };
  });

export interface SuperAdminOverview {
  totalTenants: number;
  activeTenants: number;
  suspendedTenants: number;
  totalAgents: number;
  totalCampaigns: number;
  totalCreditsAcrossTenants: number;
  tenantsWithNegativeBalance: number;
  totalOutstandingNegative: number;
}

/** Counts only — no per-tenant detail. Tenant CRUD, billing and the rest of the sidebar's
 * modules are out of scope for this phase (see known-limitations in docs/technical). */
export const getSuperAdminOverview = createServerFn({ method: "GET" })
  .middleware([requireSuperAdmin])
  .handler(async (): Promise<SuperAdminOverview> => {
    const [
      totalTenants,
      activeTenants,
      suspendedTenants,
      totalAgents,
      totalCampaigns,
      creditSum,
      creditOverview,
    ] = await Promise.all([
      db.client.count(),
      db.client.count({ where: { status: "active" } }),
      db.client.count({ where: { status: "suspended" } }),
      // "Agents" in the dashboard's own vocabulary are active personas (prompts); the engine's
      // hydrated agent rows live in its own hand-written tables, outside this app's database
      // access, so this counts what the dashboard itself owns and can verify.
      db.prompt.count({ where: { active: true } }),
      db.campaign.count(),
      db.client.aggregate({ _sum: { creditBalance: true } }),
      getCreditOverviewFor(db),
    ]);
    return {
      totalTenants,
      activeTenants,
      suspendedTenants,
      totalAgents,
      totalCampaigns,
      totalCreditsAcrossTenants: creditSum._sum.creditBalance ?? 0,
      tenantsWithNegativeBalance: creditOverview.tenantsWithNegativeBalance,
      totalOutstandingNegative: creditOverview.totalOutstandingNegative,
    };
  });
