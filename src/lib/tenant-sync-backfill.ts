// One-off (but safe to re-run) sync of every existing Client row to the engine's tenant
// registry (PUT /tenants — see app/tenants.py and docs/MULTI_TENANT_TELEPHONY_PLAN.md M1 step 5).
//
// createTenantFor/updateTenantFor/setTenantStatusFor (super-admin-tenants.functions.ts) only sync
// a tenant going forward, from the moment that code shipped. Any Client row that existed before
// then — or one created outside those flows (scripts/create-user.ts) — was never pushed to the
// engine, so app/tenants.py logs it as "not a tenant the engine has been told about" on every
// dispatch/admission check it's involved in. This closes that gap for existing tenants; the
// per-flow syncs above keep it closed for every tenant created afterwards.
//
// Idempotent: the engine upserts on client_id (app/tenants.py upsert_tenant does
// ON CONFLICT ... DO UPDATE), so re-running this after a partial failure is just re-running it —
// a tenant that already synced is synced again, harmlessly, and only the ones that failed need
// the retry to matter.
import type { PrismaClient } from "@prisma/client";
// Relative, extensioned import (not the "@/" alias): this file is loaded directly by
// scripts/backfill-tenants-to-engine.ts via `node --experimental-strip-types`, which resolves
// ESM specifiers itself and doesn't know about tsconfig's "@/*" path alias — only Vite/vitest do.
// Every other src/lib file reachable from a CLI script (password.ts, voice-engine/client.ts)
// already sticks to plain relative imports for the same reason.
import { syncTenantToEngine } from "./voice-engine/client.ts";

export interface TenantBackfillFailure {
  clientId: string;
  error: string;
}

export interface TenantBackfillResult {
  total: number;
  synced: number;
  failures: TenantBackfillFailure[];
}

interface ClientRow {
  id: string;
  name: string;
  status: string;
}

async function syncOne(client: ClientRow): Promise<string | null> {
  try {
    await syncTenantToEngine({
      id: client.id,
      name: client.name,
      status: client.status === "suspended" ? "suspended" : "active",
    });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Could not reach the voice engine.";
  }
}

/** Syncs every existing Client in one pass. Only safe to call somewhere with no request
 * timeout (a local/CI shell, not a Vercel function) — see backfillTenantsToEnginePage for the
 * chunked equivalent scripts/backfill-tenants-to-engine.ts and the production admin route use. */
export async function backfillTenantsToEngine(
  database: PrismaClient,
): Promise<TenantBackfillResult> {
  const clients = await database.client.findMany({
    select: { id: true, name: true, status: true },
  });

  const failures: TenantBackfillFailure[] = [];
  let synced = 0;
  for (const client of clients) {
    const error = await syncOne(client);
    if (error) failures.push({ clientId: client.id, error });
    else synced += 1;
  }
  return { total: clients.length, synced, failures };
}

export interface TenantBackfillPageResult {
  synced: number;
  failures: TenantBackfillFailure[];
  /** Pass as `cursor` on the next call to continue. Undefined once `done` is true. */
  nextCursor: string | undefined;
  /** True once every Client row (as of this call) has been visited. */
  done: boolean;
}

/**
 * Syncs up to `limit` Client rows, ordered by id, starting after `cursor`, but also stops as
 * soon as `timeBudgetMs` has elapsed — whichever comes first. The caller (the
 * /api/admin/tenant-backfill route, or an operator script driving it) repeats the call with
 * the returned `nextCursor` until `done` is true, which is how an unbounded tenant list gets
 * backfilled without any single request running long enough to hit a serverless timeout.
 * `timeBudgetMs` bounds the *loop*, not a single `syncTenantToEngine` call — size it with that
 * call's own worst case in mind (voice-engine/client.ts's timeout and retries) and leave the
 * route's configured max duration enough headroom above timeBudgetMs for one more such call.
 *
 * Idempotent per page and across repeats: re-running any page (including after a crash mid
 * page, or after a time-budget cutoff) only re-syncs the engine's own upsert, never creates a
 * duplicate tenant.
 */
export async function backfillTenantsToEnginePage(
  database: PrismaClient,
  { cursor, limit, timeBudgetMs }: { cursor?: string; limit: number; timeBudgetMs: number },
): Promise<TenantBackfillPageResult> {
  const clients = await database.client.findMany({
    select: { id: true, name: true, status: true },
    orderBy: { id: "asc" },
    take: limit,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const failures: TenantBackfillFailure[] = [];
  let synced = 0;
  let lastAttemptedId: string | undefined;
  const deadline = Date.now() + timeBudgetMs;
  let stoppedEarly = false;

  for (const client of clients) {
    if (Date.now() > deadline) {
      stoppedEarly = true;
      break;
    }
    const error = await syncOne(client);
    if (error) failures.push({ clientId: client.id, error });
    else synced += 1;
    lastAttemptedId = client.id;
  }

  const done = !stoppedEarly && clients.length < limit;
  return {
    synced,
    failures,
    nextCursor: done ? undefined : (lastAttemptedId ?? cursor),
    done,
  };
}
