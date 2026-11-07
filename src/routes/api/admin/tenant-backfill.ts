// Production-native tenant→engine backfill (see src/lib/tenant-sync-backfill.ts and
// docs/MULTI_TENANT_TELEPHONY_PLAN.md M1 step 5). Runs inside this deployment, against this
// deployment's own DATABASE_URL/VOICE_ENGINE_* — not a developer's local env — so there is no
// path for this route to touch a database or engine other than the one it's actually deployed
// against. An ops caller (human or script) POSTs repeatedly with the returned cursor until
// `done: true`; each call is bounded well under a serverless function's timeout (see
// backfillTenantsToEnginePage), so no background job runner is needed for a one-off task.
//
// No session exists for this caller (it's an ops script, not a signed-in browser), so this
// uses the same static-bearer-secret shape as the engine's own Dashboard→Engine auth
// (docs/technical/security.md) instead of requireSuperAdmin. Never skip the token check: an
// unauthenticated version of this route would let anyone push arbitrary id/name/status rows
// into the engine's tenant table.
import { createFileRoute } from "@tanstack/react-router";
import { db } from "@/lib/db.server";
import { verifyBearerToken } from "@/lib/admin-bearer-auth.server";
import { acquireOpsLock, releaseOpsLock } from "@/lib/ops-lock.server";
import { backfillTenantsToEnginePage } from "@/lib/tenant-sync-backfill";

const LOCK_KEY = "tenant-backfill";
const LOCK_TTL_MS = 60_000;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
const DEFAULT_TIME_BUDGET_MS = 15_000;
const MAX_TIME_BUDGET_MS = 30_000;

interface RequestBody {
  cursor?: string;
  limit?: number;
  timeBudgetMs?: number;
}

export const Route = createFileRoute("/api/admin/tenant-backfill")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = process.env["TENANT_BACKFILL_TOKEN"];
        if (!token) {
          console.error("[tenant-backfill] TENANT_BACKFILL_TOKEN is not set");
          return new Response("Server configuration error", { status: 500 });
        }
        if (!verifyBearerToken(request.headers.get("authorization"), token)) {
          return new Response("Unauthorized", { status: 401 });
        }

        let body: RequestBody = {};
        const rawBody = await request.text();
        if (rawBody) {
          try {
            body = JSON.parse(rawBody) as RequestBody;
          } catch {
            return new Response("Invalid JSON", { status: 400 });
          }
        }
        const limit = Math.min(Math.max(1, body.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
        const timeBudgetMs = Math.min(
          Math.max(1000, body.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS),
          MAX_TIME_BUDGET_MS,
        );

        const locked = await acquireOpsLock(db, LOCK_KEY, LOCK_TTL_MS);
        if (!locked) {
          return Response.json(
            { error: "A tenant backfill is already running. Retry shortly." },
            { status: 409 },
          );
        }
        try {
          const result = await backfillTenantsToEnginePage(db, {
            ...(body.cursor ? { cursor: body.cursor } : {}),
            limit,
            timeBudgetMs,
          });
          return Response.json(result);
        } catch (error) {
          console.error("[tenant-backfill]", error);
          return new Response("Backfill batch failed", { status: 500 });
        } finally {
          await releaseOpsLock(db, LOCK_KEY);
        }
      },
    },
  },
});
