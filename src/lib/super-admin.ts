import { useQuery } from "@tanstack/react-query";
import { getSuperAdminSession, superAdminSignIn } from "@/lib/super-admin.functions";
import { signOutCurrentUser } from "@/lib/auth";
import type { SessionUser } from "@/lib/sessions";

export const SUPER_ADMIN_SESSION_QUERY_KEY = ["super-admin-session"] as const;

export type SuperAdminAuthStatus = "loading" | "signed-in" | "signed-out";
export interface SuperAdminAuthState {
  status: SuperAdminAuthStatus;
  user: SessionUser | null;
}

/** Same session cookie as the tenant dashboard, but null unless that session is the Super
 * Admin owner — see getSuperAdminSession. A signed-in tenant admin reads as "signed-out" here. */
export function useSuperAdminSession(): SuperAdminAuthState {
  const query = useQuery({
    queryKey: SUPER_ADMIN_SESSION_QUERY_KEY,
    queryFn: () => getSuperAdminSession(),
    staleTime: 60_000,
    retry: false,
  });
  if (query.isPending) return { status: "loading", user: null };
  const user = query.data?.user ?? null;
  return user ? { status: "signed-in", user } : { status: "signed-out", user: null };
}

export async function superAdminSignInWithPassword(email: string, password: string) {
  const result = await superAdminSignIn({ data: { email, password } });
  return result.ok
    ? { ok: true as const, user: result.user }
    : { ok: false as const, message: result.error };
}

/** Clears the same cookie the tenant dashboard uses; there is nothing Super-Admin-specific
 * to revoke beyond the session itself. */
export const superAdminSignOut = signOutCurrentUser;
