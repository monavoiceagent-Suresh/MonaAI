import { createServerFn } from "@tanstack/react-start";
import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";
import { z } from "zod";

import { db } from "@/lib/db.server";
import {
  resolveSession,
  revokeSession,
  sessionCookieOptions,
  signInWithPassword,
  SESSION_COOKIE,
  type SessionUser,
} from "@/lib/sessions";
import { isCallerWorkspaceSuspended } from "@/lib/workspace.functions";

const signInSchema = z.object({
  email: z.string().trim().max(255),
  password: z.string().max(200),
});

export const getSession = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ user: SessionUser | null }> => {
    const token = getCookie(SESSION_COOKIE);
    return { user: token ? await resolveSession(db, token) : null };
  },
);

export const signIn = createServerFn({ method: "POST" })
  .validator(signInSchema)
  .handler(async ({ data }) => {
    const result = await signInWithPassword(db, data);
    if (!result.ok) return { ok: false as const, error: result.error };

    // Suspension blocks login outright, with a clear reason — unlike the Super Admin entry
    // point, there is nothing to hide here: this is the tenant's own account.
    if (await isCallerWorkspaceSuspended(db, result.user.id)) {
      await revokeSession(db, result.token);
      return {
        ok: false as const,
        error: "Your workspace has been suspended. Contact your account administrator.",
      };
    }

    setCookie(SESSION_COOKIE, result.token, sessionCookieOptions(result.expiresAt));
    return { ok: true as const, user: result.user };
  });

export const signOut = createServerFn({ method: "POST" }).handler(async () => {
  const token = getCookie(SESSION_COOKIE);
  if (token) await revokeSession(db, token);
  deleteCookie(SESSION_COOKIE, { path: "/" });
  return { ok: true as const };
});
