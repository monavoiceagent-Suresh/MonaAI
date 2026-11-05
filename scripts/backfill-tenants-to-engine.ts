// One-off backfill for M1 (see docs/MULTI_TENANT_TELEPHONY_PLAN.md and app/tenants.py): pushes
// every existing Client row to the engine's tenant registry (PUT /tenants) so
// TENANT_VALIDATION_MODE can move from log_only to enforcing with zero false rejections.
//
// Required before enabling enforcement: without this, any tenant created before tenant sync
// shipped (or via scripts/create-user.ts, which creates a workspace without syncing it) is
// invisible to the engine and would start failing dispatch/admission checks. Safe to run more
// than once — the engine upserts on client_id, so a tenant that already synced just syncs again.
//
// Requires VOICE_ENGINE_BASE_URL / VOICE_ENGINE_API_KEY, same as the running app.
// Run: npm run db:backfill-tenants
import { PrismaClient } from "@prisma/client";
import { backfillTenantsToEngine } from "../src/lib/tenant-sync-backfill.ts";

const db = new PrismaClient();

try {
  const result = await backfillTenantsToEngine(db);
  for (const failure of result.failures) {
    console.error(`Failed to sync tenant ${failure.clientId}: ${failure.error}`);
  }
  console.log(`Synced ${result.synced}/${result.total} tenant(s) to the engine.`);
  if (result.failures.length) {
    console.log(
      `${result.failures.length} tenant(s) failed to sync. Re-run this script to retry — ` +
        `it only needs to succeed for those, and re-syncing an already-synced tenant is harmless.`,
    );
    process.exitCode = 1;
  }
} finally {
  await db.$disconnect();
}
